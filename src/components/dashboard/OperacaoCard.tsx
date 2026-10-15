import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'

import prisma from '@/lib/prisma'
import { CANAIS_EM_DESENVOLVIMENTO, PLAN_CHANNELS } from '@/lib/plans'
import { cn } from '@/lib/utils'

/**
 * O que está de pé agora: agentes e canais.
 *
 * O painel respondia "como foi o mês" e não respondia "o atendimento está no
 * ar?". São perguntas diferentes: a segunda não olha para trás, olha para
 * agora, e é a que faz alguém largar o que está fazendo. Número de ontem com o
 * WhatsApp fora do ar é número que já nasceu errado.
 *
 * O estado é lido do banco a cada abertura, nunca de texto guardado: linha
 * conectada é `status = "connected"` na integração do agente, e agente no ar é
 * `isActive` sem pausa por limite de plano.
 */

type Tom = 'ok' | 'fora' | 'neutro'

interface Linha {
    nome: string
    rotulo: string
    tom: Tom
    /** Canal que ainda vai nascer: não conta no "x de y no ar". */
    futuro?: boolean
}

interface Operacao {
    agentes: Linha[]
    canais: Linha[]
    agentesNoAr: number
    agentesTotal: number
    canaisNoAr: number
    canaisTotal: number
}

/** O canal do plano e a coluna `channel` da integração não se chamam igual. */
const CANAL_NO_BANCO: Record<string, string> = {
    whatsapp_qr: 'whatsapp_qr',
    whatsapp_api: 'whatsapp_business',
    instagram: 'instagram',
    facebook: 'facebook',
}

export async function lerOperacao(workspaceId: string): Promise<Operacao> {
    const [agentes, integracoes] = await Promise.all([
        prisma.agent.findMany({
            where: { workspaceId },
            orderBy: { createdAt: 'asc' },
            select: { id: true, name: true, isActive: true, pausedByLimit: true },
        }),
        prisma.agentIntegration.findMany({
            where: { agent: { workspaceId } },
            select: { channel: true, status: true },
        }),
    ])

    const linhasDeAgente: Linha[] = agentes.map((a) => ({
        nome: a.name,
        rotulo: a.pausedByLimit ? 'Acima do plano' : a.isActive ? 'No ar' : 'Pausado',
        tom: a.pausedByLimit ? 'fora' : a.isActive ? 'ok' : 'neutro',
    }))

    const canais: Linha[] = PLAN_CHANNELS.map((canal) => {
        const doCanal = integracoes.filter((i) => i.channel === CANAL_NO_BANCO[canal.id])
        const conectadas = doCanal.filter((i) => i.status === 'connected').length

        // Canal que o produto ainda não atende não é "não configurado": é
        // "em breve". Dizer o contrário manda a clínica procurar um botão de
        // ligar que não existe.
        if (doCanal.length === 0 && CANAIS_EM_DESENVOLVIMENTO.has(canal.id)) {
            return { nome: canal.label, rotulo: 'Em breve', tom: 'neutro', futuro: true }
        }
        // Sem nenhum registro o canal nunca foi ligado. Dizer "fora do ar" aí
        // seria alarme falso: não caiu, ainda não existe.
        if (doCanal.length === 0) {
            return { nome: canal.label, rotulo: 'Não configurado', tom: 'neutro' }
        }
        if (conectadas === 0) {
            return { nome: canal.label, rotulo: 'Fora do ar', tom: 'fora' }
        }
        return {
            nome: canal.label,
            rotulo: doCanal.length > 1 ? `${conectadas} de ${doCanal.length} no ar` : 'No ar',
            tom: 'ok',
        }
    })

    // O site não está entre os canais do plano, mas é um canal de verdade e tem
    // estado — some do cartão enquanto ninguém o ligou.
    const site = integracoes.filter((i) => i.channel === 'site')
    if (site.length > 0) {
        const ligado = site.some((i) => i.status === 'connected')
        canais.push({
            nome: 'Site da clínica',
            rotulo: ligado ? 'No ar' : 'Desligado',
            tom: ligado ? 'ok' : 'neutro',
        })
    }

    return {
        agentes: linhasDeAgente,
        canais,
        agentesNoAr: linhasDeAgente.filter((l) => l.tom === 'ok').length,
        agentesTotal: linhasDeAgente.length,
        canaisNoAr: canais.filter((l) => l.tom === 'ok').length,
        // O que ainda não existe não entra na conta: "1 de 5" com três canais
        // por nascer faz a clínica achar que perdeu três.
        canaisTotal: canais.filter((l) => !l.futuro).length,
    }
}

export async function OperacaoCard({ workspaceId }: { workspaceId: string }) {
    const op = await lerOperacao(workspaceId)

    return (
        <section className="rounded-lg border border-border bg-card">
            <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
                <div>
                    <h2 className="text-h3">Operação agora</h2>
                    <p className="mt-0.5 text-sm text-muted-foreground">Quem atende e por onde</p>
                </div>
                <Link
                    href="/atendimento/agentes"
                    className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-primary-subtle-foreground hover:underline"
                >
                    Gerenciar <ArrowUpRight className="size-3.5" aria-hidden="true" />
                </Link>
            </header>

            <div className="divide-y divide-border">
                <Grupo
                    titulo="Agentes"
                    resumo={`${op.agentesNoAr} de ${op.agentesTotal} no ar`}
                    linhas={op.agentes}
                    vazio="Nenhum agente criado ainda."
                />
                <Grupo
                    titulo="Canais"
                    resumo={`${op.canaisNoAr} de ${op.canaisTotal} no ar`}
                    linhas={op.canais}
                    vazio="Nenhum canal disponível no plano."
                />
            </div>
        </section>
    )
}

function Grupo({
    titulo,
    resumo,
    linhas,
    vazio,
}: {
    titulo: string
    resumo: string
    linhas: Linha[]
    vazio: string
}) {
    return (
        <div className="px-5 py-4">
            <div className="mb-2.5 flex items-baseline justify-between gap-2">
                <h3 className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
                    {titulo}
                </h3>
                <span className="num text-[11px] text-muted-foreground">{resumo}</span>
            </div>

            {linhas.length === 0 ? (
                <p className="text-xs text-muted-foreground">{vazio}</p>
            ) : (
                <ul className="space-y-1.5">
                    {linhas.map((linha) => (
                        <li key={linha.nome} className="flex items-center justify-between gap-3">
                            <span className="min-w-0 truncate text-[13px]">{linha.nome}</span>
                            <Selo tom={linha.tom}>{linha.rotulo}</Selo>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}

/**
 * O estado em palavra, não só em cor.
 *
 * Quem não distingue verde de vermelho lê "No ar" e "Fora do ar" do mesmo
 * jeito — a cor reforça, nunca carrega a informação sozinha.
 */
function Selo({ tom, children }: { tom: Tom; children: React.ReactNode }) {
    return (
        <span
            className={cn(
                'shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold',
                tom === 'ok' && 'bg-success-subtle text-success-subtle-foreground',
                tom === 'fora' && 'bg-destructive-subtle text-destructive-subtle-foreground',
                tom === 'neutro' && 'bg-muted text-muted-foreground'
            )}
        >
            {children}
        </span>
    )
}
