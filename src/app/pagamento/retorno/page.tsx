'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'

import { Logo } from '@/components/brand/Logo'

/**
 * Para onde o Asaas devolve o pagador — uma página de uma frase.
 *
 * Existe porque o checkout passou a abrir numa janela própria. Sem ela, a volta
 * do Asaas carregaria a guia Plano **dentro da janelinha**: o sistema inteiro
 * espremido em 480 pixels, com sidebar e tudo, que é pior que o redirecionamento
 * que tudo isto veio evitar.
 *
 * Aqui ela avisa a janela de origem e se fecha. Se não houver janela de origem —
 * o pop-up foi bloqueado e o fluxo virou redirecionamento normal —, ela manda
 * para a guia Plano, que é onde a pessoa esperaria estar.
 *
 * Fora do grupo `(dashboard)` de propósito: não carrega sidebar, cabeçalho nem
 * nada que leia banco. É uma frase e um `postMessage`.
 */

const STATUS_VALIDOS = new Set(['processando', 'cancelado', 'expirado'])

function Conteudo() {
    const params = useSearchParams()
    const bruto = params.get('status')
    const status = bruto && STATUS_VALIDOS.has(bruto) ? bruto : 'processando'
    const [podeFechar, setPodeFechar] = useState(false)

    useEffect(() => {
        const origem = window.opener as Window | null

        if (origem && !origem.closed) {
            /**
             * `window.location.origin` como destino, e não `'*'`.
             *
             * Restringe a mensagem à própria aplicação: com `'*'`, qualquer
             * página que tivesse aberto esta janela leria o estado do pagamento.
             * É pouca informação, mas é informação de cobrança, e o custo de
             * restringir é uma palavra.
             */
            try {
                origem.postMessage({ tipo: 'odontobox:pagamento', status }, window.location.origin)
            } catch {
                // Origem fechada ou inacessível: cai no aviso de fechar à mão.
            }

            // Um instante para a mensagem sair antes de a janela morrer.
            const t = setTimeout(() => {
                window.close()
                // Se o navegador recusar fechar — alguns recusam para janelas
                // que o script não abriu —, o aviso aparece em vez de uma tela
                // parada sem explicação.
                setPodeFechar(true)
            }, 400)
            return () => clearTimeout(t)
        }

        // Sem janela de origem: o pop-up foi bloqueado e isto aqui é a aba
        // principal. Volta para onde a pessoa estava.
        window.location.replace(`/gerenciamento/conta?tab=plano&pagamento=${status}`)
    }, [status])

    const frase =
        status === 'processando'
            ? 'Pagamento recebido. Estamos confirmando com o banco.'
            : status === 'cancelado'
              ? 'Pagamento cancelado. Nada foi cobrado.'
              : 'O prazo do pagamento expirou. Nada foi cobrado.'

    return (
        <main className="flex min-h-svh flex-col items-center justify-center gap-4 bg-background px-6 text-center">
            <Logo variant="mark" height={40} priority />
            <p className="text-sm font-medium text-foreground">{frase}</p>
            <p className="text-xs text-muted-foreground">
                {podeFechar
                    ? 'Você já pode fechar esta janela.'
                    : 'Voltando para o OdontoBox360…'}
            </p>
        </main>
    )
}

export default function RetornoDoPagamento() {
    return (
        <Suspense fallback={null}>
            <Conteudo />
        </Suspense>
    )
}
