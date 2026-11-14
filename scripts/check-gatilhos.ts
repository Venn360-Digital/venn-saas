/**
 * Prova que todo gatilho declarado tem quem o dispare.
 *
 *     npm run check:gatilhos
 *
 * ## Por que isto existe
 *
 * O funil entra por **chamada explícita** — e não pelo outbox, que é canal de
 * tela e tem tipos efêmeros e podados (a razão está em `lib/funil/gatilho.ts`).
 * O preço dessa escolha é o ponto de chamada esquecido, e a falha que ele produz
 * é a mais silenciosa que esta feature pode ter:
 *
 * O funil fica publicado. A tela o mostra ativo, com teto, com passos. E
 * ninguém entra. Nenhum erro, nenhum log, nenhuma exceção — porque não há
 * caminho de código a percorrer. O sintoma chega como "o funil não funciona",
 * semanas depois, de quem vendeu a feature.
 *
 * Então: todo tipo em `TIPOS_DE_GATILHO` precisa de (1) uma função de disparo em
 * `lib/funil/disparos.ts` e (2) pelo menos um ponto de chamada fora dela.
 *
 * ## O que este verificador NÃO afirma
 *
 * Que **todo** lugar que escreve a etiqueta, a etapa ou o contato dispara. Não
 * afirma, e seria mentira afirmar: `contacts/import` e a criação de contato
 * dentro do serviço de conversa estão de fora **de propósito** (um CSV de 5.000
 * pacientes mandaria 5.000 boas-vindas). O que ele garante é que nenhum tipo
 * está declarado e morto.
 */
// PRIMEIRO de todos: registra uma marca fictícia, porque este script roda
// código do core e o core PEDE a marca. Ver `./lib/marca-de-teste.ts`.
import './lib/marca-de-teste.ts'

import { readFileSync } from 'node:fs'
import { arquivosDeCodigo, exigirPiso, resolverNoCodigo } from './lib/raizes-de-codigo.mjs'

import { TIPOS_DE_GATILHO, TEXTO_DO_GATILHO, type TipoDeGatilho } from '@venn/core/lib/funil/gatilho'

let falhas = 0
const ok = (nome: string, cond: boolean, extra = '') => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${nome}${extra ? '  — ' + extra : ''}`)
    if (!cond) falhas++
}

/**
 * A função de disparo de cada tipo, em `lib/funil/disparos.ts`.
 *
 * Dois tipos podem apontar para a **mesma** função — ganho e perda saem de
 * `negocioFoiFechado`, porque são o mesmo fato do banco (o `status` do negócio
 * mudou para um desfecho) com dois valores. O que o verificador cobra então é a
 * conferência seguinte, "o disparo passa o tipo certo": a função precisa citar
 * os dois literais, senão um deles ficaria declarado e morto com este teste
 * passando.
 */
const DISPARO: Record<TipoDeGatilho, string> = {
    etiqueta_aplicada: 'etiquetaAplicada',
    etapa_do_negocio: 'negocioEntrouNaEtapa',
    entrou_na_lista: 'contatosEntraramNaLista',
    contato_criado: 'contatoCriado',
    negocio_ganho: 'negocioFoiFechado',
    negocio_perdido: 'negocioFoiFechado',
    clicou_na_campanha: 'clicouNaCampanha',
    manual: 'postoNoFunilAMao',
}

/**
 * Onde o disparo mora, procurado em vez de fixado.
 *
 * Era `'src/lib/funil/disparos.ts'`. Na Fase 2 `src/lib` FOI para
 * `packages/core`, e um caminho fixo aqui faria o `readFileSync` lançar — ou
 * pior, faria a lista de chamadores ficar vazia e todas as provas de "cada
 * disparo tem quem o chame" passarem sobre o nada.
 */
const SUFIXO_DOS_DISPAROS = 'lib/funil/disparos.ts'

const todos = arquivosDeCodigo()
exigirPiso('check-gatilhos', todos, 400)

const DISPAROS = todos.find((f) => f.endsWith(SUFIXO_DOS_DISPAROS))
if (!DISPAROS) {
    console.error(`\n✖ não achei nenhum arquivo terminando em "${SUFIXO_DOS_DISPAROS}".`)
    console.error('Sem ele não há o que verificar, e passar seria aprovar o nada.\n')
    process.exit(1)
}
const fonteDosDisparos = readFileSync(DISPAROS, 'utf8')

console.log('── Cada tipo tem função de disparo ──')

for (const tipo of TIPOS_DE_GATILHO) {
    const fn = DISPARO[tipo]
    ok(
        `${tipo} → ${fn}()`,
        new RegExp(`export async function ${fn}\\b`).test(fonteDosDisparos),
        fn ? '' : 'nenhuma função mapeada'
    )
}

console.log('')
console.log('── O disparo passa o tipo certo ──')

/**
 * A função de disparo tem de mencionar o próprio tipo. Sem isto, duas funções
 * poderiam disparar o mesmo gatilho e um tipo ficaria sem caminho — com os dois
 * testes acima passando.
 */
for (const tipo of TIPOS_DE_GATILHO) {
    ok(`'${tipo}' aparece em disparos.ts`, fonteDosDisparos.includes(`'${tipo}'`))
}

console.log('')
console.log('── Cada disparo tem quem o chame ──')

for (const tipo of TIPOS_DE_GATILHO) {
    const fn = DISPARO[tipo]
    const chamadores = todos.filter((caminho) => {
        if (caminho === DISPAROS) return false
        const fonte = readFileSync(caminho, 'utf8')
        // Chamada, não menção: `fn(` e não `fn` solto, para o próprio import
        // não contar como ponto de chamada.
        return new RegExp(`\\b${fn}\\(`).test(fonte)
    })

    ok(`${fn}() é chamado`, chamadores.length > 0, chamadores.join(', ') || 'NENHUM PONTO DE CHAMADA')
}

console.log('')
console.log('── O texto de tela existe para todos ──')

for (const tipo of TIPOS_DE_GATILHO) {
    const texto = TEXTO_DO_GATILHO[tipo]
    ok(`${tipo} tem rótulo`, typeof texto === 'string' && texto.length > 3, texto)
}

console.log('')
console.log('── A importação em massa continua FORA ──')

/**
 * Esta é a asserção invertida, e é a que mais importa depois das de cobertura.
 *
 * Alguém com boa intenção vai querer "completar" o gatilho de contato novo
 * ligando-o à importação. Um CSV de 5.000 pacientes dispararia 5.000 funis de
 * boas-vindas, e a clínica mandaria "seja bem-vindo" para quem é paciente dela
 * há dez anos — milhares de e-mails errados e a reputação do domínio queimada
 * antes da primeira campanha de verdade.
 *
 * Se a decisão mudar, muda **aqui**, junto do comentário que explica por quê.
 */
const naImportacao = readFileSync(resolverNoCodigo('rotas/api/contacts/import/route.ts'), 'utf8')
ok(
    'contacts/import não dispara funil',
    !/contatoCriado\(|talvezEntrarNoFunil\(/.test(naImportacao),
    'importação é migração de acervo, não chegada de gente nova'
)

const noServico = readFileSync(resolverNoCodigo('trabalhos/servicos/conversation.ts'), 'utf8')
ok(
    'o serviço de conversa não dispara funil',
    !/contatoCriado\(|talvezEntrarNoFunil\(/.test(noServico),
    'ali o agente de IA já responde; o funil falaria por cima'
)

console.log('')
if (falhas > 0) {
    console.log(`${falhas} FALHA(S)`)
    process.exitCode = 1
} else {
    console.log('tudo passou')
}
