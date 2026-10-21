/**
 * O contrato de payload entre a tela de conversas e os emissores de evento.
 *
 * **Módulo puro, de propósito, e isso não é organização — é o que faz
 * `check:tempo-real` rodar sem banco.** Esta constante morava em `avisar.ts`,
 * que importa `./index` e com ele o cliente do Prisma. O Prisma lança na carga
 * do módulo quando `DATABASE_URL` não está definida, então o teste —
 * classificado como "provas que não precisam de banco" — quebrava no CI, onde
 * a variável não existe. Localmente passava, porque o `.env` a tem.
 *
 * Nada aqui pode importar `server-only`, Prisma, ou qualquer coisa com efeito
 * na carga. Se precisar, está no lugar errado.
 *
 * Por que o contrato existe: o payload é `Record<string, …>` dos dois lados, e
 * o compilador não o verifica. Escrever `conversaId` em vez de
 * `conversationId` num dos vinte pontos de emissão grava o evento, entrega o
 * evento, e a tela simplesmente não reage — sem erro em lugar nenhum. É o
 * defeito mais caro de diagnosticar que este caminho admite.
 */
export const CHAVES = {
    'mensagem.nova': ['conversationId', 'messageId', 'direction'],
    'mensagem.status': ['conversationId', 'messageId', 'status'],
    'conversa.alterada': ['conversationId'],
} as const
