'use client'

import { VennDeskProvider, VennDeskLauncher } from '@venn/desk-widget'
import '@venn/desk-widget/estilo.css'

/**
 * O widget do Venn Desk dentro do app.
 *
 * **Por que existe este invólucro.** `@venn/desk-widget` é React puro, sem
 * nenhuma linha de Next — ele nasceu num Vite e roda em qualquer lugar. O
 * `'use client'` é exigência do Next, não do widget, então mora aqui: assim o
 * pacote não carrega o marcador de um framework que ele não usa.
 *
 * **Folha, e não casca.** O provider não envolve `{children}` do layout, como o
 * exemplo do pacote sugere. Envolver traria a árvore inteira do painel para o
 * lado do cliente sem necessidade: o estado do widget é lido só pelo lançador e
 * pelas telas dele, e os gravadores de contexto se instalam no `window`, onde a
 * posição na árvore não importa.
 *
 * **Configuração mínima.** Cor, posição, nome do atendente e saudação NÃO vêm
 * daqui: vêm do Venn Desk, por app, e mudam sem publicar o app (tela
 * "Aparência" no Console). Daqui vai só o que o navegador não tem como
 * descobrir sozinho — quem é o app e onde fica a central.
 */
export function WidgetDoDesk({ app, base }: { app: string; base: string }) {
    return (
        <VennDeskProvider app={app} base={base}>
            {/*
              `flutuante={false}`: **sem pílula sobre a área de trabalho.**

              O botão flutuante do widget é `position: fixed` no canto inferior
              direito, e nos nossos painéis esse canto não é vazio — na tela de
              Conversas o botão Enviar fica exatamente ali, e a pílula "SUPORTE"
              cobria ele e os vizinhos (anexo, áudio, sugerir com IA). Trocar de
              canto não resolveria: o inferior esquerdo é o rodapé da sidebar,
              com plano e usuário.

              Quem abre o painel é o botão de suporte da barra de cima, que fica
              em espaço próprio e já é onde a pessoa procura ajuda — ao lado do
              sino de avisos. O painel em si continua flutuando, e isso está
              certo: é um diálogo, abre por um gesto e fecha por outro.
            */}
            <VennDeskLauncher flutuante={false} />
        </VennDeskProvider>
    )
}
