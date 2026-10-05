#!/usr/bin/env node
/**
 * Render infra/traefik/dynamic.yaml from its template.
 *
 * The Traefik file provider does not expand environment variables in a plain
 * .yaml, so the domain is substituted here instead. Run this on its own if the
 * domain changes without regenerating secrets.
 *
 * Usage: node infra/scripts/render-traefik.mjs [--domain example.com]
 *        (falls back to DOMAIN in infra/.env)
 */
import fs from 'node:fs'
import path from 'node:path'

const infraDir = path.resolve(import.meta.dirname, '..')

function domainFromArgs() {
    const args = process.argv.slice(2)
    const i = args.indexOf('--domain')
    return i !== -1 ? args[i + 1] : undefined
}

function domainFromEnvFile() {
    const envPath = path.join(infraDir, '.env')
    if (!fs.existsSync(envPath)) return undefined
    const match = fs.readFileSync(envPath, 'utf8').match(/^DOMAIN=(.+)$/m)
    return match?.[1].trim()
}

export function renderTraefik(domain) {
    const templatePath = path.join(infraDir, 'traefik', 'dynamic.yaml.template')
    const outputPath = path.join(infraDir, 'traefik', 'dynamic.yaml')

    const rendered = fs
        .readFileSync(templatePath, 'utf8')
        .replaceAll('__DOMAIN__', domain)
        .replace('# Traefik file provider — TEMPLATE.', '# GENERATED from dynamic.yaml.template — edit the template, not this file.')

    fs.writeFileSync(outputPath, rendered)
    return outputPath
}

// Only act when invoked directly, so generate-secrets.mjs can import renderTraefik.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
    const domain = domainFromArgs() ?? domainFromEnvFile()

    if (!domain) {
        console.error('No domain given and DOMAIN not found in infra/.env')
        console.error('Usage: node infra/scripts/render-traefik.mjs --domain example.com')
        process.exit(1)
    }

    console.log(`Wrote ${renderTraefik(domain)} for domain "${domain}"`)
}
