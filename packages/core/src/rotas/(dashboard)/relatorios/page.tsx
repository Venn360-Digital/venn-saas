import { redirect } from 'next/navigation'

import prisma from '@venn/db/cliente'
import {
    canSeeEveryone,
    getWorkspaceMember,
    OVERSIGHT_ROLES,
    resolveOwnerScope,
} from '@venn/core/lib/auth/workspace'
import { resolvePeriodParams } from '@venn/core/lib/period'
import { fusoDaUnidade } from '@venn/core/lib/fuso-da-unidade'
import { IndexFrame } from '@venn/core/components/shared/IndexFrame'
import { DashboardFilters } from '@venn/core/components/dashboard/DashboardFilters'
import {
    relatorioDeFunil,
    relatorioDeProdutos,
    relatorioDePropostas,
} from '@venn/core/lib/relatorios/consultas'
import { ehTipoDeRelatorio, type TipoDeRelatorio } from '@venn/core/lib/relatorios/tipos'

import { RelatorioDeFunil } from './RelatorioDeFunil'
import { RelatorioDeProdutos } from './RelatorioDeProdutos'
import { RelatorioDePropostas } from './RelatorioDePropostas'
import { SeletorDeRelatorio } from './SeletorDeRelatorio'

/**
 * Relatórios — componente de **servidor**, com o recorte na URL.
 *
 * Segue o padrão do Dashboard, e por duas razões que valem mais aqui que lá:
 * os números já saem no HTML (sem piscar e sem segunda pintura), e o recorte
 * vive no endereço — então um relatório se compartilha colando o link, que é o
 * que um gestor faz com um número que quer mostrar.
 *
 * Trocar de relatório, de período ou de responsável reescreve a URL e o
 * servidor recalcula. Nenhum estado de cliente guarda isso.
 *
 * ## Por que três relatórios, e estes três
 *
 * **Propostas** e **Produtos** não existiam, e não por falta de tela: até
 * 21/11/2026 `Deal` não tinha itens e o documento não tinha aberturas. São os
 * dois que o módulo de documentos acabou de habilitar.
 *
 * **Funil** existia pela metade no Dashboard — há conversão e dias por fase na
 * visão de gráfico. Aqui ele responde a outra pergunta, a que o gráfico não
 * responde: *onde* o funil vaza, e quanto dinheiro sai por cada etapa.
 *
 * O que **não** há é relatório salvo nem agendamento por e-mail. Relatório
 * salvo pede um editor de consulta; agendamento pede cron por unidade e um
 * destinatário configurável. Os dois entram quando alguém pedir — e o link na
 * URL já cobre o caso de "quero este recorte de novo amanhã".
 */

export const dynamic = 'force-dynamic'

export default async function RelatoriosPage({
    searchParams,
}: {
    searchParams: Promise<{
        tipo?: string
        from?: string
        to?: string
        period?: string
        userId?: string
    }>
}) {
    const auth = await getWorkspaceMember()
    if (!auth.ok) redirect('/login')

    /**
     * A régua de papel é a do Dashboard: dono, administrador e gestor.
     *
     * Relatório é leitura agregada da operação inteira, não a ferramenta de quem
     * atende. E `redirect` em vez de uma tela de "sem permissão": o item nem
     * aparece no menu dele, então chegar aqui é link colado ou endereço
     * digitado — e nesse caso levar ao painel é mais útil que explicar.
     *
     * Esconder do menu **não** é autorização: as duas rotas de API refazem este
     * teste por conta própria.
     */
    if (!OVERSIGHT_ROLES.includes(auth.member.role)) redirect('/dashboard')

    const params = await searchParams
    const tipo: TipoDeRelatorio = ehTipoDeRelatorio(params.tipo) ? params.tipo : 'propostas'

    /**
     * Nasce em "Este mês", como o painel.
     *
     * É o recorte da pergunta que o dono faz ("como estamos este mês?"), e é o
     * mês **da unidade**: em Sydney ele já virou quando aqui ainda é dia 31.
     */
    const fuso = await fusoDaUnidade(auth.member.workspaceId)
    const range = resolvePeriodParams(params, 'month', Date.now(), fuso)
    const canChoose = canSeeEveryone(auth.member.role)
    const owner = resolveOwnerScope(auth.member, params.userId)

    /**
     * Período "todo" (`period=all`) não serve a relatório.
     *
     * `resolvePeriodParams` devolve `from`/`to` vazios nesse caso, e as
     * consultas precisam de janela — sem ela, "dias até o aceite" perde
     * significado e a varredura passa a ser da tabela inteira, que é
     * exatamente o que o contrato do estudo manda evitar. Então cai no mês.
     */
    const de = range.from || resolvePeriodParams({}, 'month', Date.now(), fuso).from
    const ate = range.to || resolvePeriodParams({}, 'month', Date.now(), fuso).to

    const escopo = { de, ate, userId: owner }

    const [dados, members] = await Promise.all([
        tipo === 'propostas'
            ? relatorioDePropostas(auth.member, escopo)
            : tipo === 'produtos'
              ? relatorioDeProdutos(auth.member, escopo)
              : relatorioDeFunil(auth.member, escopo),
        canChoose
            ? prisma.workspaceUser.findMany({
                  where: { workspaceId: auth.member.workspaceId, isActive: true },
                  orderBy: { createdAt: 'asc' },
                  select: { userId: true, user: { select: { name: true, lastName: true } } },
              })
            : Promise.resolve([]),
    ])

    /** O mesmo recorte, trocando só o relatório — e o endereço do CSV. */
    const consulta = new URLSearchParams()
    consulta.set('de', de)
    consulta.set('ate', ate)
    if (params.userId && canChoose) consulta.set('userId', params.userId)

    const hrefDoTipo = (proximo: TipoDeRelatorio) => {
        const q = new URLSearchParams()
        q.set('tipo', proximo)
        if (range.from) q.set('from', range.from)
        if (range.to) q.set('to', range.to)
        if (params.userId && canChoose) q.set('userId', params.userId)
        return `/relatorios?${q.toString()}`
    }

    const hrefDoCsv = `/api/relatorios/export?tipo=${tipo}&${consulta.toString()}`

    return (
        <IndexFrame
            title="Relatórios"
            actions={<SeletorDeRelatorio tipo={tipo} hrefDoTipo={hrefDoTipo} hrefDoCsv={hrefDoCsv} />}
            filters={
                <DashboardFilters
                    from={range.from}
                    to={range.to}
                    userId={params.userId && canChoose ? params.userId : ''}
                    canChoose={canChoose}
                    presetHint={range.preset}
                    members={members.map((m) => ({
                        userId: m.userId,
                        name: [m.user.name, m.user.lastName].filter(Boolean).join(' '),
                    }))}
                />
            }
        >
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 md:px-6">
                {tipo === 'propostas' && (
                    <RelatorioDePropostas dados={dados as Awaited<ReturnType<typeof relatorioDePropostas>>} />
                )}
                {tipo === 'produtos' && (
                    <RelatorioDeProdutos dados={dados as Awaited<ReturnType<typeof relatorioDeProdutos>>} />
                )}
                {tipo === 'funil' && (
                    <RelatorioDeFunil dados={dados as Awaited<ReturnType<typeof relatorioDeFunil>>} />
                )}
            </div>
        </IndexFrame>
    )
}
