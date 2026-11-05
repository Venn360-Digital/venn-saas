import 'server-only'

import { cookies } from 'next/headers'

import prisma from '@/lib/prisma'
import { getPlatformAdmin } from '@/lib/platform-credentials'

/**
 * Entrar na conta de um cliente — e o que impede isso de ser uma porta dos
 * fundos.
 *
 * ## O pedido
 *
 * "Quando eu era owner da conta STB Austrália, eu consegui fazer algumas
 * configurações rapidamente para o cliente. Isso não tem preço." O que ele quer
 * é o que todo SaaS maduro tem: o operador abre a conta do cliente, resolve, e
 * sai.
 *
 * ## O cookie não decide nada
 *
 * `odontobox.assumir` guarda o id da unidade alvo, e **não é autorização**: a
 * cada requisição, `getWorkspaceMember` só o honra depois de `getPlatformAdmin()`
 * confirmar que quem está logado é OWNER do workspace de plataforma. Forjar o
 * cookie num navegador qualquer não abre nada — é a mesma regra do cookie de
 * unidade, que também é só uma escolha e nunca uma permissão.
 *
 * Por isso ele não é assinado: um valor que o servidor reconfere em toda
 * leitura não ganha nada com assinatura, e ganharia um segredo a mais para
 * rodar.
 *
 * ## Dois modos, porque são dois atos
 *
 * - **`leitura`** — "espiar". A tela abre, nada grava. É o que resolve 80% das
 *   perguntas de suporte ("o agente está publicado?", "qual plano ele tem?") e
 *   é o que deve ser usado por padrão.
 * - **`total`** — "entrar". Grava em nome da clínica, com o papel de OWNER.
 *
 * A diferença entre os dois é o `role` que a sessão passa a ter, e o modo
 * `leitura` vira `ATENDENTE` — não por ser o papel certo, mas por ser o papel
 * que o produto inteiro já sabe barrar. Inventar um quinto papel só para isto
 * exigiria revisitar todo portão escrito até hoje.
 *
 * ## Tempo
 *
 * A sessão assumida dura **uma hora**. Não é teatro: a janela existe para que
 * um notebook esquecido aberto não fique com a conta de um cliente à mão até o
 * dia seguinte. Renovar é um clique.
 */

export const COOKIE_ASSUMIR = 'odontobox.assumir'

/** Uma hora. O cookie expira sozinho, e a leitura confere de novo. */
export const DURACAO_MS = 60 * 60_000

export type ModoDeAcesso = 'leitura' | 'total'

export interface ContaAssumida {
    workspaceId: string
    modo: ModoDeAcesso
    /** Quando a janela fecha — a tela mostra o que falta. */
    expiraEm: Date
    /** A linha do registro, para fechá-la ao sair. */
    registroId: string
}

/** O que está guardado no cookie. Nada aqui vale sem a reconferência. */
interface Conteudo {
    w: string
    m: ModoDeAcesso
    e: number
    r: string
}

export function lerCookie(valor: string | undefined): ContaAssumida | null {
    if (!valor) return null
    try {
        const c = JSON.parse(valor) as Conteudo
        if (!c?.w || (c.m !== 'leitura' && c.m !== 'total') || !c.e || !c.r) return null
        // Expirado é como não ter: o cookie pode sobreviver ao prazo se o
        // relógio do navegador estiver errado, e a conta é nossa.
        if (Date.now() > c.e) return null
        return {
            workspaceId: c.w,
            modo: c.m,
            expiraEm: new Date(c.e),
            registroId: c.r,
        }
    } catch {
        return null
    }
}

export function escreverCookie(a: ContaAssumida): string {
    const c: Conteudo = {
        w: a.workspaceId,
        m: a.modo,
        e: a.expiraEm.getTime(),
        r: a.registroId,
    }
    return JSON.stringify(c)
}

/**
 * A conta assumida **desta** requisição, já conferida.
 *
 * Devolve `null` para todo mundo que não for administrador de plataforma, e é
 * esta a função que `getWorkspaceMember` chama. Uma consulta a mais por
 * requisição só para quem tem o cookie: quem não tem sai no primeiro `if`.
 */
export async function contaAssumida(): Promise<ContaAssumida | null> {
    const bruto = (await cookies()).get(COOKIE_ASSUMIR)?.value
    if (!bruto) return null

    const escolha = lerCookie(bruto)
    if (!escolha) return null

    // **Aqui** está a autorização. O cookie só disse qual unidade.
    const admin = await getPlatformAdmin()
    if (!admin) return null

    // A unidade tem de existir e não estar suspensa — as mesmas condições de
    // qualquer acesso. Entrar numa unidade suspensa mostraria uma clínica que
    // nem o dono dela consegue abrir.
    const existe = await prisma.workspace.findFirst({
        where: { id: escolha.workspaceId, suspendedAt: null },
        select: { id: true },
    })
    if (!existe) return null

    return escolha
}

/**
 * Abre o registro e devolve o id da linha.
 *
 * Gravado **antes** de o cookie ser escrito: se a gravação falhar, não há
 * acesso. A ordem inversa deixaria passar um acesso sem registro quando o banco
 * estivesse ruim, que é justamente quando mais se quer saber quem entrou.
 */
export async function abrirRegistro(input: {
    userId: string
    accountId: string
    workspaceId: string
    modo: ModoDeAcesso
    motivo?: string | null
}): Promise<string> {
    const linha = await prisma.platformAccessLog.create({
        data: {
            userId: input.userId,
            accountId: input.accountId,
            workspaceId: input.workspaceId,
            modo: input.modo,
            motivo: input.motivo?.trim() || null,
        },
        select: { id: true },
    })
    return linha.id
}

/** Fecha o registro. Falhar aqui não impede de sair — sair é sempre permitido. */
export async function fecharRegistro(registroId: string): Promise<void> {
    await prisma.platformAccessLog
        .update({ where: { id: registroId }, data: { endedAt: new Date() } })
        .catch(() => {
            /* a linha fica aberta; o relatório mostra isso como "sem saída". */
        })
}
