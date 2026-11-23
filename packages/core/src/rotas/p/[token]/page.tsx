import type { Metadata } from 'next'
import { headers } from 'next/headers'

import { BRAND } from '@venn/core/marca'
import { ipDaRequisicao } from '@venn/core/lib/limite'
import {
    documentoPublico,
    registrarAbertura,
} from '@venn/core/lib/propostas/compartilhar'
import {
    dentroDoLimitePublico,
    pareceToken,
    renderizarPublico,
    secoesDoCompartilhamento,
    userAgentDaRequisicao,
} from '@venn/core/lib/propostas/publico'
import prisma from '@venn/db/cliente'
import { urlDaCapaDe } from '@venn/core/lib/propostas/capa'
import { registrarEventoDoDocumento } from '@venn/core/lib/propostas/conversa'

import { DocumentoPublicoCliente } from './DocumentoPublicoCliente'

/**
 * A página pública de um documento — a ÚNICA rota sem autenticação do produto.
 *
 * ## A mesma resposta para inexistente, expirado e revogado
 *
 * É o requisito que mais parece detalhe e menos é. Se o link expirado dissesse
 * "este link expirou" e o inexistente dissesse "não encontrado", quem varre
 * tokens aprenderia quais existem — e com isso quantos documentos a unidade
 * tem. Então os três casos mostram esta mesma tela, e ela não diz qual dos três
 * aconteceu.
 *
 * O precedente exato é `rotas/f/[key]/page.tsx`: lá, rascunho e chave
 * inexistente também respondem a mesma tela, e pela mesma razão.
 *
 * ## O que esta página NÃO mostra
 *
 * Nenhum id interno, nenhum custo, nenhuma margem, nenhuma observação interna
 * da revisão, nenhum dado do negócio ou do funil, e nenhuma outra proposta da
 * unidade. A projeção está em `documentoPublico()` e é deliberadamente curta —
 * ver a nota em `lib/propostas/compartilhar.ts`.
 *
 * ## Por que há CSS de impressão e não PDF
 *
 * Decisão de 2026-11-20: o cliente abre o link no celular, lê e aceita; quem
 * quiser papel usa Imprimir. O PDF arquivado entra numa fase 2 por Browser
 * Rendering, partindo deste mesmo HTML — então o template não precisa mudar.
 */

export const dynamic = 'force-dynamic'

export async function generateMetadata({
    params,
}: {
    params: Promise<{ token: string }>
}): Promise<Metadata> {
    const { token } = await params

    // O título não revela nada de quem não tem o link válido, e nada de
    // específico de quem tem: o nome do documento está na página, não na aba,
    // porque a aba aparece no histórico do navegador e em captura de tela.
    return {
        title: 'Documento',
        // Página privada por natureza. `noindex` também impede que o link
        // compartilhado por engano entre num índice de busca.
        robots: { index: false, follow: false },
    }
}

function Indisponivel() {
    return (
        <main className="flex min-h-dvh items-center justify-center bg-muted/30 px-4 py-16">
            <div className="w-full max-w-md rounded-xl border border-border/60 bg-card p-8 text-center shadow-sm">
                <h1 className="text-xl font-semibold text-foreground">Documento indisponível</h1>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                    Este endereço não está mais válido. Se você chegou por um link, peça a quem o
                    enviou um endereço atualizado.
                </p>
                <p className="mt-8 text-xs text-muted-foreground/70">{BRAND().name}</p>
            </div>
        </main>
    )
}

export default async function DocumentoPage({ params }: { params: Promise<{ token: string }> }) {
    const { token } = await params

    // Forma antes de banco: `/p/undefined` é o que um link truncado produz.
    if (!pareceToken(token)) return <Indisponivel />

    /**
     * O cabeçalho da requisição, por `headers()`.
     *
     * Um server component não recebe `Request`, e `ipDaRequisicao` e
     * `userAgentDaRequisicao` pedem um — então monta-se um objeto com os
     * cabeçalhos que elas leem. Reusar as duas funções é o que mantém a forma
     * do IP igual à do resto do projeto (`cf-connecting-ip` primeiro).
     */
    const cabecalhos = await headers()
    const requisicao = new Request('https://documento.local', { headers: cabecalhos })

    if (!(await dentroDoLimitePublico(requisicao, token, 'abrir'))) {
        // Mesma tela do inválido: dizer "você excedeu o limite" confirmaria que
        // o token existe.
        return <Indisponivel />
    }

    const share = await documentoPublico(token)
    if (!share) return <Indisponivel />

    const doc = renderizarPublico(share, await urlDaCapaDe(secoesDoCompartilhamento(share)))

    // Registrada depois de o documento ser encontrado, e sem `await` bloqueante
    // no caminho de erro: `registrarAbertura` nunca lança — perder a contagem é
    // perder uma métrica, não abrir é perder a venda.
    await registrarAbertura(share.id, ipDaRequisicao(requisicao), userAgentDaRequisicao(requisicao))
    // A primeira abertura consta em Conversas; as seguintes só na contagem.
    await registrarEventoDoDocumento(prisma, { shareId: share.id, evento: 'abriu' })

    return (
        <DocumentoPublicoCliente
            token={token}
            marca={BRAND().name}
            documento={{
                html: doc.html,
                rotulo: doc.rotulo,
                numero: doc.numero,
                organizacao: doc.organizacao,
                totalEmTexto: doc.totalEmTexto,
                aceitoEm: doc.aceitoEm?.toISOString() ?? null,
                aceitoPor: doc.aceitoPor,
                validoAte: doc.validoAte?.toISOString() ?? null,
            }}
        />
    )
}
