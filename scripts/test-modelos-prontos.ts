/**
 * Os cinco modelos de proposta são válidos, e não prometem nada.
 *
 *     npm run test:modelos
 *
 * ## Por que isto existe
 *
 * Os modelos são **dado escrito à mão** que atravessa o schema de seções e
 * chega ao documento que o cliente lê. Duas coisas podem dar errado em
 * silêncio, e as duas já deram neste módulo:
 *
 * 1. **Forma inválida.** Uma seção com campo errado é recusada por `lerSecoes`
 *    no caminho de leitura, e o modelo vira texto vazio na tela — exatamente o
 *    sintoma que a semente da v1 produziu e que levou dias para ser entendido.
 * 2. **Compromisso preenchido.** Preço, prazo e garantia são de quem assina. A
 *    IA é impedida disso em código por `esvaziarCompromissos`; um modelo nosso
 *    que viesse com "garantia de 12 meses" comprometeria a unidade sem ninguém
 *    ter decidido, e nenhum portão veria.
 *
 * Provado no sentido de falhar: preenchendo o prazo de uma fase, reprova.
 */
import './lib/marca-de-teste.ts'

import { modelosProntos } from '@venn/core/lib/propostas/modelos-prontos'
import { secoesSchema, ehPagina } from '@venn/core/lib/propostas/secoes'
import { lerTema, temaParaJson } from '@venn/core/lib/propostas/tema'
import type { Vocabulario } from '@venn/core/lib/vocabulario'

let passou = 0
let falhou = 0
function conferir(nome: string, real: unknown, esperado: unknown) {
    const a = JSON.stringify(real)
    const b = JSON.stringify(esperado)
    if (a === b) { passou++; console.log(`  ok  ${nome}`) }
    else { falhou++; console.log(`  XX  ${nome}\n        esperado: ${b}\n        veio:     ${a}`) }
}

/** O vocabulário de uma clínica, que é o caso de uso real. */
const v = {
    genero: { organizacao: 'f', pessoa: 'm', profissional: 'm', servico: 'm' },
    organizacao: 'clínica', Organizacao: 'Clínica', organizacoes: 'clínicas', Organizacoes: 'Clínicas',
    pessoa: 'paciente', Pessoa: 'Paciente', pessoas: 'pacientes', Pessoas: 'Pacientes',
    profissional: 'profissional', Profissional: 'Profissional', profissionais: 'profissionais', Profissionais: 'Profissionais',
    servico: 'procedimento', Servico: 'Procedimento', servicos: 'procedimentos', Servicos: 'Procedimentos',
} as unknown as Vocabulario

const modelos = modelosProntos(v)

console.log(`\nOs modelos de proposta — ${modelos.length} na escada`)

conferir('são cinco, como a premissa pede', modelos.length, 5)
conferir('as chaves são únicas', new Set(modelos.map((m) => m.chave)).size, 5)
conferir('os nomes são únicos (entram no @@unique do banco)', new Set(modelos.map((m) => m.nome)).size, 5)

// ── a forma ─────────────────────────────────────────────────────────────────
for (const m of modelos) {
    const r = secoesSchema.safeParse(m.secoes)
    conferir(`"${m.nome}": as seções passam no schema`, r.success, true)
    if (!r.success) console.log('        ' + JSON.stringify(r.error.issues.slice(0, 2)))
    conferir(`"${m.nome}": os ids são únicos`, new Set(m.secoes.map((s) => s.id)).size, m.secoes.length)
    conferir(`"${m.nome}": o tema sobrevive à ida e volta por JSON`, lerTema(temaParaJson(m.tema)), m.tema)
}

// ── a escada ────────────────────────────────────────────────────────────────
const tamanhos = modelos.map((m) => m.secoes.length)
conferir(
    'a escada cresce: cada modelo tem ao menos tantas seções quanto o anterior',
    tamanhos.every((n, i) => i === 0 || n >= tamanhos[i - 1]),
    true
)
conferir('o primeiro não tem capa (é a folha única)', modelos[0].secoes.some((s) => s.tipo === 'capa'), false)
conferir('os outros quatro têm capa', modelos.slice(1).every((m) => m.secoes.some((s) => s.tipo === 'capa')), true)
conferir('o último tem capa escura e três acentos', [modelos[4].tema.capa, modelos[4].tema.acentos.length], ['escura', 3])
conferir('todo modelo tem itens e aceite', modelos.every((m) => m.secoes.some((s) => s.tipo === 'itens') && m.secoes.some((s) => s.tipo === 'aceite')), true)
conferir('e as seções de página existem onde devem', modelos[4].secoes.filter((s) => ehPagina(s.tipo)).length > 0, true)

// ── nenhum compromisso preenchido ───────────────────────────────────────────
//
// A asserção que mais importa. Prometer é de quem assina.
const compromissos: string[] = []
for (const m of modelos) {
    for (const s of m.secoes) {
        if (s.tipo === 'destaques') for (const i of s.itens) if (i.valor.trim()) compromissos.push(`${m.nome}/destaque "${i.rotulo}" = ${i.valor}`)
        if (s.tipo === 'fases') for (const f of s.fases) if ((f.prazo ?? '').trim()) compromissos.push(`${m.nome}/fase "${f.nome}" prazo = ${f.prazo}`)
        if (s.tipo === 'garantia') for (const b of s.blocos) if (b.texto.trim()) compromissos.push(`${m.nome}/garantia "${b.titulo}"`)
        if (s.tipo === 'investimento') {
            for (const c of s.cartoes) {
                // Variável é permitida: ela vem do cálculo, não da nossa caneta.
                const digitado = c.valor.trim() && !/^\{\{[^}]+\}\}$/.test(c.valor.trim())
                if (digitado) compromissos.push(`${m.nome}/investimento "${c.titulo}" = ${c.valor}`)
            }
        }
    }
}
conferir('nenhum modelo preenche prazo, garantia ou valor de resultado', compromissos, [])

// ── o dinheiro é variável, nunca literal ────────────────────────────────────
const comTotal = modelos.filter((m) =>
    m.secoes.some((s) => s.tipo === 'investimento' && s.cartoes.some((c) => c.valor === '{{documento.total}}'))
)
conferir('onde há investimento, o total vem de variável', comTotal.length, 3)

const literalDeDinheiro = JSON.stringify(modelos).match(/R\$\s*\d/g) ?? []
conferir('e não há um único valor em reais escrito à mão', literalDeDinheiro, [])

console.log(`\n${passou} ok, ${falhou} falha(s)\n`)
process.exit(falhou > 0 ? 1 : 0)
