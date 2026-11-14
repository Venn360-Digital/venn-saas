import { Prisma } from '@venn/db'

/**
 * Reconhecimento de erros do Prisma, tipado.
 *
 * Seis rotas escreviam `catch (error: any)` só para alcançar `error.code`, o que
 * desliga a verificação de tipo do bloco inteiro — inclusive de tudo que vier
 * depois dentro dele. O `instanceof` diz a mesma coisa sem desligar nada, e diz
 * melhor: um erro de outra origem que por acaso tenha um campo `code` deixa de
 * ser confundido com uma violação do banco.
 */

/** Violação de restrição única — o P2002 do Prisma. */
export function isUniqueViolation(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

/** Mensagem segura para log ou resposta, sem presumir que `error` é um Error. */
export function errorMessage(error: unknown, fallback: string): string {
    return error instanceof Error && error.message ? error.message : fallback
}
