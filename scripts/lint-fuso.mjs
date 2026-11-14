#!/usr/bin/env node
/**
 * Impede conta de calendário em hora local no código de SERVIDOR.
 *
 * ## O defeito que isto existe para não deixar voltar
 *
 * O fuso do negócio é **−03**, e isso é decisão do produto: a clínica pensa em
 * horário de Brasília. Mas o runtime onde o código roda **não é** −03, e não
 * pode ser:
 *
 *   - o Worker da Cloudflare roda em **UTC** e ignora `TZ` — não há variável
 *     que mude isso (medido; ver a memória `fuso-workers-ignora-tz`);
 *   - o Postgres guarda `timestamptz` em **UTC**, que é o certo.
 *
 * Então "padrão −03" não se implementa configurando o runtime. Implementa-se
 * fazendo **todo lugar que decide ou exibe por hora local passar por
 * `lib/fuso.ts`**, que converte pelo `Intl` no `FUSO_DO_NEGOCIO`.
 *
 * Quando isso falha, falha em silêncio. Em 2026-10-24 o eixo do gráfico do
 * painel montava o rótulo com `day.getDate()`: um instante de
 * `2026-10-24T01:00Z` é dia 24 em UTC e **dia 23 em Brasília**. O número
 * aparecia, parecia certo, e era o dia errado — na virada, todo dia.
 *
 * ## O que é proibido, e o que não é
 *
 * Proibido: ler parte de calendário em hora local — `getHours`, `getDate`,
 * `getMonth`, `getDay`, `getFullYear`, `getMinutes`.
 *
 * **Permitido, e por isso não é marcado:** aritmética de dias no formato
 * `x.setDate(x.getDate() + N)`. Ela desloca o instante por N dias usando o
 * mesmo quadro nos dois lados, então o resultado independe do fuso — e o
 * Brasil não tem horário de verão desde 2019, que é o único caso em que
 * divergiria.
 *
 * Também fora: `src/lib/fuso.ts` (é a implementação), `src/generated/` e todo
 * `.tsx`. No navegador a hora local **é** a da pessoa, e usá-la ali é correto.
 *
 * ## Linha de base que só desce
 *
 * Mesmo contrato de `lint-workspace.mjs`: o número pode cair e nunca subir.
 * `--update` grava o valor atual, e é para usar **depois** de remover uma
 * ocorrência, nunca para calar uma nova.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { arquivosDeCodigo, exigirPiso, conferirAllowlist } from './lib/raizes-de-codigo.mjs'

const RAIZ = process.cwd()
const BASELINE = join(RAIZ, 'scripts', 'fuso-baseline.json')

/**
 * Só servidor: aqui o relógio é UTC e a hora local é mentira.
 *
 * São SUBcaminhos dentro de cada raiz de código, não caminhos absolutos a
 * partir do repositório. Antes eram `src/app/api`, `src/trabalhos`, `src/lib`
 * e `src/cloudflare` fixos — as quatro pastas que a Fase 2 leva para
 * `packages/core`. Fixas, elas deixariam este lint varrendo o vazio e
 * aprovando: 407 arquivos hoje, zero depois do `git mv`, e "nenhuma conta de
 * calendário em hora local" continuaria sendo impresso.
 */
const PASTAS = ['app/api', 'trabalhos', 'lib', 'cloudflare']

const ISENTOS = [
    // A implementação. O prefixo é explícito, e não um sufixo tolerante, de
    // propósito: quando o arquivo mudar de pacote, `conferirAllowlist` reprova
    // no commit que o move — que é o único momento em que alguém sabe para
    // onde ele foi. `src/generated/` saiu da lista: o módulo de raízes já
    // exclui toda pasta `generated`, em qualquer pacote.
    'src/lib/fuso.ts',
]

const PROIBIDO = /\.(getHours|getDate|getMonth|getDay|getFullYear|getMinutes)\(\)/g

/** `x.setDate(x.getDate() + N)` — desloca dias, independe do fuso. */
const ARITMETICA_DE_DIAS = /\.set(Date|Month|FullYear)\(\s*[A-Za-z_$][\w$]*\.get(Date|Month|FullYear)\(\)\s*[+-]/

// Só `.ts`: componente não faz conta de calendário no servidor, e incluir
// `.tsx` encheria o resultado de hora local legítima de tela.
const varridos = arquivosDeCodigo(PASTAS).filter((f) => f.endsWith('.ts'))
exigirPiso('lint-fuso', varridos, 200)
conferirAllowlist('lint-fuso', ISENTOS, varridos)

const achados = []

{
    for (const rel of varridos) {
        if (ISENTOS.some((i) => rel.startsWith(i) || rel === i)) continue

        const linhas = readFileSync(join(RAIZ, rel), 'utf8').split('\n')
        linhas.forEach((linha, i) => {
            const semComentario = linha.replace(/\/\/.*$/, '')
            const cru = semComentario.trim()
            if (cru.startsWith('*') || cru.startsWith('/*')) return
            if (!PROIBIDO.test(semComentario)) return
            PROIBIDO.lastIndex = 0
            if (ARITMETICA_DE_DIAS.test(semComentario)) return
            achados.push(`${rel}:${i + 1}  ${cru.slice(0, 90)}`)
        })
    }
}

const total = achados.length

if (process.argv.includes('--update')) {
    writeFileSync(BASELINE, JSON.stringify({ total }, null, 2) + '\n')
    console.log(`linha de base gravada: ${total}`)
    process.exit(0)
}

let base = { total: 0 }
try {
    base = JSON.parse(readFileSync(BASELINE, 'utf8'))
} catch {
    /* sem linha de base: trata como zero */
}

if (total > base.total) {
    console.error(
        `Conta de calendário em hora local no servidor: ${total}, e a linha de base é ${base.total}.\n` +
            'O Worker roda em UTC — getDate() ali devolve o dia de UTC, não o da clínica.\n' +
            'Use lib/fuso.ts: partesNoFuso, diaNoFuso, horaNoFuso.\n'
    )
    for (const a of achados) console.error(`  ${a}`)
    process.exit(1)
}

if (total < base.total) {
    console.log(
        `Caiu de ${base.total} para ${total}. Rode \`npm run lint:fuso -- --update\` para fixar.`
    )
} else {
    console.log(`Nenhuma conta de calendário em hora local nova no servidor (${total}).`)
}
