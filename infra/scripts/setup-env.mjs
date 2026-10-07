#!/usr/bin/env node
/**
 * Build infra/.env for the whole stack.
 *
 * Three stages, in this order:
 *
 *   1. Start from upstream's `.env.example`. The self-hosted Supabase compose
 *      references roughly eighty variables that have no default — SMTP, MFA,
 *      SAML, SMS, pooler sizing, Studio defaults — and that file is the only
 *      authoritative list of them. Enumerating them here by hand is how you get a
 *      stack that boots and then fails in one service.
 *
 *   2. Let upstream's own `utils/generate-keys.sh` mint the Supabase secrets. It
 *      signs ANON_KEY and SERVICE_ROLE_KEY the way its own services expect, and
 *      covers values we would otherwise miss (PG_META_CRYPTO_KEY,
 *      REALTIME_DB_ENC_KEY, the S3 protocol keys). It edits `.env` in place in the
 *      current working directory, so it is run with cwd set to infra/.
 *
 *   3. Apply our overrides: the domain-derived URLs, Redis, Evolution Go, and the
 *      app's own variables. This has to come last because DATABASE_URL embeds the
 *      POSTGRES_PASSWORD that stage 2 generates.
 *
 * Usage:
 *   node infra/scripts/setup-env.mjs --app-host app.example.com --api-host api.example.com
 *   node infra/scripts/setup-env.mjs --domain example.com   # shorthand: app.<d> / api.<d>
 *
 * The two hostnames are set independently because they need not be siblings of a
 * single domain. Running the app at odontobox.venn360.com with its API at
 * odontobox-api.venn360.com avoids four-level subdomains, and keeps a later move
 * to a dedicated domain a two-value change rather than a rework.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { renderTraefik } from './render-traefik.mjs'

const args = process.argv.slice(2)
function flag(name) {
    const i = args.indexOf(`--${name}`)
    if (i === -1) return undefined
    const value = args[i + 1]
    return value && !value.startsWith('--') ? value : true
}

const force = Boolean(flag('force'))

const domainArg = flag('domain')
const appHostArg = flag('app-host')
const apiHostArg = flag('api-host')

const str = (v) => (typeof v === 'string' && v.length > 0 ? v : undefined)

const domain = str(domainArg)
const appHost = str(appHostArg) ?? (domain ? `app.${domain}` : undefined)
const apiHost = str(apiHostArg) ?? (domain ? `api.${domain}` : undefined)

if (!appHost || !apiHost) {
    console.error('Usage:')
    console.error('  node infra/scripts/setup-env.mjs --app-host <host> --api-host <host> [--email <addr>] [--force]')
    console.error('  node infra/scripts/setup-env.mjs --domain <example.com> [--force]')
    process.exit(1)
}

if (appHost === apiHost) {
    console.error('--app-host and --api-host must differ: Traefik routes by hostname.')
    process.exit(1)
}

/**
 * Let's Encrypt wants a contact address. Derived from the app host's registrable
 * name unless given, which is the common case and avoids one more required flag.
 */
const acmeEmail =
    str(flag('email')) ?? `admin@${domain ?? appHost.split('.').slice(-2).join('.')}`

const infraDir = path.resolve(import.meta.dirname, '..')
const supabaseDir = path.join(infraDir, 'supabase')
const templatePath = path.join(supabaseDir, '.env.example')
const envPath = path.join(infraDir, '.env')
const keygen = path.join(supabaseDir, 'utils', 'generate-keys.sh')

if (!fs.existsSync(templatePath)) {
    console.error(`Missing ${templatePath}`)
    console.error('Run ./infra/scripts/fetch-supabase.sh first.')
    process.exit(1)
}

if (fs.existsSync(envPath) && !force) {
    console.error(`Refusing to overwrite ${envPath}. Re-run with --force if that is what you want.`)
    console.error('Rotating these values invalidates every existing session and stored key.')
    process.exit(1)
}

// ---------------------------------------------------------------------------
// Stage 1 — upstream template
// ---------------------------------------------------------------------------
fs.copyFileSync(templatePath, envPath)
fs.chmodSync(envPath, 0o600)

