#!/usr/bin/env tsx
/**
 * Nenhum módulo do core lê a marca na própria avaliação.
 *
 * ## O que isto pega, e como descobri que faltava
 *
 * `check-marca.mjs` garante QUEM registra e em que ORDEM. Não garante QUANDO a
 * marca é lida — e é essa a falha que derrubou o deploy de preview de 14/11:
 *
 *     [10021] Uncaught Error: MarcaNaoRegistradaError
 *       at ./_next/static/marca-*.js in r
 *       at ./_next/static/billing-*.js in c
 *
 * O build compilou inteiro (3min22s) e a Cloudflare reprovou na PUBLICAÇÃO: ela
 * avalia os módulos do Worker para validar o script, e nessa avaliação não
 * houve requisição nenhuma — logo, ninguém havia registrado a marca. Um `const`
 * de nível de módulo que chama `BRAND()` quebra o Worker no startup, e nenhum
 * typecheck, lint ou teste estático vê isso.
 *
 * O fail-fast de `BRAND()` fez o seu trabalho: apareceu no preview, não em
 * produção. O que faltava era uma rede que o fizesse aparecer ANTES do build.
 *
 * ## Como prova
 *
 * Importa cada módulo que lê a marca **sem registrar nada**. Se o import
 * lançar `MarcaNaoRegistradaError`, aquele módulo lê a marca cedo. É a mesma
 * coisa que a Cloudflare faz ao validar o script, dois minutos antes em vez de
 * dois minutos depois.
 *
 * A lista é derivada, não escrita à mão: todo arquivo de `packages/core` que
 * menciona `BRAND(` entra. Assim um módulo novo não escapa por ninguém ter se
 * lembrado de acrescentá-lo.
 */
import { readFileSync } from 'node:fs'
import { arquivosDeCodigo } from './lib/raizes-de-codigo.mjs'

const candidatos = arquivosDeCodigo()
    .filter((f) => f.startsWith('packages/core/src/'))
    .filter((f) => !f.endsWith('marca.ts') && !f.endsWith('marca-contexto.tsx'))
    .filter((f) => /\bBRAND\s*\(/.test(readFileSync(f, 'utf8')))

if (candidatos.length === 0) {
    console.log('nenhum módulo do core lê a marca — nada a verificar')
    process.exit(0)
}

const eager: string[] = []
for (const f of candidatos) {
    // caminho relativo a este script, para o tsx resolver o módulo real
    const especificador = '../' + f
    try {
        await import(especificador)
    } catch (e) {
        const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
        if (msg.includes('MarcaNaoRegistrada')) {
            eager.push(f)
        } else {
            // Outro erro de import (falta de env, por exemplo) não é o que se
            // mede aqui: se o módulo tivesse lido a marca cedo, o erro seria o
            // da marca, que acontece antes.
            console.log(`  (ignorado) ${f} — ${msg.slice(0, 80)}`)
        }
    }
}

console.log(`marca tardia: ${candidatos.length} módulo(s) do core leem a marca`)
if (eager.length > 0) {
    console.error(`\n✖ ${eager.length} módulo(s) leem a marca na AVALIAÇÃO, não no uso:`)
    for (const f of eager) console.error(`    ${f}`)
    console.error(
        '\nIsto quebra o Worker no startup: a Cloudflare avalia os módulos para\n' +
        'validar o script, e ali não há requisição nem marca registrada. Foi assim\n' +
        'que o deploy de preview reprovou em 14/11, depois de o build compilar.\n\n' +
        'Tire a leitura do nível de módulo. As três formas que já usamos:\n' +
        '  · `const X = BRAND().y`           → `const X = () => BRAND().y`\n' +
        '  · objeto com valores interpolados → objeto com `get` (ver CAMINHOS)\n' +
        '  · template string de módulo       → função que a devolve\n'
    )
    process.exit(1)
}
console.log('nenhum deles a lê na avaliação do módulo.')
