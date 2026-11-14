#!/usr/bin/env node
/**
 * Nenhum verificador escreve o caminho de um arquivo que pode se mover.
 *
 * ## Por que isto existe
 *
 * Em 14/11/2026 o mesmo defeito apareceu SEIS vezes num dia, enquanto ~800
 * arquivos mudavam de lugar na Fase 2 do monorepo:
 *
 * | onde | como falhou |
 * |---|---|
 * | pathspec do `git diff` | 71 migrações movidas contaram como novas → 3 builds reprovados |
 * | raiz fixa dos linters | varreria árvore vazia e **aprovaria** |
 * | `exclude` do tsconfig | 627 erros em arquivos que ninguém tocou |
 * | `readFileSync('src/…')` | ENOENT num verificador; silêncio noutro |
 * | `'cloudflare.config.ts'` | ENOENT em dois verificadores |
 * | lista de `globals.css` | entrada obsoleta parecia só "ausente" |
 *
 * O padrão: **caminho literal em ferramenta não sobrevive a `git mv`, e quase
 * nunca falha dizendo isso.** Metade das formas não errou — aprovou.
 *
 * Os resolvedores existem para isso (`resolverNoCodigo` pelo sufixo do
 * caminho, `configuracoesDeApp` para config de app), e **lançam** quando não
 * acham. Este lint é o que garante que ninguém volte a escrever o caminho à
 * mão — inclusive eu, que escrevi os resolvedores e ainda assim deixei três
 * casos para trás, achados um a um por falha de build.
 *
 * A Fase 3 move 228 arquivos de rota. Sem isto, seria a sétima vez.
 *
 * ## O que ele NÃO pega, declarado
 *
 * Procura o nome da função, então um import com alias
 * (`readFileSync as ler`) escapa — descobri isso ao escrever o próprio teste
 * de prova, que usou um alias e passou calado. Falso negativo aceito: alias de
 * `fs` não é uso corrente aqui, e alargar a regra para qualquer chamada com
 * string que pareça caminho reprovaria mensagem de erro e comentário, que é o
 * caminho curto para um lint que se aprende a ignorar.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const DIR = 'scripts'

/** Chamadas de sistema de arquivos cujo primeiro argumento é inspecionado. */
const LEITURAS = /\b(?:fs\.)?(readFileSync|existsSync|readdirSync|statSync)\s*\(\s*(['"`])([^'"`]+)\2/g

/**
 * Um caminho é "movível" quando aponta para código ou configuração de app.
 *
 * `infra/`, `docs/` e `seeds/` ficam de fora: são diretórios da raiz que não
 * participam do movimento de pacotes. E um nome sem barra (`package.json`) é
 * da raiz por definição.
 */
function movivel(caminho) {
    if (/^(src|apps|packages)\//.test(caminho)) return true
    if (/\.(config|configs)\.ts$/.test(caminho)) return true
    if (/globals\.css$/.test(caminho)) return true
    return false
}

/**
 * Arquivos que legitimamente escrevem caminhos: os próprios resolvedores, e o
 * lint de migração, cujo `packages/db/prisma/migrations/` é alvo de FILTRO
 * sobre a saída do git, não leitura de disco.
 */
const ISENTOS = new Set(['lib/raizes-de-codigo.mjs', 'lint-migracoes.mjs', 'lint-caminhos.mjs'])

function arquivos(dir, base = '') {
    const saida = []
    for (const nome of readdirSync(dir)) {
        const caminho = join(dir, nome)
        const rel = base ? `${base}/${nome}` : nome
        if (nome === 'node_modules') continue
        try {
            if (readdirSync(caminho).length >= 0) {
                saida.push(...arquivos(caminho, rel))
                continue
            }
        } catch {
            // não é diretório
        }
        if (/\.(ts|mjs)$/.test(nome)) saida.push({ caminho, rel })
    }
    return saida
}

let falhas = 0
let conferidos = 0
for (const { caminho, rel } of arquivos(DIR)) {
    if (ISENTOS.has(rel)) continue
    conferidos++
    const texto = readFileSync(caminho, 'utf8')
    LEITURAS.lastIndex = 0
    let m
    while ((m = LEITURAS.exec(texto)) !== null) {
        const [, fn, , alvo] = m
        if (!movivel(alvo)) continue
        const linha = texto.slice(0, m.index).split('\n').length
        console.error(`✖ ${caminho}:${linha} — ${fn}('${alvo}') escreve um caminho que pode se mover.`)
        falhas++
    }
}

if (falhas > 0) {
    console.error(
        `\n${falhas} caminho(s) literal(is) em ${DIR}/.\n` +
        'Use um resolvedor de `scripts/lib/raizes-de-codigo.mjs`:\n' +
        "  · código:        resolverNoCodigo('trabalhos/processadores/cron/index.ts')\n" +
        "  · config de app: configuracoesDeApp('cloudflare.config.ts')\n" +
        'Os dois procuram nas raízes derivadas e LANÇAM se não acharem — que é a\n' +
        'diferença entre um verificador que mede e um que aprova o vazio.\n'
    )
    process.exit(1)
}
console.log(`caminhos: ${conferidos} verificador(es) sem caminho literal de código ou config`)
