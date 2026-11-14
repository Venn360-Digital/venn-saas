import { z } from 'zod'
import type { Prisma } from '@venn/db'

import { ESPERA_MAX_MIN, TIPOS_DE_PASSO } from '@/lib/funil/passos'
import { TIPOS_DE_GATILHO } from '@/lib/funil/gatilho'
import { MAX_PASSOS } from '@/lib/funil/publicar'

/**
 * A forma do que a tela do canvas manda.
 *
 * Os tetos e os tipos **saem das constantes**, não repetidos aqui. Dois números
 * escritos à parte divergem calados, e a divergência que importa é a do teto de
 * passos: o schema aceitando 150 e o `podePublicar` recusando acima de 100
 * deixaria a pessoa desenhar meia hora para ouvir "não" no fim.
 */

/** O gatilho. `alvo` é exigido por `lerGatilho`, não aqui. */
export const gatilhoSchema = z.object({
    tipo: z.enum(TIPOS_DE_GATILHO as [string, ...string[]]),
    alvo: z.string().trim().min(1).max(64).optional(),
})

/**
 * As arestas de um passo.
 *
 * `padrao` para passo comum, `sim`/`nao` para condição. Chave desconhecida é
 * recusada em vez de ignorada: aresta com nome errado seria aresta que a tela
 * desenha e o motor não anda — e o desenho mentiria.
 */
export const arestasSchema = z
    .object({
        padrao: z.string().trim().min(1).max(64).optional(),
        sim: z.string().trim().min(1).max(64).optional(),
        nao: z.string().trim().min(1).max(64).optional(),
    })
    .strict()
    .nullable()
    .optional()

export const passoSchema = z.object({
    /**
     * O id vem da tela.
     *
     * É ele que as arestas apontam, então o canvas precisa escolhê-lo antes de
     * salvar — gerar no servidor obrigaria a tela a reescrever todas as arestas
     * depois da resposta, e uma gravação interrompida no meio deixaria arestas
     * apontando para ids que nunca existiram.
     */
    id: z.string().trim().min(1).max(64),
    type: z.enum(TIPOS_DE_PASSO as [string, ...string[]]),
    /** A configuração do passo. Validada por tipo em `lib/funil/`, não aqui. */
    config: z.record(z.string(), z.unknown()).default({}),
    order: z.number().int().min(0).max(MAX_PASSOS * 10),
    x: z.number().finite(),
    y: z.number().finite(),
    edges: arestasSchema,
})

export const funilSchema = z.object({
    name: z.string().trim().min(1, 'Dê um nome ao funil').max(120),
    description: z.string().trim().max(500).optional().nullable(),
    trigger: gatilhoSchema,
    /**
     * Teto de pessoas dentro ao mesmo tempo. Nulo = sem teto.
     *
     * A publicação **exige** um quando o gatilho é de lista (ver
     * `lib/funil/publicar.ts`), mas o rascunho pode ficar sem: quem está
     * desenhando ainda não escolheu o gatilho.
     */
    maxAtivos: z.number().int().min(1).max(100_000).nullable().optional(),
    passos: z.array(passoSchema).max(MAX_PASSOS, `O funil cabe em ${MAX_PASSOS} passos`),
})

/** O teto de espera, para a tela recusar antes de mandar. */
export { ESPERA_MAX_MIN }

/**
 * O cast para o tipo de entrada JSON do Prisma, num lugar só.
 *
 * `Prisma.InputJsonValue` não aceita `Record<string, unknown>` porque `unknown`
 * admite `undefined`, que não é JSON. Validar a forma de cada `config` por tipo
 * de passo é trabalho de `lib/funil/`, não do schema da rota — aqui o contrato é
 * "é um objeto", e é isso que o zod garante antes deste cast.
 *
 * Num lugar só para não espalhar `as` por duas rotas, onde a terceira esqueceria.
 */
export function comoJson(v: Record<string, unknown>): Prisma.InputJsonValue {
    return v as Prisma.InputJsonValue
}
