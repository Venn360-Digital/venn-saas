import { NextResponse } from 'next/server'

import { usuarioDaSessao } from '@venn/core/lib/auth/sessao'

/**
 * O CEP, consultado **pelo servidor** — e é isso que conserta a busca.
 *
 * ## Por que a tela não buscava nada
 *
 * `lib/cep.ts` chamava `https://viacep.com.br` direto do navegador, e a CSP da
 * resposta declara `connect-src 'self' https://*.r2.cloudflarestorage.com`
 * (`next.config.ts`). O navegador recusava a requisição antes de ela sair —
 * `buscarCep` caía no `catch`, devolvia `null`, e a falha é silenciosa de
 * propósito. De quem olha, é "digito o CEP e nada acontece", que foi o que o
 * Andre relatou. Não havia erro na tela, nem na rede: havia um bloqueio.
 *
 * O cabeçalho da CSP afirmava que não existia `fetch('https://…')` no cliente,
 * "conferido por varredura". A varredura não viu este arquivo. O conserto não é
 * abrir `connect-src` para mais um domínio de terceiro — é a consulta sair de
 * onde CSP não vale e credencial não viaja: o Worker.
 *
 * ## O que esta rota é
 *
 * Um repasse de leitura, sem corpo, sem efeito e sem segredo. Exige sessão
 * porque a origem é nossa e não há razão para servir de proxy de CEP para o
 * mundo. **Falha é silenciosa**, como antes: ViaCEP fora do ar ou CEP
 * inexistente devolvem 200 com `null`, e a pessoa digita o endereço à mão e
 * contrata do mesmo jeito. Travar o formulário porque um serviço de terceiro
 * não respondeu seria transformar conveniência em requisito.
 */

export interface EnderecoDoCep {
    address: string
    province: string
    city: string
    state: string
}

export async function GET(_req: Request, ctx: { params: Promise<{ cep: string }> }) {
    if (!(await usuarioDaSessao())) {
        return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    }

    const { cep } = await ctx.params
    const limpo = cep.replace(/\D/g, '')
    // Oito dígitos ou nada: sem isto a rota repassa qualquer caminho ao ViaCEP.
    if (limpo.length !== 8) return NextResponse.json(null)

    try {
        const res = await fetch(`https://viacep.com.br/ws/${limpo}/json/`, {
            // Endereço de CEP não muda; o cache poupa a ida ao terceiro.
            cf: { cacheTtl: 86_400, cacheEverything: true },
        } as RequestInit)
        if (!res.ok) return NextResponse.json(null)

        const dados = (await res.json()) as {
            erro?: boolean | string
            logradouro?: string
            bairro?: string
            localidade?: string
            uf?: string
        }

        // CEP inexistente devolve 200 com `{ "erro": true }` — e já apareceu
        // como a string "true" também, então a conferência aceita as duas.
        if (dados.erro) return NextResponse.json(null)

        const endereco: EnderecoDoCep = {
            address: dados.logradouro ?? '',
            province: dados.bairro ?? '',
            city: dados.localidade ?? '',
            state: dados.uf ?? '',
        }

        return NextResponse.json(endereco, {
            headers: { 'Cache-Control': 'private, max-age=86400' },
        })
    } catch {
        return NextResponse.json(null)
    }
}
