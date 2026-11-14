/**
 * O que a gravação das regras tem de **apagar** — a parte que faltava.
 *
 * ## O defeito que isto conserta
 *
 * A tela de Regras de ação removia a regra do array local e o salvar mandava
 * `PATCH` para quem tinha id e `POST` para quem não tinha. Não havia terceiro
 * caminho, então **a regra apagada na tela continuava no banco**, com
 * `isActive: true`, e continuava rodando a cada mensagem recebida — antes do
 * agente, que é o lugar mais consequente que uma regra pode ocupar.
 *
 * A gravidade depende da ação: uma regra de `send_message` segue respondendo ao
 * paciente, e uma de `notify_human` segue transferindo a conversa e silenciando
 * o agente. A rota `DELETE` existia, funcionava, e nenhum arquivo do front a
 * chamava.
 *
 * ## Por que isto é função pura
 *
 * A decisão é comparar duas listas, e é a parte que erra em silêncio: apagar o
 * id errado remove a regra de outra pessoa, e deixar de apagar é o defeito de
 * origem. Fora do hook ela é exercitável por `npm run test:regras`, sem
 * navegador e sem banco — o mesmo arranjo de `lib/rag/secoes.ts`.
 */

/** O mínimo que a sincronização lê de uma regra. */
export interface RegraComId {
    id?: string
}

/**
 * Os ids que estavam no servidor e não estão mais na tela.
 *
 * `carregados` são os ids que vieram do `GET` ao abrir a tela — é essa lista que
 * define o que **existe no banco**. Regra criada e removida sem nunca ter sido
 * salva não tem id e não entra em nenhuma das duas pontas, então não gera
 * chamada: era o caso que um `filter` ingênuo sobre o array da tela erraria.
 *
 * Devolve sem repetição e na ordem de `carregados`, para a sequência de
 * chamadas ser previsível quando uma delas falhar.
 */
export function idsParaApagar(carregados: string[], naTela: RegraComId[]): string[] {
    const vivos = new Set(naTela.map((r) => r.id).filter((id): id is string => Boolean(id)))
    const vistos = new Set<string>()

    return carregados.filter((id) => {
        if (!id || vivos.has(id) || vistos.has(id)) return false
        vistos.add(id)
        return true
    })
}
