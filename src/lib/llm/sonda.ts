/**
 * A decisão da sonda de credencial de IA, em função pura.
 *
 * Separada da chamada de rede para poder ser exercitada sem chave e sem
 * gateway: o que importa aqui é **qual resposta vira incidente**, e isso é uma
 * tabela de decisão, não um `fetch`.
 *
 * ## Por que uma sonda, e não leitura do log do gateway
 *
 * O AI Gateway registra cada chamada com o status, e dava para raspar aquele
 * log. Dois problemas afundam esse caminho. O primeiro é que ler o log exige um
 * token Cloudflare de `AI Gateway Read` **dentro** do Worker, e essa permissão
 * não se restringe a um gateway — seria pôr nos três apps uma credencial que
 * alcança os três. O segundo é mais simples: log só tem linha quando houve
 * chamada. Numa conta cujas conversas são todas atribuídas a uma pessoa, o
 * agente não é invocado, e a chave pode estar quebrada por semanas sem
 * produzir uma única linha de log para raspar.
 *
 * Foi exatamente o que aconteceu em 03/11/2026: a chave da Odontobox ficou
 * inválida por três dias, 29 notas de voz ficaram sem transcrição, e o único
 * vestígio eram 401 num log que ninguém lê. Uma sonda não depende de tráfego —
 * ela **produz** o tráfego, uma vez por dia, e o custo é de um embedding de uma
 * palavra.
 */

/** Como a sonda terminou, e o que fazer a respeito. */
export type Veredito =
    | { estado: 'ok' }
    | { estado: 'credencial'; status: number; detalhe: string }
    | { estado: 'modelo'; status: number; detalhe: string }
    | { estado: 'indisponivel'; status: number; detalhe: string }
    | { estado: 'sem-chave' }

/**
 * O que a resposta do provedor significa.
 *
 * Três classes, porque elas pedem reações diferentes e misturá-las é o que
 * treina alguém a ignorar o aviso:
 *
 * - **credencial** (401, 403): configuração errada. Nunca é passageiro, nunca
 *   se cura sozinho, e é o caso que motivou isto existir. Avisa.
 * - **modelo** (404, e o 403 com `model_not_found`): a chave vale, mas o
 *   projeto não liberou o modelo na allowlist. Também é configuração, e também
 *   avisa — mas o conserto é outro, então o e-mail não pode dizer a mesma
 *   coisa.
 * - **indisponivel** (429, 5xx): passageiro. **Não** avisa. A sonda roda uma
 *   vez por dia; transformar um 503 momentâneo da OpenAI em e-mail de
 *   incidente seria ensinar o suporte a apagar o aviso sem ler.
 */
export function julgar(status: number, corpo: string): Veredito {
    const detalhe = corpo.slice(0, 200)

    if (status === 200) return { estado: 'ok' }

    // O 403 é ambíguo na OpenAI: credencial sem permissão **e** modelo fora da
    // allowlist voltam 403. O corpo é o que separa os dois, e errar aqui manda
    // a pessoa trocar a chave quando o problema é a allowlist.
    if (status === 404 || (status === 403 && /model/i.test(corpo))) {
        return { estado: 'modelo', status, detalhe }
    }

    if (status === 401 || status === 403) {
        return { estado: 'credencial', status, detalhe }
    }

    return { estado: 'indisponivel', status, detalhe }
}

/** Os vereditos que viram e-mail. */
export type VereditoComAviso = Extract<
    Veredito,
    { estado: 'credencial' } | { estado: 'modelo' } | { estado: 'sem-chave' }
>

/**
 * Este veredito merece e-mail?
 *
 * Devolve um type guard e não `boolean` para que o chamador saia daqui com o
 * tipo estreitado: sem isso, quem monta o e-mail precisa ler `.status` de uma
 * união que ainda inclui `ok`, e aí ou se repete a checagem ou se usa `as`.
 */
export function mereceAviso(veredito: Veredito): veredito is VereditoComAviso {
    return (
        veredito.estado === 'credencial' ||
        veredito.estado === 'modelo' ||
        veredito.estado === 'sem-chave'
    )
}

/** O assunto do e-mail, por classe — quem lê às 3 h da manhã lê só isto. */
export function assuntoDoAviso(veredito: VereditoComAviso, app: string): string {
    switch (veredito.estado) {
        case 'sem-chave':
            return `[${app}] A IA está sem chave configurada`
        case 'credencial':
            return `[${app}] A chave da OpenAI foi recusada (${veredito.status})`
        case 'modelo':
            return `[${app}] O modelo da transcrição não está liberado (${veredito.status})`
        default:
            return `[${app}] Sonda de IA`
    }
}

/**
 * O que fazer, em uma frase, no corpo do e-mail.
 *
 * O aviso serve para quem vai agir, então ele diz o comando — não "verifique a
 * configuração".
 */
export function comoConsertar(veredito: VereditoComAviso, app: string): string[] {
    switch (veredito.estado) {
        case 'sem-chave':
            return [
                `Nenhuma chave está definida para a IA deste app. Enquanto isso durar, ` +
                    `nota de voz chega sem transcrição e o agente não responde.`,
                `Conserto: gravar o segredo da IA no cofre da conta e conferir que o ` +
                    `Worker <strong>${app}</strong> tem o binding.`,
            ]
        case 'credencial':
            return [
                `A chave existe, e a OpenAI a recusou. Isso não se cura sozinho: ` +
                    `enquanto durar, nota de voz chega sem transcrição e o agente não responde.`,
                `Conserto: gravar o valor correto no cofre da conta. Uma chave, ` +
                    `um lugar — os três apps leem o mesmo segredo.`,
            ]
        case 'modelo':
            return [
                `A chave vale, mas o projeto da OpenAI não liberou o modelo que a ` +
                    `transcrição usa. O agente de texto pode continuar respondendo, ` +
                    `então o sintoma aparece só no áudio.`,
                `Conserto: liberar o modelo na allowlist do projeto, no painel da OpenAI.`,
            ]
        default:
            return []
    }
}
