import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import {
    currentMembership,
    OVERSIGHT_ROLES,
    PERMISSION_DENIED,
} from '@venn/core/lib/auth/workspace'
import {
    relatorioDeFunil,
    relatorioDeProdutos,
    relatorioDePropostas,
} from '@venn/core/lib/relatorios/consultas'
import { TIPOS_DE_RELATORIO } from '@venn/core/lib/relatorios/tipos'

/**
 * Os relatórios, em JSON.
 *
 * ## Quem vê
 *
 * `OVERSIGHT_ROLES` — dono, administrador e gestor. É a mesma régua do
 * Dashboard, e a razão é a mesma: relatório é leitura agregada da operação
 * inteira, não a ferramenta de quem atende.
 *
 * O que **não** muda com o papel é o recorte dos dados: `relatorioDe*` aplica
 * `dealScope(membro)` de todo jeito. Se amanhã o atendente ganhar acesso a uma
 * visão própria, ela já nasce recortada — a régua de papel e o recorte de dado
 * são dois portões, e o segundo não depende do primeiro.
 *
 * ## Sem cache
 *
 * `dynamic = 'force-dynamic'`, como o Dashboard. Relatório é dado de cliente e
 * muda a cada gravação; um cache de borda aqui serviria número velho sem dizer
 * que é velho — e num relatório a pessoa não tem como suspeitar.
 */

export const dynamic = 'force-dynamic'

const escopoSchema = z.object({
    tipo: z.enum(TIPOS_DE_RELATORIO),
    /**
     * `de` e `ate` em `YYYY-MM-DD`, não ISO com hora.
     *
     * O relatório pensa em DIA da unidade, e a conversão para instante é feita
     * no servidor com o fuso dela (`resolverJanela`). Aceitar ISO completo
     * deixaria o cliente escolher a fronteira do dia — e o navegador do
     * vendedor pode estar em outro fuso que o da clínica.
     */
    de: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida'),
    ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida'),
    userId: z.string().nullable().optional(),
    pipelineId: z.string().nullable().optional(),
})

export async function GET(request: NextRequest) {
    try {
        const membro = await currentMembership()
        if (!membro) {
            return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
        }

        if (!OVERSIGHT_ROLES.includes(membro.role)) {
            return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
        }

        const { searchParams } = new URL(request.url)
        const escopo = escopoSchema.parse({
            tipo: searchParams.get('tipo') ?? 'propostas',
            de: searchParams.get('de') ?? '',
            ate: searchParams.get('ate') ?? '',
            userId: searchParams.get('userId'),
            pipelineId: searchParams.get('pipelineId'),
        })

        /**
         * O período invertido é recusado com 400.
         *
         * `de > ate` produz uma janela vazia, e uma janela vazia devolve todas as
         * métricas em `null` — indistinguível de "a clínica não tem histórico".
         * Recusar é o que faz a tela mostrar "corrija o período" em vez de um
         * relatório vazio que parece verdadeiro.
         */
        if (escopo.de > escopo.ate) {
            return NextResponse.json(
                { error: 'A data inicial é posterior à final.' },
                { status: 400 }
            )
        }

        const dados =
            escopo.tipo === 'propostas'
                ? await relatorioDePropostas(membro, escopo)
                : escopo.tipo === 'produtos'
                  ? await relatorioDeProdutos(membro, escopo)
                  : await relatorioDeFunil(membro, escopo)

        return NextResponse.json({ tipo: escopo.tipo, ...dados })
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ errors: error.issues }, { status: 400 })
        }
        console.error('[RELATORIOS_GET]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}
