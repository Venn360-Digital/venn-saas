/**
 * O widget sobrevive ao render NO SERVIDOR.
 *
 * `'use client'` diz onde o componente ganha interatividade, não onde ele é
 * renderizado: o Next renderiza componente de cliente no servidor no primeiro
 * paint. Qualquer leitura de `document` ou `window` durante o render lança lá —
 * e a exceção sobe até derrubar o layout inteiro do painel.
 *
 * Foi o que aconteceu em 18/11/2026: `idiomaDoDocumento()` era chamada no corpo
 * do `VennDeskProvider`, e os três apps devolveram **Error 1101 — Worker threw
 * exception** no painel inteiro, em produção. `/login` e `/api/health` seguiram
 * em 200, porque estão fora do grupo `(dashboard)`, e foi isso que fez a queda
 * parecer, de fora, com tudo no ar.
 *
 * Os nove lints, o typecheck duplo e os builds de preview passaram todos —
 * **nenhum deles executa um render**. Este executa, e é por isso que ele fecha
 * a classe em vez de um caso.
 *
 *     pnpm run test:widget-ssr
 *
 * ## Por que `navigator` NÃO entra na exigência
 *
 * A primeira versão deste arquivo exigia a ausência dos três globais e abortava
 * com "navigator existe neste processo". Ela nunca renderizou nada: o **Node
 * 21+ tem `navigator` global** (`language`, `userAgent`, `platform`), então a
 * asserção reprovava com e sem o defeito — vermelho sobre o nada, que é o
 * parente do "ensaio verde sobre o nada" de 14/11.
 *
 * E exigir a ausência seria exigir o ambiente errado: o **workerd também tem
 * `navigator`**. Quem não existe nos dois é `document` e `window`, e são esses
 * que a asserção cobra. Ler `navigator` durante o render não lança — no pior
 * caso divergem servidor e cliente, que é defeito de outra gravidade e de outra
 * rede.
 *
 * ## Cobertura declarada
 *
 * Renderiza o provider com o lançador, que é exatamente a árvore que o
 * `(dashboard)/layout.tsx` monta. As telas do painel (`Abrir`, `Chamado`,
 * `Meus`) só entram na árvore depois de um clique, logo nunca são renderizadas
 * no servidor — estão fora deste teste por construção, não por esquecimento.
 */
import { renderToString } from 'react-dom/server'

import { VennDeskProvider, VennDeskLauncher } from '@venn/desk-widget'

let falhou = false

for (const global of ['document', 'window'] as const) {
    if (global in globalThis) {
        console.error(`FALHOU  ${global} existe neste processo; o teste não provaria nada.`)
        falhou = true
    }
}
if (falhou) process.exit(1)

console.log('  ok  document e window ausentes — o render é o do servidor, como no Worker')

try {
    /*
     * JSX, e não `createElement`, e o motivo é uma tentativa minha que o portão
     * derrubou: com `createElement(Provider, props, filho)` o typecheck reprova
     * (o `children` do provider é obrigatório e a sobrecarga de três argumentos
     * não o satisfaz), e passando `children` DENTRO das props o ESLint reprova
     * em `react/no-children-prop`. JSX satisfaz os dois, que é o que ele existe
     * para fazer. Este arquivo é `.tsx` por isso.
     */
    const html = renderToString(
        <VennDeskProvider app="odontobox" base="https://desk.venn360.com">
            <VennDeskLauncher />
        </VennDeskProvider>
    )
    console.log(`  ok  o widget renderiza no servidor sem lançar (${html.length} bytes)`)
    /*
     * O HTML sai VAZIO, e isso é o desenho — não um teste que não exercitou
     * nada. `VennDeskLauncher` faz `if (semSessao || eu === null) return null`,
     * e no servidor `eu` é sempre nulo: quem o carrega é o `useEffect`, que não
     * roda aqui. O botão aparece no cliente, depois do `/eu`.
     *
     * Então a prova de que a árvore FOI percorrida não é o tamanho da saída —
     * é o controle negativo: tirada a guarda de `idiomaDoDocumento`, este mesmo
     * render lança `document is not defined`. Medido nos dois sentidos em
     * 18/11/2026, e é o que separa esta asserção de um verde sobre o nada.
     *
     * A saída deixa de ser vazia no dia em que o lançador passar a desenhar
     * algo no servidor. Isso não é erro, mas é caminho de render NOVO — e
     * caminho novo é onde esta classe de defeito nasce. Daí o aviso alto em vez
     * do silêncio.
     */
    if (html.length > 0) {
        console.log('')
        console.log(`  ATENÇÃO: o lançador passou a desenhar ${html.length} bytes no servidor.`)
        console.log('  Reveja se esse caminho novo lê `document`, `window` ou `navigator`')
        console.log('  durante o render, e atualize o comentário acima.')
    }
} catch (erro) {
    console.error('FALHOU  o widget lançou durante o render no servidor:')
    console.error(`        ${erro instanceof Error ? erro.message : String(erro)}`)
    console.error('')
    console.error('  É a classe do Error 1101 de 18/11/2026: leitura de browser no corpo do')
    console.error('  componente. Mova para `useEffect` ou guarde com `typeof document`.')
    process.exit(1)
}

console.log('\n✓ widget-ssr: o painel não cai no primeiro paint\n')
