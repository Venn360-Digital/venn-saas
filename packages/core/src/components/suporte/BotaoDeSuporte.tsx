'use client'

import { useSyncExternalStore } from 'react'
import { LifeBuoy } from 'lucide-react'
import {
    abrirSuporte,
    assinarSuporte,
    estadoDoSuporte,
    SUPORTE_INDISPONIVEL,
} from '@venn/desk-widget'

import { Button } from '@venn/ui/button'

/**
 * O botão que abre o painel de suporte, na barra de cima.
 *
 * ## Por que ele existe
 *
 * O widget do Venn Desk desenhava a própria pílula "SUPORTE", `position: fixed`
 * no canto inferior direito. Num painel denso esse canto **não é vazio**: na
 * tela de Conversas é onde ficam Enviar, anexo, áudio e "sugerir com IA", e a
 * pílula cobria todos. Trocar de canto não resolveria — o inferior esquerdo é o
 * rodapé da sidebar, com plano e usuário.
 *
 * Então a pílula sai (`flutuante={false}` em `WidgetDoDesk`) e o suporte passa a
 * ter lugar próprio, aqui, **ao lado do sino de avisos** — que é onde a pessoa
 * já procura "o que o sistema quer me dizer", e onde um selo de não lidas é
 * lido sem atrapalhar nada.
 *
 * ## Por que não usa o contexto do widget
 *
 * `<VennDeskProvider>` é montado como folha no layout, de propósito (ver
 * `WidgetDoDesk.tsx`), então esta barra está **fora** dele. A ponte em
 * `@venn/desk-widget` existe para esse vão: o widget se anuncia ao montar, e
 * quem está fora chama `abrirSuporte()`.
 *
 * ## Não desenha nada quando não há suporte
 *
 * Worker sem `VENN_DESK_APP` não monta o widget, a ponte fica indisponível e
 * este botão não aparece. É a mesma regra do `Suporte.tsx`: ausência de
 * configuração é invisível, não é erro — e um botão que abre um painel que não
 * existe é pior que botão nenhum.
 */
export function BotaoDeSuporte() {
    /**
     * `useSyncExternalStore` e não `useState` + efeito.
     *
     * É a API feita para exatamente isto — ler um estado que vive fora do React
     * —, e resolve de graça três coisas que a versão com efeito fazia mal:
     *
     * - **a leitura inicial.** O widget pode ter montado antes desta barra, e aí
     *   uma assinatura sozinha só reagiria à *próxima* mudança: o botão nasceria
     *   escondido e só apareceria quando algum contador mudasse. Lendo no
     *   render, o valor é o de agora;
     * - **o SSR.** O terceiro argumento é o retrato do servidor, onde não há
     *   ponte nem widget: indisponível, sem risco de o HTML do servidor
     *   discordar do primeiro render do cliente;
     * - **o `setState` dentro de efeito**, que o `react-hooks` acusa com razão.
     *
     * Os três retratos devolvem a **mesma referência** enquanto nada muda — é
     * requisito desta API, e está garantido na ponte.
     */
    const estado = useSyncExternalStore(
        assinarSuporte,
        estadoDoSuporte,
        () => SUPORTE_INDISPONIVEL
    )

    if (!estado.disponivel) return null

    const naoLidas = estado.naoLidas

    return (
        <Button
            variant="ghost"
            size="icon"
            className="relative text-muted-foreground hover:text-foreground"
            onClick={() => abrirSuporte()}
            title="Dúvidas e suporte"
            aria-label={
                naoLidas > 0
                    ? `Dúvidas e suporte — ${naoLidas} resposta(s) não lida(s)`
                    : 'Dúvidas e suporte'
            }
            aria-haspopup="dialog"
        >
            <LifeBuoy className="h-5 w-5" />
            {naoLidas > 0 && (
                <span className="num absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-medium text-destructive-foreground">
                    {naoLidas > 9 ? '9+' : naoLidas}
                </span>
            )}
        </Button>
    )
}
