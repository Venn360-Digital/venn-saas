/**
 * Apagar para todos e editar: as regras que não são nossas.
 *
 *   npm run test:mensagem-enviada
 *
 * ## Por que esta prova existe
 *
 * As três restrições desta feature vêm de fora, e **nenhuma delas falha alto**
 * se for esquecida — o botão simplesmente aparece e a ação morre no provedor,
 * na frente da atendente:
 *
 * 1. **Quinze minutos para editar**, imposto pelo WhatsApp. O número vive em
 *    `MINUTOS_PARA_EDITAR` e é lido por três lugares (a rota que recusa, a tela
 *    que esconde o botão, e esta prova). Um literal em cada um é a forma de
 *    defeito mais repetida deste repositório — foi ela que hoje reprovou os
 *    builds dos três apps duas vezes.
 * 2. **Só o canal QR.** No oficial a Meta não oferece apagar nem editar
 *    mensagem enviada por API, e no Instagram também não. A tela decide pela
 *    PRESENÇA do método no provedor, não por um `if` de nome de canal — então a
 *    prova é sobre quem implementa o quê.
 * 3. **Só texto para editar**, porque o Evolution Go não edita mídia
 *    (`// TODO: edit MediaMessage too`, no `routes.go` da 0.7.2).
 *
 * E um registro que vale mais que a prova: esta feature foi dada como
 * impossível por duas vezes, com a justificativa de que o provedor não tinha a
 * rota. Tinha. `POST /message/delete` e `POST /message/edit` existem na tag
 * 0.7.2, que é a imagem dos nossos três VPS. A conclusão errada saiu de ler a
 * lista de endpoints que *nós chamávamos* como se fosse a lista do que o
 * servidor expõe.
 */
// PRIMEIRO de todos: registra uma marca fictícia, porque este script roda
// código do core e o core PEDE a marca. Ver `./lib/marca-de-teste.ts`.
import './lib/marca-de-teste.ts'

import {
    MINUTOS_PARA_EDITAR,
    podeEditarAinda,
    type ChannelProvider,
} from '@venn/core/lib/whatsapp/types'
import { evolutionGo } from '@venn/core/lib/whatsapp/evolution-go'
import { metaWhatsApp } from '@venn/core/lib/whatsapp/meta-whatsapp'
import { instagramDirect } from '@venn/core/lib/instagram/provider'

let ok = 0
let falhas = 0

function conferir(nome: string, real: unknown, esperado: unknown) {
    if (JSON.stringify(real) === JSON.stringify(esperado)) {
        ok++
        console.log(`  ok  ${nome}`)
    } else {
        falhas++
        console.log(`  XX  ${nome}\n        esperado: ${JSON.stringify(esperado)}\n        veio:     ${JSON.stringify(real)}`)
    }
}

console.log('\nA janela de edição é do WhatsApp\n')

conferir('são quinze minutos', MINUTOS_PARA_EDITAR, 15)

const agora = new Date('2026-11-19T12:00:00.000Z')
const minutosAtras = (m: number) => new Date(agora.getTime() - m * 60_000)

conferir('acabou de enviar', podeEditarAinda(agora, agora), true)
conferir('um minuto atrás', podeEditarAinda(minutosAtras(1), agora), true)
conferir('14 minutos e 59 segundos', podeEditarAinda(new Date(agora.getTime() - 899_000), agora), true)
// O limite é inclusivo: exatamente quinze ainda vale. Escolha deliberada — a
// borda tem de estar escrita em algum lugar, e recusar no milissegundo exato
// seria recusar o que o WhatsApp aceita.
conferir('exatamente quinze minutos ainda vale', podeEditarAinda(minutosAtras(15), agora), true)
conferir('quinze minutos e um segundo não', podeEditarAinda(new Date(agora.getTime() - 901_000), agora), false)
conferir('uma hora atrás', podeEditarAinda(minutosAtras(60), agora), false)
conferir('ontem', podeEditarAinda(minutosAtras(60 * 24), agora), false)

console.log('\nQuem pode apagar e editar — e quem não pode\n')

/**
 * A capacidade é lida pela PRESENÇA do método, e é isso que a tela consulta.
 *
 * Se um dia a Meta passar a oferecer, implementar no `metaWhatsApp` liga o
 * botão sozinho, sem tocar na rota nem na tela. E enquanto não oferecer, estas
 * duas linhas impedem alguém de "ligar para todos" por engano.
 */
/**
 * Lidos **pela interface**, e não pela classe concreta — como a tela os lê.
 *
 * `metaWhatsApp.revoke` nem compila: a classe não declara o método, e o
 * TypeScript recusa o acesso. Isso é bom (prova que a classe não o tem) mas não
 * é a pergunta: a pergunta é o que um `ChannelProvider` oferece em tempo de
 * execução, porque é assim que a rota e a tela decidem.
 */
const qr: ChannelProvider = evolutionGo
const oficial: ChannelProvider = metaWhatsApp
const direct: ChannelProvider = instagramDirect

conferir('QR: apaga', typeof qr.revoke === 'function', true)
conferir('QR: edita', typeof qr.editText === 'function', true)
conferir('oficial (Cloud API): NÃO apaga', oficial.revoke === undefined, true)
conferir('oficial (Cloud API): NÃO edita', oficial.editText === undefined, true)
conferir('Instagram: NÃO apaga', direct.revoke === undefined, true)
conferir('Instagram: NÃO edita', direct.editText === undefined, true)

console.log(`\n${ok} ok, ${falhas} falha(s)\n`)
process.exit(falhas > 0 ? 1 : 0)
