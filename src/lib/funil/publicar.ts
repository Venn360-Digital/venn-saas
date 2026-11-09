import {
    cicloNoDesenho,
    lerCondicao,
    minutosDeEspera,
    primeiroPasso,
    TIPOS_DE_PASSO,
    type PassoDoFunil,
} from './passos'
import { lerGatilho } from './gatilho'

/**
 * O que um funil precisa ter para ser publicado.
 *
 * Lógica pura — nenhuma consulta, nenhum binding — porque é a guarda mais
 * importante desta feature e precisa de prova nesta máquina. Publicar é o ato
 * que liga o automatismo: depois dele, o funil fala com pacientes sozinho.
 *
 * Toda recusa devolve **frase**, não código. A tela mostra o texto como está, e
 * um dicionário paralelo lá divergiria deste.
 */

/** Teto de passos num desenho — o mesmo do levantamento de referência. */
export const MAX_PASSOS = 100

export interface DesenhoParaPublicar {
    trigger: unknown
    maxAtivos: number | null
    passos: readonly PassoDoFunil[]
}

export type Recusa = {
    motivo: string
    ciclo?: string[]
    /** O passo que precisa de atenção, para o canvas destacá-lo. */
    passoId?: string
}

/**
 * Pode publicar? `null` quando sim.
 *
 * A ordem das conferências é a ordem em que elas ajudam quem está desenhando:
 * primeiro o que falta, depois o que está errado, por último o que é perigoso.
 */
export function podePublicar(desenho: DesenhoParaPublicar): Recusa | null {
    const gatilho = lerGatilho(desenho.trigger)
    if (!gatilho) {
        return {
            motivo:
                'Escolha o que faz alguém entrar neste funil. Gatilho de etiqueta, etapa ou ' +
                'lista também precisa dizer qual.',
        }
    }

    if (!primeiroPasso(desenho.passos)) {
        return {
            motivo:
                'O funil não tem passo nenhum. Publicado assim, ele receberia gente e a ' +
                'passagem terminaria sem nada ter sido enviado.',
        }
    }

    if (desenho.passos.length > MAX_PASSOS) {
        return {
            motivo: `O funil tem ${desenho.passos.length} passos e o limite é ${MAX_PASSOS}.`,
        }
    }

    const desconhecido = desenho.passos.find(
        (p) => !(TIPOS_DE_PASSO as string[]).includes(p.type)
    )
    if (desconhecido) {
        return {
            motivo: `Há um passo de tipo desconhecido ("${desconhecido.type}"). O motor pararia a passagem nele.`,
        }
    }

    /**
     * Passo que **faz** alguma coisa precisa saber o quê.
     *
     * Sem isto, um funil da galeria publicava e toda passagem falhava no
     * primeiro passo — o motor devolve "passo sem assunto ou sem conteúdo" e
     * encerra, de propósito (seguir deixaria a sequência sem começo). O
     * resultado para quem usa: 100% de falha, e o motivo só visível depois de
     * alguém ter entrado.
     *
     * A conferência é do que é **puro**: a pessoa escolheu um modelo, ou
     * escreveu um assunto? Se o modelo existe de verdade é fato do banco, e o
     * motor cobra na hora; se foi escolhido é fato do desenho, e se cobra aqui.
     */
    const incompleto = desenho.passos.find((p) => faltaConfig(p))
    if (incompleto) {
        return {
            motivo: TEXTO_DO_INCOMPLETO[incompleto.type] ?? 'Há um passo sem configuração.',
            passoId: incompleto.id,
        }
    }

    /**
     * Gatilho de lista **exige** teto de ativos.
     *
     * Lista recebe gente em lote por construção, e a primeira sincronização de
     * uma lista por filtro sobre uma base que já existe é indistinguível de um
     * disparo em massa: todo mundo é "novo". Sem teto, um funil de boas-vindas
     * ligado a uma lista de dois mil pacientes antigos manda dois mil e-mails
     * dizendo "seja bem-vindo" para quem é cliente há dez anos — e a reclamação
     * queima a reputação do domínio da clínica.
     *
     * O número não é escolhido aqui, e isso é o ponto: quem conhece a base é a
     * clínica. A exigência é ter um.
     */
    if (gatilho.tipo === 'entrou_na_lista' && !temTeto(desenho.maxAtivos)) {
        return {
            motivo:
                'Funil que entra por lista precisa de um teto de pessoas ativas. Lista recebe ' +
                'gente em lote, e sem teto a primeira sincronização pode mandar a sequência ' +
                'para a base inteira de uma vez.',
        }
    }

    /**
     * Ciclo é a última conferência e a mais grave.
     *
     * Ele não dá erro — ele funciona, e a passagem manda a mesma sequência para
     * sempre. A espera não salva: `step.sleep` atrasa a volta, não a interrompe.
     * Quem nota primeiro é a pessoa que está recebendo.
     */
    const ciclo = cicloNoDesenho(desenho.passos)
    if (ciclo) {
        return {
            motivo:
                'O desenho volta sobre si mesmo, e a sequência sairia sem parar. Desligue uma ' +
                'das ligações destacadas.',
            ciclo,
        }
    }

    return null
}

function temTeto(maxAtivos: number | null): boolean {
    return typeof maxAtivos === 'number' && Number.isFinite(maxAtivos) && maxAtivos > 0
}

/**
 * O que falta em cada tipo de passo, dito para quem está desenhando.
 *
 * Frase por tipo, e não uma genérica: "configure o passo" obriga a pessoa a
 * abrir o nó para descobrir o quê.
 */
const TEXTO_DO_INCOMPLETO: Record<string, string> = {
    mensagem: 'Há um passo de mensagem sem assunto e sem modelo escolhido. Ele falharia no envio.',
    espera: 'Há um passo de espera sem tempo definido. Ele seguiria em frente na hora.',
    condicao: 'Há uma condição sem pergunta escolhida — ela sempre seguiria pelo "não".',
    etiquetar: 'Há um passo de etiqueta sem etiqueta escolhida.',
    mover_etapa: 'Há um passo de etapa sem etapa escolhida.',
    atribuir: 'Há um passo de atribuição sem pessoa escolhida.',
}

/**
 * Falta configuração neste passo?
 *
 * `encerrar` nunca falta nada — ele é só o fim.
 */
function faltaConfig(passo: PassoDoFunil): boolean {
    const c = comoObjeto(passo.config)

    switch (passo.type) {
        case 'mensagem':
            return !texto(c.templateId) && !texto(c.assunto)
        /**
         * Espera sem tempo é o caso mais traiçoeiro: ela vale zero e o motor
         * **segue sem dormir**, que é o comportamento seguro para config
         * inválida. Mas num desenho publicado significa três mensagens no mesmo
         * minuto, e ninguém escreveu um passo de espera querendo zero.
         */
        case 'espera':
            return minutosDeEspera(passo.config) <= 0
        case 'condicao':
            return lerCondicao(passo.config) === null
        case 'etiquetar':
            return !texto(c.tagId)
        case 'mover_etapa':
            return !texto(c.stageId)
        case 'atribuir':
            return !texto(c.userId)
        default:
            return false
    }
}

function comoObjeto(v: unknown): Record<string, unknown> {
    return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {}
}

function texto(v: unknown): string | undefined {
    return typeof v === 'string' && v.trim().length > 0 ? v : undefined
}
