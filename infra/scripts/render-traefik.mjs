#!/usr/bin/env node
/**
 * Render infra/traefik/dynamic.yaml from its template.
 *
 * The Traefik file provider does not expand environment variables in a plain
 * .yaml, so the hostname is substituted here instead. Run this on its own if the
 * hostnames change without regenerating secrets.
 *
 * Usage: node infra/scripts/render-traefik.mjs [--api-host api.example.com]
 *        (falls back to API_HOST in infra/.env)
 */
import fs from 'node:fs'
import path from 'node:path'

const infraDir = path.resolve(import.meta.dirname, '..')

function apiHostFromArgs() {
    const args = process.argv.slice(2)
    const i = args.indexOf('--api-host')
    return i !== -1 ? args[i + 1] : undefined
}

function apiHostFromEnvFile() {
    const envPath = path.join(infraDir, '.env')
    if (!fs.existsSync(envPath)) return undefined
    const match = fs.readFileSync(envPath, 'utf8').match(/^API_HOST=(.+)$/m)
    return match?.[1].trim()
}

export function renderTraefik(apiHost) {
    const templatePath = path.join(infraDir, 'traefik', 'dynamic.yaml.template')
    const outputPath = path.join(infraDir, 'traefik', 'dynamic.yaml')

    const rendered = fs
        .readFileSync(templatePath, 'utf8')
        .replaceAll('__API_HOST__', apiHost)
        .replace('# Traefik file provider — TEMPLATE.', '# GENERATED from dynamic.yaml.template — edit the template, not this file.')

    fs.writeFileSync(outputPath, rendered)
    return outputPath
}

// Only act when invoked directly, so generate-secrets.mjs can import renderTraefik.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
    const apiHost = apiHostFromArgs() ?? apiHostFromEnvFile()

    if (!apiHost) {
        console.error('No API host given and API_HOST not found in infra/.env')
        console.error('Usage: node infra/scripts/render-traefik.mjs --api-host api.example.com')
        process.exit(1)
    }

    console.log(`Wrote ${renderTraefik(apiHost)} for host "${apiHost}"`)
}