// ---------------------------------------------------------------------------
// Stage 2 — upstream secret generation
// ---------------------------------------------------------------------------
console.log('==> Generating Supabase secrets with upstream utils/generate-keys.sh')
try {
    execFileSync('sh', [keygen, '--update-env'], { cwd: infraDir, stdio: ['ignore', 'pipe', 'inherit'] })
} catch (error) {
    console.error('generate-keys.sh failed:', error.message)
    console.error('It needs openssl on PATH.')
    process.exit(1)
}
// The script leaves a sed backup behind.
fs.rmSync(`${envPath}.old`, { force: true })

// ---------------------------------------------------------------------------
// Stage 3 — our overrides
// ---------------------------------------------------------------------------
const env = new Map()
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) env.set(m[1], m[2])
}

const postgresPassword = env.get('POSTGRES_PASSWORD')
if (!postgresPassword) {
    console.error('POSTGRES_PASSWORD missing after key generation; aborting.')
    process.exit(1)
}

const token = (bytes = 24) => crypto.randomBytes(bytes).toString('base64url')
const redisPassword = token(24)
const evolutionGoKey = token(24)
const evolutionV2Key = token(24)

/**
 * Overrides, applied to existing keys or appended.
 *
 * COMPOSE_FILE is blanked deliberately: upstream sets it for its own run.sh, and
 * Docker Compose reads it straight out of .env — leaving it would make
 * `docker compose` in infra/ load upstream's docker-compose.yml instead of our
 * compose.yaml.
 */
const overrides = {
    COMPOSE_FILE: '',

    // Our edge. APP_HOST and API_HOST are what Traefik matches on.
    APP_HOST: appHost,
    API_HOST: apiHost,
    ACME_EMAIL: acmeEmail,

    // Supabase public identity
    SITE_URL: `https://${appHost}`,
    API_EXTERNAL_URL: `https://${apiHost}`,
    SUPABASE_PUBLIC_URL: `https://${apiHost}`,
    ADDITIONAL_REDIRECT_URLS: `https://${appHost}/**`,

    STUDIO_DEFAULT_ORGANIZATION: 'Venn360',
    STUDIO_DEFAULT_PROJECT: 'OdontoBox360',
    POOLER_TENANT_ID: 'odontobox360',

    // Keep the pooler's host port off the public range; the firewall drops it
    // either way, but 5432 on the edge invites noise.
    POSTGRES_PORT: '5432',
    POSTGRES_HOST: 'db',

    // App — Prisma talks to the database directly rather than through the
    // pooler, because migrations need a session-level connection.
    DATABASE_URL: `postgresql://postgres:${postgresPassword}@db:5432/postgres?schema=public`,
    NEXT_PUBLIC_SUPABASE_URL: `https://${apiHost}`,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: env.get('ANON_KEY') ?? '',
    SUPABASE_SERVICE_ROLE_KEY: env.get('SERVICE_ROLE_KEY') ?? '',
    SUPABASE_DB_SCHEMA: 'public',
    NEXT_PUBLIC_SUPABASE_DB_SCHEMA: 'public',
    SUPABASE_STORAGE_BUCKET: 'attachments',
    NEXT_PUBLIC_APP_URL: `https://${appHost}`,

    // Queue
    REDIS_PASSWORD: redisPassword,
    REDIS_URL: `redis://default:${redisPassword}@redis:6379`,

    // Workers
    WORKER_QUEUES: 'all',
    ENABLE_SCHEDULER: 'true',
    LOG_LEVEL: 'info',
    TZ: 'America/Sao_Paulo',
    INBOUND_DEBOUNCE_SECONDS: '4',
    AI_HISTORY_LIMIT: '20',
    AI_RAG_CHUNKS: '4',
    CONVERSATION_AUTOCLOSE_HOURS: '0',

    // WhatsApp — Evolution Go serves the QR channel; v2 is opt-in for the
    // official Meta channel (docker compose --profile business).
    EVOLUTION_GO_URL: 'http://evolution-go:8080',
    EVOLUTION_GO_API_KEY: evolutionGoKey,
    EVOLUTION_API_URL: 'http://evolution-v2:8080',
    EVOLUTION_API_KEY: evolutionV2Key,

    // Providers post here. The internal address keeps the callback on the
    // Compose network instead of leaving the host and returning through Traefik.
    WEBHOOK_BASE_URL: 'http://app:3000',
    WEBHOOK_URL: 'http://app:3000/api/webhooks/evolution',
}

