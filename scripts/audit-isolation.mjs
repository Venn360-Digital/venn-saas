#!/usr/bin/env node
/**
 * audit-isolation.mjs — Auditoria estática de isolamento entre apps (Odontobox360 / Stagent360 / Conecta360)
 *
 * Falha (exit 1) quando o repositório:
 *   1. contém qualquer identificador listado em infra/fingerprints/<outro-app>.json
 *      (strings de marca, hostnames, IDs Cloudflare, buckets, endpoints Neon, containers, client IDs...);
 *   2. tem no wrangler um ID/bucket/rota/nome de Worker que não pertence ao ambiente certo do infra/manifest.json;
 *   3. tem o ambiente `stg` apontando para recurso de `production` (ou o contrário);
 *   4. tem a configuração raiz do wrangler (dev local, sem --env) apontando para recurso de produção;
 *   5. tem recursos do manifesto que colidem com recursos de outro app.
 *
 * Uso:
 *   node scripts/audit-isolation.mjs            # placeholders __FASE07__ aceitos (Fases 05-06)
 *   node scripts/audit-isolation.mjs --strict   # placeholders proibidos (Fase 07 em diante e no CI)
 *
 * Sem dependências externas. Node >= 18.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, relative, extname, basename } from 'node:path';

const ROOT = process.cwd();
const STRICT = process.argv.includes('--strict');
const MANIFEST_PATH = 'infra/manifest.json';
const FINGERPRINT_DIR = 'infra/fingerprints';
const PLACEHOLDER = '__FASE07__';

const IGNORE_DIRS = new Set([
  '.git', 'node_modules', '.wrangler', '.open-next', '.next', 'dist', 'build',
  'coverage', '.turbo', '.vercel', '.cache',
  // `.claude/` carrega worktrees locais com CÓPIAS de infra/ (fingerprints dos
  // outros apps inclusive) — era a fonte de 347 "erros" no --strict desta
  // máquina, nenhum deles do código publicado. No CI o diretório nem existe.
  '.claude',
]);
// Caminhos onde menções a outros apps são legítimas (documentação, inventários, listas proibidas)
const IGNORE_PREFIXES = [
  'infra/runbook/', 'infra/fingerprints/', 'infra/inventory/', 'infra/reports/',
  'scripts/audit-isolation.mjs',
  /*
   * Migração APLICADA é imutável: editar o arquivo muda o checksum e o
   * `prisma migrate deploy` passa a recusar o ambiente onde ela já rodou. A de
   * `app_identity` grava o slug do app como sentinela — é o dado que o smoke de
   * identidade compara, e ele existe justamente para ser o nome deste app.
   */
  'packages/db/prisma/migrations/',
];
const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico', '.pdf', '.woff', '.woff2',
  '.ttf', '.otf', '.eot', '.zip', '.gz', '.tgz', '.mp4', '.mp3', '.wav', '.webm', '.lockb', '.wasm',
]);
const HEX32 = /\b[0-9a-f]{32}\b/gi;

const errors = [];
const warnings = [];
const err = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

// ---------- utilidades ----------
function readJson(path) {
  if (!existsSync(path)) {
    console.error(`✖ Arquivo obrigatório ausente: ${path}`);
    process.exit(2);
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    console.error(`✖ JSON inválido em ${path}: ${e.message}`);
    process.exit(2);
  }
}

function deepStrings(value, acc = []) {
  if (typeof value === 'string') acc.push(value);
  else if (Array.isArray(value)) value.forEach((v) => deepStrings(v, acc));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => deepStrings(v, acc));
  return acc;
}

function hexIds(text) {
  return new Set((String(text).match(HEX32) || []).map((s) => s.toLowerCase()));
}

