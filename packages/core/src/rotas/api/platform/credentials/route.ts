import { NextResponse } from 'next/server'

import { usuarioDaSessao } from '@venn/core/lib/auth/sessao'
import {
    PLATFORM_PROVIDERS,
    ambienteDaChave,
    estadoDoProvedor,
    getPlatformAdmin,
    getPlatformCredentials,
    temSegredoDuplo,
} from '@venn/core/lib/platform-credentials'
import { estadoDoWebhook } from '@venn/core/lib/asaas/vigia'

/**
 * Somente leitura, de propósito — e não é limitação, é a decisão.
 *
 * Esta rota tinha um `PUT` que gravava as credenciais dos aplicativos de
 * plataforma a partir de um formulário. Saiu em 2026-10-24, com o formulário: a
 * primeira metade do Asaas é a chave que movimenta cobrança, e nenhum SaaS põe
 * isso atrás de uma sessão de navegador. O raciocínio completo está no
 * cabeçalho de `lib/platform-credentials.ts`.
 *
 * As credenciais entram por `wrangler secret put` e são declaradas em
 * `cloudflare.config.ts`. O que esta rota faz é dizer **o que está definido e
 * qual variável falta** — informação que não é segredo e que o operador precisa
 * para saber o que gravar.
 */
export async function GET() {
    /**
     * Responde a **quem está logado** — não a qualquer um.
     *
     * A tela de Integrações de cada clínica precisa saber se "Conectar" vai
     * funcionar, então a rota não é exclusiva do administrador da plataforma.
     * Mas essa tela é de usuário autenticado, e a rota não pedia sessão nenhuma
     * — então respondia a anônimo com a postura da plataforma: quais provedores
     * estão configurados e de onde vem cada segredo.
     *
     * Não vaza valor nenhum, por isso o achado era baixo. Mas o portão da borda
     * é otimista (`lib/auth/middleware.ts`), então "só quem tem cookie" não era
     * barreira — era `getPlatformAdmin()` devolvendo `null` e o handler
     * seguindo em frente.
     */
    if (!(await usuarioDaSessao())) {
        return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    }

    const admin = await getPlatformAdmin()

    const providers = await Promise.all(
        PLATFORM_PROVIDERS().map(async (p) => {
            const estado = await estadoDoProvedor(p.provider)

            /**
             * "Configurado" é **as duas metades**, e nenhuma delas é devolvida.
             *
             * A conferência é por existência, sem decifrar: a tela não precisa
             * do valor, só da resposta. Meia credencial conta como não
             * configurada — ela não falharia aqui, falharia no primeiro fluxo
             * de OAuth, longe deste ponto.
             */
            const configured = estado.temId && estado.temSegredo

            /**
             * O ambiente do Asaas é **derivado**, não guardado.
             *
             * Sai do prefixo da própria chave (`$aact_hmlg_` é sandbox,
             * `$aact_prod_` é produção), que é o que torna impossível apontar
             * para produção por engano. A versão anterior lia uma coluna
             * gravada pelo formulário — e coluna gravada numa tela que não
             * existe mais é coluna que envelhece calada.
             */
            let ambiente: string | null = null
            if (admin && configured && temSegredoDuplo(p.provider)) {
                const creds = await getPlatformCredentials(p.provider).catch(() => null)
                ambiente = creds ? ambienteDaChave(creds.clientId) : null
            }

            return {
                ...p,
                configured,
                temId: estado.temId,
                temSegredo: estado.temSegredo,
                origem: estado.origem,
                /**
                 * Os nomes das variáveis vão **só para quem administra**. Não
                 * são segredo, mas também não dizem nada a um atendente, e
                 * manter a resposta mínima é mais fácil de defender depois.
                 */
                variaveis: admin ? estado.variaveis : null,
                ambiente,
            }
        })
    )

    /**
     * O estado da fila de webhooks do Asaas, só para quem administra.
     *
     * É a informação que não dá sintoma em lugar nenhum: a fila deles para
     * depois de 15 falhas seguidas e os eventos deixam de chegar em silêncio.
     * A conciliação da madrugada conserta o estrago; esta linha é para o André
     * **ver** que aconteceu.
     *
     * Falhar aqui não derruba a tela: sem Asaas configurado, ou com a API fora,
     * a tela mostra as credenciais como sempre e omite esta linha.
     */
    let asaasWebhook: { ok: boolean; problemas: string[] } | null = null

    if (admin) {
        try {
            const estado = await estadoDoWebhook()
            asaasWebhook = { ok: estado.ok, problemas: estado.problemas }
        } catch {
            asaasWebhook = null
        }
    }

    return NextResponse.json({ isPlatformAdmin: Boolean(admin), providers, asaasWebhook })
}