/**
 * Features we do not use.
 *
 * Upstream's example omits these, so without explicit values Compose substitutes
 * an empty string and GoTrue tries to parse "" as a boolean. Set them off, with
 * real numbers where a number is expected, rather than leaving the auth service
 * to guess.
 */
const DISABLED_FEATURES = {
    // Social sign-in: the app authenticates with e-mail and password.
    GOOGLE_ENABLED: 'false',
    GOOGLE_SECRET: '',
    GITHUB_ENABLED: 'false',
    GITHUB_CLIENT_ID: '',
    GITHUB_SECRET: '',
    AZURE_ENABLED: 'false',
    AZURE_CLIENT_ID: '',
    AZURE_SECRET: '',

    // SAML
    SAML_ENABLED: 'false',
    SAML_PRIVATE_KEY: '',
    SAML_EXTERNAL_URL: '',
    SAML_ALLOW_ENCRYPTED_ASSERTIONS: 'false',
    SAML_RATE_LIMIT_ASSERTION: '15',
    SAML_RELAY_STATE_VALIDITY_PERIOD: '300',

    // MFA
    MFA_TOTP_ENROLL_ENABLED: 'false',
    MFA_TOTP_VERIFY_ENABLED: 'false',
    MFA_PHONE_ENROLL_ENABLED: 'false',
    MFA_PHONE_VERIFY_ENABLED: 'false',
    MFA_MAX_ENROLLED_FACTORS: '10',

    // SMS / phone sign-in
    SMS_PROVIDER: 'twilio',
    SMS_TWILIO_ACCOUNT_SID: '',
    SMS_TWILIO_AUTH_TOKEN: '',
    SMS_TWILIO_MESSAGE_SERVICE_SID: '',
    SMS_MAX_FREQUENCY: '5',
    SMS_OTP_EXP: '6000',
    SMS_OTP_LENGTH: '6',
    SMS_TEMPLATE: 'Seu código é {{ .Code }}',
    SMS_TEST_OTP: '',
}

const PLACEHOLDERS = {
    OPENAI_API_KEY: '',
    GOOGLE_CLIENT_ID: '',
    GOOGLE_CLIENT_SECRET: '',
    GOOGLE_REDIRECT_URI: `https://${appHost}/api/integrations/google/callback`,
}

let content = fs.readFileSync(envPath, 'utf8')
const appended = []

for (const [key, value] of Object.entries({ ...overrides, ...DISABLED_FEATURES, ...PLACEHOLDERS })) {
    const re = new RegExp(`^${key}=.*$`, 'm')
    if (re.test(content)) {
        content = content.replace(re, `${key}=${value}`)
    } else {
        appended.push(`${key}=${value}`)
    }
}

if (appended.length > 0) {
    content = content.trimEnd() + [
        '',
        '',
        '############',
        '# OdontoBox360 — app, workers, queue, WhatsApp providers, disabled features',
        '############',
        '',
        ...appended,
        '',
    ].join('\n')
}

fs.writeFileSync(envPath, content, { mode: 0o600 })

const traefikPath = renderTraefik(apiHost)

console.log('')
console.log(`Wrote ${envPath} (mode 0600)`)
console.log(`Wrote ${traefikPath}`)
console.log('')
console.log(`  app  →  https://${appHost}`)
console.log(`  api  →  https://${apiHost}`)
console.log('')
console.log('Studio login (SSH tunnel only — it is not published):')
console.log(`  user: ${env.get('DASHBOARD_USERNAME') ?? 'supabase'}`)
console.log(`  pass: ${env.get('DASHBOARD_PASSWORD') ?? '(see .env)'}`)
console.log('')
console.log('Still to fill in by hand, in infra/.env:')
console.log('  OPENAI_API_KEY — o projeto precisa permitir chat E text-embedding-3-small')
console.log('  GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET')
console.log('  SMTP_* — auth e-mails (password reset, confirmations) need a real sender')
console.log('')
console.log('Keep a copy somewhere safe: regenerating JWT_SECRET invalidates every')
console.log('session and every key already issued.')