/** Remove comentários de JSONC respeitando strings ("https://" não é comentário) e vírgulas finais. */
function stripJsonc(src) {
  let out = '';
  let inStr = false;
  let esc = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const n = src[i + 1];
    if (inStr) {
      out += c;
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; out += '\n'; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i++; continue; }
    out += c;
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

/**
 * A lista de arquivos vem do GIT, não do disco — e isso foi um conserto.
 *
 * A varredura por diretório lia tudo que estivesse na pasta, inclusive o que o
 * git nem rastreia: logs de sessão (`.playwright-mcp/`), worktrees em
 * `.claude/`, anotações soltas. Medido em 01/11: 347 "erros" no `--strict`
 * desta máquina, **zero** deles em código publicável — e o portão de deploy
 * usa `--strict`, então a auditoria reprovava um deploy por causa de um log
 * local. O contêiner de build clona o repositório limpo: o que define o que é
 * auditável é o índice do git, e agora o local confere exatamente o mesmo
 * conjunto que o CI confere.
 *
 * O `walk` fica como reserva para ambiente sem git.
 */
function arquivosDoGit() {
  const saida = execSync('git ls-files -z', { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
  const lista = [];
  for (const rel of saida.toString('utf8').split('\0')) {
    if (!rel) continue;
    const partes = rel.split('/');
    if (partes.some((seg) => IGNORE_DIRS.has(seg))) continue;
    if (IGNORE_PREFIXES.some((p) => rel === p.replace(/\/$/, '') || rel.startsWith(p))) continue;
    let st;
    try { st = statSync(join(ROOT, rel)); } catch { continue; } // deletado localmente
    if (st.isDirectory()) continue;
    lista.push({ rel, binary: BINARY_EXT.has(extname(rel).toLowerCase()) || st.size > 2_000_000 });
  }
  return lista;
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (IGNORE_DIRS.has(name)) continue;
    const full = join(dir, name);
    const rel = relative(ROOT, full).split('\\').join('/');
    if (IGNORE_PREFIXES.some((p) => rel === p.replace(/\/$/, '') || rel.startsWith(p))) continue;
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) walk(full, out);
    else out.push({ rel, binary: BINARY_EXT.has(extname(name).toLowerCase()) || st.size > 2_000_000 });
  }
  return out;
}

// ---------- carga ----------
const manifest = readJson(MANIFEST_PATH);
const SLUG = manifest?.app?.slug;
if (!SLUG) { console.error('✖ manifest.app.slug ausente'); process.exit(2); }
const envs = manifest.environments || {};
const ENV_NAMES = Object.keys(envs);
if (!ENV_NAMES.includes('production') || !ENV_NAMES.includes('stg')) {
  err(`manifest.environments deve conter "production" e "stg" (encontrado: ${ENV_NAMES.join(', ') || 'nenhum'})`);
}

const fingerprints = [];
/** TODOS os fingerprints, o do próprio app incluído — a regra por pasta precisa deles. */
const fingerprintsTodos = [];
if (existsSync(FINGERPRINT_DIR)) {
  for (const f of readdirSync(FINGERPRINT_DIR).filter((x) => x.endsWith('.json'))) {
    const fp = readJson(join(FINGERPRINT_DIR, f));
    const fpSlug = fp.slug || basename(f, '.json');
    fingerprintsTodos.push({ file: f, slug: fpSlug, data: fp });
    if (fpSlug === SLUG) continue; // o próprio app: não entra na lista proibida global
    fingerprints.push({ file: f, slug: fpSlug, data: fp });
  }
} else {
  warn(`Pasta ${FINGERPRINT_DIR}/ não existe — nenhuma lista proibida carregada.`);
}

const forbidden = []; // { token, lower, owner }
const warnTokens = [];
for (const fp of fingerprints) {
  for (const [key, val] of Object.entries(fp.data)) {
    if (key === 'slug' || key.startsWith('$')) continue;
    const list = deepStrings(val).map((s) => s.trim()).filter((s) => s.length >= 3 && !s.startsWith('<'));
    if (key === 'warnStrings') list.forEach((t) => warnTokens.push({ token: t, lower: t.toLowerCase(), owner: fp.slug }));
    else list.forEach((t) => forbidden.push({ token: t, lower: t.toLowerCase(), owner: fp.slug }));
  }
}

/**
 * De quem é a pasta `apps/<X>/`? Derivado do fingerprint, com fail-fast.
 *
 * Existe porque a regra 1 nasceu mono-app: um `SLUG` vindo do manifesto, e os
 * outros fingerprints proibidos em TODO o repositório. Com os três apps no
 * mesmo repositório isso deixa de fazer sentido — `apps/stagent360/**` tem de
 * poder dizer "stagent", que é a identidade dele, e tem de NÃO poder dizer
 * "odontobox".
 *
 * O dono não é adivinhado por prefixo (`odontobox360` não começa igual a
 * `odontobox`): é o fingerprint cujo `strings` contém o nome exato da pasta.
 * Zero ou mais de um é erro — um app sem fingerprint não pode ser auditado, e
 * auditar com o dono errado é pior que não auditar.
 */
function donoDaPasta(nomeDaPasta) {
  const candidatos = fingerprintsTodos.filter((fp) =>
    deepStrings(fp.data.strings ?? []).some((t) => t.trim() === nomeDaPasta)
  );
  if (candidatos.length === 1) return candidatos[0].slug;
  err(
    candidatos.length === 0
      ? `apps/${nomeDaPasta}/ não tem fingerprint em ${FINGERPRINT_DIR}/ — crie um antes de auditar o app.`
      : `apps/${nomeDaPasta}/ casa com ${candidatos.length} fingerprints (${candidatos.map((c) => c.slug).join(', ')}) — ambíguo.`
  );
  return null;
}

/** O slug do app a que um caminho pertence, ou null para código compartilhado. */
function appDoCaminho(rel) {
  const m = rel.match(/^apps\/([^/]+)\//);
  if (!m) return null;
  if (!(m[1] in donoPorPasta)) donoPorPasta[m[1]] = donoDaPasta(m[1])
  return donoPorPasta[m[1]];
}
const donoPorPasta = {};

/** Tokens de TODOS os apps, com o dono — para a regra por pasta. */
const todosOsTokens = [];
for (const fp of fingerprintsTodos) {
  for (const [key, val] of Object.entries(fp.data)) {
    if (key === 'slug' || key === 'warnStrings' || key.startsWith('$')) continue;
    for (const t of deepStrings(val).map((x) => x.trim()).filter((x) => x.length >= 3 && !x.startsWith('<'))) {
      todosOsTokens.push({ token: t, lower: t.toLowerCase(), owner: fp.slug });
    }
  }
}

// ---------- 1. colisão manifesto × outros apps ----------
const manifestValues = deepStrings(manifest).map((s) => s.toLowerCase()).filter((s) => s.length >= 3);
for (const f of forbidden) {
  if (manifestValues.some((v) => v === f.lower || (f.lower.length >= 8 && v.includes(f.lower)))) {
    err(`infra/manifest.json contém "${f.token}", que pertence ao app "${f.owner}"`);
  }
}

// ---------- 2. varredura do repositório ----------
let files;
try { files = arquivosDoGit(); } catch { files = walk(ROOT); }
for (const { rel, binary } of files) {
  const relLower = rel.toLowerCase();
  /*
   * O dono da pasta: dentro de `apps/<X>/` o proibido são os OUTROS apps, não
   * os "outros" do manifesto. Fora de `apps/`, segue a lista global (código
   * compartilhado não fala de app nenhum — e a regra de proibir TODOS os
   * identificadores em `packages/**` entra quando o vocabulário sair do core,
   * porque hoje ela reprovaria ~14 componentes que dizem o nome do 1º app).
   */
  const dono = appDoCaminho(rel);
  const proibidosAqui = dono === null
    ? forbidden
    : todosOsTokens.filter((t) => t.owner !== dono);

  for (const f of proibidosAqui) {
    if (relLower.includes(f.lower)) err(`Nome de arquivo ${rel} contém "${f.token}" (app "${f.owner}")`);
  }
  if (binary) continue;
  let text;
  try { text = readFileSync(join(ROOT, rel), 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  const lower = text.toLowerCase();
  for (const f of proibidosAqui) {
    if (!lower.includes(f.lower)) continue;
    const ln = lines.findIndex((l) => l.toLowerCase().includes(f.lower)) + 1;
    err(`${rel}:${ln} referencia "${f.token}" (app "${f.owner}")`);
  }
  for (const w of warnTokens) {
    if (!lower.includes(w.lower)) continue;
    const ln = lines.findIndex((l) => l.toLowerCase().includes(w.lower)) + 1;
    warn(`${rel}:${ln} contém termo do segmento "${w.token}" (revise se faz sentido neste produto)`);
  }
}

/* ----------  2b. identidade de app dentro do código compartilhado  ----------
 *
 * Agora ERRO, e não mais aviso contado.
 *
 * `packages/**` não contém identificador de app NENHUM — é o que força texto
 * novo a nascer pela marca e pelo vocabulário em vez de pelo nome do primeiro
 * app. Entrou como aviso contado em 14/11 (50 arquivos), e vira erro agora que
 * os dois sweeps acabaram.
 *
 * ## Duas exceções, e nenhuma é conveniência
 *
 * **Comentário não conta.** Mesma decisão do `lint-vocabulario`: explicar por
 * que algo existe — "era `odontobox` até 15/11" — não é texto que o usuário lê,
 * e proibi-lo ensina a escrever código sem explicação. São 27 ocorrências em
 * prosa histórica, e elas valem mais do que custam.
 *
 * **As chaves antigas de migração ficam**, por arquivo e com allowlist
 * conferida. `ler('som', ['odontobox360-sound-enabled'])` cita o nome antigo
 * porque é ele que está no navegador de quem usa o produto: apagar essa linha
 * apagaria a preferência de todo mundo. O nome antigo ali é a PROVA de que a
 * migração existe — o oposto de dívida.
 */
/**
 * Arquivos em que o nome antigo é a chave de MIGRAÇÃO, não dívida.
 *
 * Cada um passa o nome herdado como lista de `antigas` para `lib/armazenamento`,
 * que lê a chave nova e, na ausência dela, migra a velha. Apagar a linha
 * apagaria a preferência de quem já usa o produto.
 */
const CHAVES_DE_MIGRACAO = [
  'packages/core/src/hooks/useSoundEnabled.ts',
  'packages/core/src/components/shared/EmojiPicker.tsx',
  'packages/core/src/components/layout/Topbar.tsx',
  'packages/core/src/rotas/(dashboard)/atendimento/conversas/page.tsx',
];

/** O texto sem comentários — por análise de estado, não por regex. */
function semComentarios(src) {
  const out = [];
  let i = 0;
  let estado = 'codigo';
  while (i < src.length) {
    const c = src[i];
    const d = src.slice(i, i + 2);
    if (estado === 'codigo') {
      if (d === '/*') { estado = 'bloco'; i += 2; continue; }
      if (d === '//') { estado = 'linha'; i += 2; continue; }
      out.push(c); i++; continue;
    }
    if (estado === 'bloco') { if (d === '*/') { estado = 'codigo'; i += 2; } else i++; continue; }
    if (estado === 'linha') { if (c === '\n') { estado = 'codigo'; out.push(c); } i++; }
  }
  return out.join('');
}

const vazamentosNoCompartilhado = new Map();
const orfaosDaMigracao = CHAVES_DE_MIGRACAO.filter((p) => !files.some((f) => f.rel === p));
if (orfaosDaMigracao.length) {
  err(`CHAVES_DE_MIGRACAO cita ${orfaosDaMigracao.length} arquivo(s) que não existem: ${orfaosDaMigracao.join(', ')}`);
}
for (const { rel, binary } of files) {
  if (binary) continue;
  if (!rel.startsWith('packages/')) continue;
  if (IGNORE_PREFIXES.some((p) => rel.startsWith(p))) continue;
  if (CHAVES_DE_MIGRACAO.includes(rel)) continue;
  let texto;
  try { texto = semComentarios(readFileSync(join(ROOT, rel), 'utf8')).toLowerCase(); } catch { continue; }
  for (const t of todosOsTokens) {
    if (!texto.includes(t.lower)) continue;
    if (!vazamentosNoCompartilhado.has(rel)) vazamentosNoCompartilhado.set(rel, new Set());
    vazamentosNoCompartilhado.get(rel).add(`${t.token} (${t.owner})`);
  }
}
if (vazamentosNoCompartilhado.size > 0) {
  for (const [rel, toks] of vazamentosNoCompartilhado) {
    err(`${rel} cita identidade de app fora de comentário: ${[...toks].slice(0, 3).join(', ')}`);
  }
  err(
    'O nome do produto vem da marca — `BRAND().name` no servidor, `useMarca().name` no ' +
    'cliente. Prefixo de cookie, chave de armazenamento e nome de instância vêm de ' +
    '`BRAND().slug`: ver lib/auth/cookies, lib/armazenamento, lib/whatsapp/instancia.'
  );
}

// ---------- 3. wrangler × manifesto ----------
const wranglerFile = ['wrangler.jsonc', 'wrangler.json', 'wrangler.toml'].find((f) => existsSync(f));
if (!wranglerFile) {
  warn('Nenhum wrangler.jsonc/json/toml encontrado na raiz — validação de bindings ignorada.');
} else {
  const raw = readFileSync(wranglerFile, 'utf8');

  if (raw.includes(PLACEHOLDER)) {
    (STRICT ? err : warn)(`${wranglerFile} ainda contém placeholders ${PLACEHOLDER}`);
  }

  const appLevelIds = hexIds(JSON.stringify({ ...manifest, environments: undefined }));
  const envIds = Object.fromEntries(ENV_NAMES.map((e) => [e, hexIds(JSON.stringify(envs[e]))]));
  const allManifestIds = new Set([...appLevelIds, ...Object.values(envIds).flatMap((s) => [...s])]);

  for (const id of hexIds(raw)) {
    if (!allManifestIds.has(id)) err(`${wranglerFile} contém o ID ${id}, que não consta em infra/manifest.json`);
  }

  if (wranglerFile === 'wrangler.toml') {
    warn('wrangler.toml: validação por ambiente não suportada (apenas checagem global de IDs). Considere migrar para wrangler.jsonc.');
  } else {
    let cfg;
    try { cfg = JSON.parse(stripJsonc(raw)); } catch (e) { err(`Não foi possível interpretar ${wranglerFile}: ${e.message}`); }
    if (cfg) {
      const otherEnv = (e) => ENV_NAMES.filter((x) => x !== e);

      // 3a. raiz (dev local) não pode apontar para produção
      const { env: _envBlock, ...rootCfg } = cfg;
      const rootText = JSON.stringify(rootCfg);
      for (const id of hexIds(rootText)) {
        if (envIds.production?.has(id) && !appLevelIds.has(id)) {
          err(`Configuração raiz do ${wranglerFile} (usada sem --env) aponta para recurso de PRODUÇÃO: ${id}`);
        }
      }
      for (const b of rootCfg.r2_buckets || []) {
        const prodBuckets = (envs.production?.cloudflare?.r2 || []).map((x) => x.name);
        if (prodBuckets.includes(b.bucket_name)) err(`Configuração raiz usa o bucket de PRODUÇÃO ${b.bucket_name}`);
      }

      // 3b. cada ambiente
      for (const e of ENV_NAMES) {
        const sec = cfg.env?.[e];
        if (!sec) { err(`${wranglerFile}: bloco env.${e} ausente`); continue; }
        const m = envs[e];
        const secText = JSON.stringify(sec);

        if (m?.cloudflare?.worker && sec.name && sec.name !== m.cloudflare.worker) {
          err(`env.${e}.name = "${sec.name}", esperado "${m.cloudflare.worker}"`);
        }
        if (!sec.name) warn(`env.${e}.name não definido (o wrangler gerará "<name>-${e}"). Defina explicitamente "${m?.cloudflare?.worker}".`);

        for (const id of hexIds(secText)) {
          if (appLevelIds.has(id)) continue;
          if (!envIds[e].has(id)) {
            const owner = otherEnv(e).find((o) => envIds[o].has(id));
            err(owner
              ? `env.${e} referencia ${id}, que pertence ao ambiente "${owner}"`
              : `env.${e} referencia ${id}, que não consta em manifest.environments.${e}`);
          }
        }

        const allowedBuckets = (m?.cloudflare?.r2 || []).map((x) => x.name);
        for (const b of sec.r2_buckets || []) {
          if (b.bucket_name === PLACEHOLDER) continue;
          if (!allowedBuckets.includes(b.bucket_name)) err(`env.${e} usa o bucket "${b.bucket_name}", fora do manifesto deste ambiente`);
        }

        const allowedQueues = (m?.cloudflare?.queues || []).map((x) => x.name);
        const q = sec.queues || {};
        for (const p of [...(q.producers || []), ...(q.consumers || [])]) {
          if (p.queue === PLACEHOLDER) continue;
          if (p.queue && !allowedQueues.includes(p.queue)) err(`env.${e} usa a queue "${p.queue}", fora do manifesto deste ambiente`);
        }

        const allowedHosts = deepStrings(m?.hostnames || {}).map((h) => h.toLowerCase());
        const routes = [...(sec.routes || []), ...(sec.route ? [sec.route] : [])];
        for (const r of routes) {
          const pattern = typeof r === 'string' ? r : r.pattern;
          if (!pattern || pattern === PLACEHOLDER) continue;
          const host = pattern.replace(/^https?:\/\//, '').split('/')[0].replace(/^\*\.?/, '').toLowerCase();
          if (!allowedHosts.includes(host)) err(`env.${e} tem rota "${pattern}" fora dos hostnames do manifesto deste ambiente`);
        }

        // vars não podem apontar para hostnames de outro ambiente
        // (comparação com fronteira: "homolog.stagent.venn360.com" NÃO casa com "stagent.venn360.com";
        //  e-mails como "suporte@host" são ignorados)
        const varsText = JSON.stringify(sec.vars || {}).toLowerCase();
        for (const o of otherEnv(e)) {
          const oh = envs[o]?.hostnames || {};
          for (const h of [oh.app, oh.evolution, oh.emailDomain].filter(Boolean)) {
            const hl = h.toLowerCase();
            if (allowedHosts.includes(hl)) continue;
            const re = new RegExp(`(?<![a-z0-9.@-])${hl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9-])`);
            if (re.test(varsText)) err(`env.${e}.vars referencia o hostname "${h}", do ambiente "${o}"`);
          }
        }

        const slugVar = sec.vars?.APP_SLUG;
        if (slugVar && slugVar !== SLUG) err(`env.${e}.vars.APP_SLUG = "${slugVar}", esperado "${SLUG}"`);
        const envVar = sec.vars?.APP_ENV;
        if (envVar && envVar !== e) err(`env.${e}.vars.APP_ENV = "${envVar}", esperado "${e}"`);
      }
    }
  }
}

// ---------- saída ----------
const head = `Auditoria de isolamento — app "${SLUG}"${STRICT ? ' (strict)' : ''} — ${files.length} arquivos, ${forbidden.length} identificadores proibidos de ${fingerprints.length} outro(s) app(s)`;
console.log(head);
for (const w of warnings) console.log(`  ⚠ ${w}`);
for (const e of errors) console.log(`  ✖ ${e}`);
if (errors.length) {
  console.log(`\nFALHOU: ${errors.length} erro(s). Não faça deploy nem rode migrations. Não desabilite esta auditoria (R12).`);
  process.exit(1);
}
console.log(`\nOK: nenhum vazamento de identidade encontrado${warnings.length ? ` (${warnings.length} aviso(s) para revisar)` : ''}.`);
