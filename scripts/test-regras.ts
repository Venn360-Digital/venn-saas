/**
 * Os casos da sincronização das Regras de ação.
 *
 *   npm run test:regras
 *
 * Existe por um defeito medido: **excluir uma regra na tela não excluía no
 * banco.** O salvar percorria o array atual e mandava `PATCH` para quem tinha id
 * e `POST` para quem não tinha; não havia terceiro caminho, então a regra
 * removida continuava gravada, com `isActive: true`, e continuava rodando a cada
 * mensagem recebida — antes do agente. A rota `DELETE` existia e nenhum arquivo
 * do front a chamava.
 *
 * `idsParaApagar` é a decisão, e é pura: compara o que veio do servidor com o
 * que está na tela. Errar aqui tem dois lados, e os dois são silenciosos —
 * apagar o id errado remove a regra de outra pessoa, e não apagar é o defeito de
 * origem.
 */
import { idsParaApagar } from '@/lib/rules/sincronizar'

let passou = 0
let falhou = 0

function conferir(nome: string, real: unknown, esperado: unknown) {
    const a = JSON.stringify(real)
    const b = JSON.stringify(esperado)
    if (a === b) {
        passou++
        console.log(`  ok  ${nome}`)
    } else {
        falhou++
        console.log(`  XX  ${nome}\n        esperado: ${b}\n        veio:     ${a}`)
    }
}

console.log('\nO que a gravação tem de apagar')

conferir(
    'nada removido, nada a apagar',
    idsParaApagar(['a', 'b'], [{ id: 'a' }, { id: 'b' }]),
    []
)
conferir(
    'uma regra removida da tela vira um DELETE',
    idsParaApagar(['a', 'b'], [{ id: 'a' }]),
    ['b']
)
conferir(
    'todas removidas: todas apagadas',
    idsParaApagar(['a', 'b', 'c'], []),
    ['a', 'b', 'c']
)
conferir(
    'ordem é a do servidor, para a sequência de chamadas ser previsível',
    idsParaApagar(['a', 'b', 'c'], [{ id: 'b' }]),
    ['a', 'c']
)

/**
 * O caso que um `filter` ingênuo sobre o array da tela erraria: regra criada e
 * removida **sem nunca ter sido salva** não tem id, não existe no servidor, e
 * não pode gerar chamada nenhuma.
 */
conferir(
    'regra nova e removida antes de salvar não gera DELETE',
    idsParaApagar([], [{}]),
    []
)
conferir(
    'regra nova conviva com regra do servidor sem confundir a conta',
    idsParaApagar(['a'], [{ id: 'a' }, {}]),
    []
)
conferir(
    'regra nova na tela não salva a removida do servidor',
    idsParaApagar(['a'], [{}]),
    ['a']
)

conferir(
    'id repetido no servidor é apagado uma vez só',
    idsParaApagar(['a', 'a', 'b'], []),
    ['a', 'b']
)
conferir(
    'id vazio não vira chamada',
    idsParaApagar(['', 'a'], []),
    ['a']
)
conferir(
    'lista do servidor vazia nunca manda apagar',
    idsParaApagar([], [{ id: 'a' }]),
    []
)

/**
 * O segundo salvar seguido. O hook reescreve a lista do servidor depois de
 * gravar; estes dois casos travam o efeito disso.
 */
conferir(
    'depois de apagar, salvar de novo não repete o DELETE',
    idsParaApagar(['a'], [{ id: 'a' }]),
    []
)
conferir(
    'regra recém-criada entra na conta do salvar seguinte',
    idsParaApagar(['a', 'novo'], [{ id: 'a' }]),
    ['novo']
)

console.log(`\n${passou} ok, ${falhou} falha(s)\n`)
process.exit(falhou > 0 ? 1 : 0)
