import prisma from '@venn/db/cliente'

import { vocab, type Vocabulario } from './vocabulario'

/**
 * O vocabulário de UMA unidade, para código que roda fora de requisição.
 *
 * ## Por que existe, e por que separado de `vocab()`
 *
 * `vocab(settings)` resolve as duas camadas, mas exige que alguém já tenha o
 * `Workspace.settings` em mãos. Na tela isso é dado: `marcaDaSessao()` carrega
 * a unidade uma vez e o vocabulário desce resolvido pelo layout. Em fila, cron
 * e e-mail não há sessão — há um `workspaceId` no trabalho, e mais nada.
 *
 * Então este arquivo é o pedaço que faltava: do `workspaceId` ao vocabulário,
 * numa consulta que lê **só** `settings`.
 *
 * Mora separado de `lib/vocabulario.ts` de propósito. Aquele arquivo é folha —
 * só depende da marca — e é importado por `hooks/useVocab.tsx` para pegar o
 * tipo. Pôr `prisma` lá dentro criaria a chance de um `import` de valor
 * arrastar o cliente do banco para o bundle do navegador, que é a quinta forma
 * do defeito registrado em [[diretiva-nao-e-bundle]]: a diretiva `'use client'`
 * é a semente do bundle, não o fecho dele.
 *
 * ## Nunca lança, e nunca devolve palavra vazia
 *
 * Mesmo contrato de `vocab()`, pela mesma razão: isto é lido ao escrever
 * e-mail, montar prompt e redigir mensagem de WhatsApp. Unidade que não existe,
 * `settings` corrompido, banco fora do ar — tudo cai no padrão da marca, que é
 * o comportamento de antes desta função existir. Texto em branco numa mensagem
 * ao cliente final é pior que a palavra do nicho padrão.
 *
 * O erro de banco é registrado, não engolido: cair no padrão em silêncio para
 * sempre seria a palavra certa nunca aparecer e ninguém saber por quê.
 *
 * ## Custo
 *
 * Uma consulta por chamada, lendo uma coluna. Onde isto é usado — a resposta do
 * agente de IA, o disparo de e-mail — já existe uma chamada de LLM ou de
 * provedor de envio no mesmo caminho, e ao lado delas isto é ruído. Não
 * memoizo por `cache()` porque `cache()` é por requisição do React e aqui não
 * há requisição; quem chamar em laço deve resolver uma vez e passar adiante.
 */
export async function vocabDoWorkspace(workspaceId: string): Promise<Vocabulario> {
    try {
        const workspace = await prisma.workspace.findUnique({
            where: { id: workspaceId },
            select: { settings: true },
        })
        return vocab(workspace?.settings)
    } catch (error) {
        console.error('[VOCAB_DO_WORKSPACE]', workspaceId, error)
        return vocab()
    }
}
