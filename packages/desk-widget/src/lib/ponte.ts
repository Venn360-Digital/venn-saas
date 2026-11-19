/**
 * A ponte entre o app hospedeiro e o painel do widget.
 *
 * ## Por que ela existe
 *
 * O botão flutuante do widget é `position: fixed` no canto inferior direito, e
 * num painel denso esse canto **não é vazio**: na tela de Conversas ele cobria o
 * botão Enviar. Trocar de canto não resolve — o inferior esquerdo é o rodapé da
 * sidebar (plano e usuário). O problema não é o lado, é flutuar sobre a área de
 * trabalho.
 *
 * O próprio widget já previa a saída: `tema.mostrarBotao === false` esconde o
 * botão e deixa o painel funcionando, "para abrir o painel só por um menu do
 * próprio app". Faltava o caminho para o app abrir.
 *
 * ## Por que não é contexto do React
 *
 * `<VennDeskProvider>` é montado como **folha** no layout (ver
 * `WidgetDoDesk.tsx`): envolver `{children}` arrastaria a árvore inteira do
 * painel para o cliente sem necessidade. Então quem quer abrir o painel — a
 * barra de cima, um item de menu — está FORA do provider e não alcança o
 * contexto.
 *
 * Esta ponte é um registro de módulo: o provider se anuncia ao montar, e quem
 * estiver fora chama `abrirSuporte()`. Dois providers não se atropelam porque o
 * widget é um por documento, e o último a montar é o que vale.
 *
 * ## O que ela NÃO faz
 *
 * Não carrega dado nenhum do chamado, nem estado de tela. Só "abra" e "quantas
 * não lidas" — o mínimo para um botão fora do widget existir e mostrar selo. Se
 * um dia precisar de mais, o lugar é o contexto, não aqui.
 */

export interface EstadoDaPonte {
    /** Há widget montado e com sessão: sem isso, o app não deve desenhar botão. */
    disponivel: boolean
    /** Respostas não lidas, para o selo. */
    naoLidas: number
}

/**
 * Exportada, e **a mesma referência sempre**.
 *
 * `useSyncExternalStore` compara snapshots por identidade e entra em laço se o
 * getter devolver objeto novo a cada chamada. Então "indisponível" é este
 * objeto, não um literal recriado — inclusive no snapshot do servidor.
 */
export const SUPORTE_INDISPONIVEL: EstadoDaPonte = { disponivel: false, naoLidas: 0 }

let estado: EstadoDaPonte = SUPORTE_INDISPONIVEL
let abrir: (() => void) | null = null
const ouvintes = new Set<(e: EstadoDaPonte) => void>()

function avisar(): void {
    for (const ouvinte of ouvintes) ouvinte(estado)
}

/**
 * Chamado pelo widget **ao montar**, e só.
 *
 * Devolve a função de baixa — o widget a chama ao desmontar, e é ela que faz o
 * botão do app desaparecer junto em vez de ficar apontando para um painel que
 * não existe mais.
 *
 * **Separado de `atualizarNaoLidas` de propósito, e isto consertou um defeito
 * que eu mesmo criei.** A primeira versão recebia o contador aqui, então o
 * widget tinha de registrar de novo a cada mudança dele — e cada registro novo
 * passa pela baixa do anterior, que publica "indisponível". O botão do app
 * piscava, sumindo e voltando, a cada atualização de contador. Montar e contar
 * são eventos de ritmos diferentes; quem os junta paga esse preço.
 */
export function registrarPonte(fn: () => void): () => void {
    abrir = fn
    estado = { disponivel: true, naoLidas: estado.naoLidas }
    avisar()

    return () => {
        // Só desmonta se ainda for o registro atual: num remonte rápido o novo
        // provider já se anunciou, e a baixa do antigo não pode apagá-lo.
        if (abrir !== fn) return
        abrir = null
        estado = SUPORTE_INDISPONIVEL
        avisar()
    }
}

/**
 * O contador do selo mudou.
 *
 * Silencioso quando não há widget registrado: contador sem painel não desenha
 * selo em lugar nenhum, e publicar "disponível" aqui ligaria o botão do app
 * antes de existir o que abrir.
 *
 * Sai sem avisar quando o número não mudou — o widget consulta os contadores em
 * intervalo, e a maioria das consultas devolve o mesmo número.
 */
export function atualizarNaoLidas(naoLidas: number): void {
    if (!estado.disponivel) return
    if (estado.naoLidas === naoLidas) return
    estado = { disponivel: true, naoLidas }
    avisar()
}

/** Abre o painel de suporte. Silencioso quando não há widget montado. */
export function abrirSuporte(): void {
    abrir?.()
}

/** O estado atual, para a primeira renderização. */
export function estadoDoSuporte(): EstadoDaPonte {
    return estado
}

/** Acompanha disponibilidade e contador. Devolve a função de cancelar. */
export function assinarSuporte(ouvinte: (e: EstadoDaPonte) => void): () => void {
    ouvintes.add(ouvinte)
    return () => {
        ouvintes.delete(ouvinte)
    }
}
