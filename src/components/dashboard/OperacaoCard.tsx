import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'

import prisma from '@venn/db/cliente'
import { getWorkspaceLimits } from '@/lib/limits'
import { apelidoDaLinha } from '@/lib/linha'
import { isPlanId } from '@/lib/plan-limits'
import { REDES_DO_PLANO, redesDoPlano } from '@/lib/plans'
import { cn } from '@venn/ui/utils'

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
 *
 * **Quais canais aparecem é decisão do plano**, não da tabela de integrações.
 * O "x de y no ar" só pode somar o que a assinatura desta clínica inclui e o
 * produto já entrega — senão a clínica lê como perda o que nunca foi dela.
 */

type Tom = 'ok' | 'fora' | 'neutro'

interface Linha {
    /**
     * Chave da lista, e ela não pode ser o nome.
     *
     * Duas linhas do mesmo canal podem se chamar igual — duas sem apelido e
     * sem número pareado, ou dois apelidos repetidos, que nada impede. Com o
     * nome como chave o React descartaria uma das duas em silêncio.
     */
    id: string
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

/**
 * A rede comercial e a coluna `channel` da integração não se chamam igual.
 *
 * A lista que manda aqui é a **comercial** (`REDES_DO_PLANO`), não a técnica.
 * Era a técnica, e o cartão contava canal que este plano não vende: um Digital
 * aparecia com "1 de 4 no ar" somando WhatsApp API, Instagram e site, que ele
 * não tem. O Andre leu os 4 como quatro WhatsApps em 2026-10-20, e a leitura
 * dele é a natural — o cartão é que estava respondendo outra pergunta.
 */
const CANAL_NO_BANCO: Record<string, string[]> = {
    whatsapp: ['whatsapp_qr'],
    whatsapp_api: ['whatsapp_business'],
    instagram: ['instagram'],
    site: ['site'],
}

export async function lerOperacao(workspaceId: string): Promise<Operacao> {
    const [agentes, integracoes, limites] = await Promise.all([
        prisma.agent.findMany({
            where: { workspaceId },
            orderBy: { createdAt: 'asc' },
            select: { id: true, name: true, isActive: true, pausedByLimit: true },
        }),
        prisma.agentIntegration.findMany({
            where: { agent: { workspaceId } },
            orderBy: { createdAt: 'asc' },
            select: { id: true, channel: true, status: true, phoneNumber: true, label: true },
        }),
        getWorkspaceLimits(workspaceId),
    ])

    const linhasDeAgente: Linha[] = agentes.map((a) => ({
        id: a.id,
        nome: a.name,
        rotulo: a.pausedByLimit ? 'Acima do plano' : a.isActive ? 'No ar' : 'Pausado',
        tom: a.pausedByLimit ? 'fora' : a.isActive ? 'ok' : 'neutro',
    }))

    /** As redes que **este** plano vende, para separá-las das que ele não tem. */
    const plano = isPlanId(limites.planId) ? limites.planId : 'flow'
    const doPlano = new Set(redesDoPlano(plano).map((r) => r.id))

    /**
     * **Uma linha da lista por número, não por canal.**
     *
     * O cartão resumia o canal inteiro — "3 de 6 no ar" numa única linha
     * "WhatsApp" — e com isso escondia exatamente o que faz alguém agir: qual
     * número caiu. Numa Multiclínica com seis linhas, saber que três estão
     * fora não ajuda ninguém a ligar para a recepção certa. Decisão do Andre
     * em 2026-10-20, e o formato é o que as fichas já usam:
     * `WhatsApp · Unidade Centro`, com o apelido da linha e, na falta dele, o
     * número.
     */
    const canais = REDES_DO_PLANO.flatMap((rede): Linha[] => {
        const colunas = CANAL_NO_BANCO[rede.id] ?? []
        const registros = integracoes.filter((i) => colunas.includes(i.channel))
        const conectadas = registros.filter((i) => i.status === 'connected').length

        /**
         * Linha de verdade é a que já pareou — conectada, ou com número
         * gravado. É a mesma regra do `HOLDS_A_SLOT` de `lib/limits.ts`, e ela
         * existe aqui pelo mesmo motivo: registro vazio que nunca pareou não é
         * linha fora do ar, é vaga que ninguém usou. Contá-lo pintava de
         * vermelho a linha da Meta que só esperava a revisão do aplicativo.
         */
        const reais = registros.filter((i) => i.status === 'connected' || i.phoneNumber)

        // O que o produto ainda não entrega é "em breve", e não conta no "x de
        // y": dizer "não configurado" manda a clínica procurar um botão de
        // ligar que não existe. Uma linha já conectada passa por cima do aviso
        // — se está no ar, "em breve" seria mentira.
        if (rede.emBreve && conectadas === 0) {
            return [{ id: rede.id, nome: rede.label, rotulo: 'Em breve', tom: 'neutro', futuro: true }]
        }

        /**
         * Rede fora do plano só aparece se estiver no ar.
         *
         * O registro sobrevive a uma descida de plano, e desenhá-lo apagado
         * cobraria da clínica um canal que a assinatura dela não inclui. Se
         * ainda estiver conectado, aparece: esconder algo que está atendendo
         * seria pior.
         */
        if (!doPlano.has(rede.id) && conectadas === 0) return []

        // Canal sem nenhuma linha pareada fica numa linha só: não há número
        // para nomear, e "0 de 0" não é informação.
        if (reais.length === 0) {
            return [{ id: rede.id, nome: rede.label, rotulo: 'Não configurado', tom: 'neutro' }]
        }

        return reais.map((linha) => {
            const apelido = apelidoDaLinha(linha)
            const noAr = linha.status === 'connected'
            return {
                id: linha.id,
                nome: apelido ? `${rede.label} · ${apelido}` : rede.label,
                rotulo: noAr ? 'No ar' : 'Fora do ar',
                tom: noAr ? 'ok' : 'fora',
            }
        })
    })

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
                        <li key={linha.id} className="flex items-center justify-between gap-3">
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
