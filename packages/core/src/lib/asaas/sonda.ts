/**
 * A decisão da sonda de credencial do Asaas, em função pura.
 *
 * Gêmea de `lib/llm/sonda.ts`, e de propósito: a lição é a mesma e a forma
 * também. Separada da chamada de rede para poder ser exercitada sem chave e sem
 * gateway — o que importa aqui é **qual resposta vira incidente**, e isso é uma
 * tabela de decisão, não um `fetch`.
 *
 * ## Por que uma sonda, e não contar falhas das chamadas de verdade
 *
 * Porque a chave do Asaas **morre de não ser usada**, e contar falhas só
 * funciona se houver chamadas. A documentação deles é específica sobre o
 * relógio:
 *
 * | inatividade | o que acontece |
 * |---|---|
 * | 3 meses | a chave é **desabilitada** e passa a responder 401 |
 * | 4 meses | 1º aviso, por e-mail e webhook |
 * | 5 meses | 2º aviso |
 * | ~5 meses e 3 semanas | último aviso |
 * | 6 meses | **expirada em definitivo, sem reativação** |
 *
 * Três meses é pouco, e o ambiente que fica ocioso é justamente **homologação**:
 * ninguém assina plano em staging por semanas. O resultado seria descobrir a
 * chave morta no dia do teste — que foi quase o que aconteceu em 27/11/2026,
 * por outro motivo (valor marcador no cofre).
 *
 * E uma chamada autenticada por dia resolve as duas coisas ao mesmo tempo: ela
 * **reinicia o relógio** e **mede** se a credencial responde.
 *
 * ## Os códigos são os deles, lidos da documentação
 *
 * `invalid_access_token`, `access_token_not_found` e `invalid_environment` são
 * os três códigos que o Asaas devolve em 401. Separá-los importa porque o
 * conserto de cada um é diferente — e porque um deles **não é configuração, é
 * defeito nosso**: `access_token_not_found` quer dizer que o header não foi
 * enviado, e nenhum valor novo no cofre conserta código que esqueceu de mandar
 * o header.
 */

/** Como a sonda terminou, e o que fazer a respeito. */
export type Veredito =
    | { estado: 'ok' }
    /** A chave existe e foi recusada: desabilitada, expirada, trocada ou errada. */
    | { estado: 'credencial'; status: number; detalhe: string }
    /** A chave é de um ambiente e a URL é de outro — `invalid_environment`. */
    | { estado: 'ambiente'; status: number; detalhe: string }
    /** O header não chegou lá: `access_token_not_found`. Defeito nosso. */
    | { estado: 'sem-header'; status: number; detalhe: string }
    /** 429 e 5xx. Passageiro, e a sonda roda de novo amanhã. */
    | { estado: 'indisponivel'; status: number; detalhe: string }
    /** `asaasConfig()` devolveu nulo: cofre vazio, valor em branco ou prefixo irreconhecível. */
    | { estado: 'sem-chave' }

/**
 * O que a resposta do Asaas significa.
 *
 * Quatro classes, porque elas pedem reações diferentes e misturá-las é o que
 * treina alguém a ignorar o aviso:
 *
 * - **credencial**: configuração. Nunca passageiro, nunca se cura sozinho.
 * - **ambiente**: configuração, mas o conserto é outro — não é trocar a chave,
 *   é parar de misturar sandbox com produção. Dizer "a chave foi recusada" aqui
 *   mandaria a pessoa gerar chave nova para um problema que chave nova não
 *   resolve.
 * - **sem-header**: nosso. O e-mail tem de dizer isso, senão alguém vai mexer
 *   no cofre por uma hora à procura de um valor que já estava certo.
 * - **indisponivel**: passageiro. **Não** avisa.
 *
 * O corpo é lido por `code`, não por mensagem: a descrição deles é texto para
 * humano e pode mudar de uma versão para outra; o código é contrato.
 */
export function julgar(status: number, corpo: string): Veredito {
    const detalhe = corpo.slice(0, 200)

    if (status >= 200 && status < 300) return { estado: 'ok' }

    if (status === 401 || status === 403) {
        if (/invalid_environment/.test(corpo)) return { estado: 'ambiente', status, detalhe }
        if (/access_token_not_found/.test(corpo)) return { estado: 'sem-header', status, detalhe }
        return { estado: 'credencial', status, detalhe }
    }

    return { estado: 'indisponivel', status, detalhe }
}

/** Os vereditos que viram e-mail. */
export type VereditoComAviso = Extract<
    Veredito,
    | { estado: 'credencial' }
    | { estado: 'ambiente' }
    | { estado: 'sem-header' }
    | { estado: 'sem-chave' }
>

/**
 * Este veredito merece e-mail?
 *
 * Type guard e não `boolean`, como na sonda de IA e pela mesma razão: quem monta
 * o e-mail sai daqui com o tipo estreitado, sem repetir a checagem nem usar
 * `as`.
 */
export function mereceAviso(veredito: Veredito): veredito is VereditoComAviso {
    return (
        veredito.estado === 'credencial' ||
        veredito.estado === 'ambiente' ||
        veredito.estado === 'sem-header' ||
        veredito.estado === 'sem-chave'
    )
}

/** O assunto do e-mail, por classe — quem lê às 3 h da manhã lê só isto. */
export function assuntoDoAviso(veredito: VereditoComAviso, app: string): string {
    switch (veredito.estado) {
        case 'sem-chave':
            return `[${app}] O Asaas está sem chave configurada`
        case 'ambiente':
            return `[${app}] A chave do Asaas é de outro ambiente`
        case 'sem-header':
            return `[${app}] As chamadas ao Asaas estão sem o header de autenticação`
        case 'credencial':
            return `[${app}] A chave do Asaas foi recusada (${veredito.status})`
    }
}

/**
 * O que fazer, em uma frase, no corpo do e-mail.
 *
 * O aviso serve para quem vai agir, então ele diz o comando — não "verifique a
 * configuração". `app` entra no comando porque o segredo é por Worker, e o nome
 * do Worker é o que falta na hora de digitar.
 */
export function comoConsertar(veredito: VereditoComAviso, app: string): string[] {
    const consequencia =
        `Enquanto isto durar, ninguém consegue contratar plano nem comprar adicional: ` +
        `a cobrança não é criada. Quem já é cliente continua atendendo — o corte por ` +
        `inadimplência não depende desta chave.`

    switch (veredito.estado) {
        case 'sem-chave':
            return [
                `Nenhuma chave do Asaas está legível neste app. Pode ser cofre vazio, ` +
                    `valor em branco, ou um valor que não começa com <code>$aact_hmlg_</code> ` +
                    `nem <code>$aact_prod_</code> — o ambiente sai do prefixo, então prefixo ` +
                    `irreconhecível é o mesmo que chave ausente.`,
                consequencia,
                `Conserto: <code>npx wrangler secret put PLATFORM_ASAAS_CLIENT_ID --name ` +
                    `${app}</code>, com a chave do ambiente certo.`,
            ]
        case 'credencial':
            return [
                `A chave existe e o Asaas a recusou. Isso não se cura sozinho. A causa mais ` +
                    `provável é <strong>inatividade</strong>: eles desabilitam a chave aos 3 ` +
                    `meses sem uso e a expiram em definitivo aos 6.`,
                consequencia,
                `Conserto: reabilitar em Integrações → Chaves de API no painel do Asaas. ` +
                    `Se já passou de 6 meses, não há reativação — gere outra e grave com ` +
                    `<code>npx wrangler secret put PLATFORM_ASAAS_CLIENT_ID --name ${app}</code>.`,
            ]
        case 'ambiente':
            return [
                `A chave é válida, mas pertence a outro ambiente: ` +
                    `<code>invalid_environment</code>. Chave de homologação começa com ` +
                    `<code>$aact_hmlg_</code> e chave de produção com <code>$aact_prod_</code>.`,
                consequencia,
                `Conserto: gravar no Worker <strong>${app}</strong> a chave do ambiente ` +
                    `dele. Trocar a URL base <strong>não</strong> é opção — ela é derivada ` +
                    `do prefixo da chave, justamente para que ninguém possa apontar ` +
                    `homologação para produção.`,
            ]
        case 'sem-header':
            return [
                `O Asaas respondeu <code>access_token_not_found</code>: a chamada chegou ` +
                    `<strong>sem</strong> o header <code>access_token</code>. Isto é defeito ` +
                    `de código, não de configuração — não mexa no cofre.`,
                consequencia,
                `Conserto: conferir <code>lib/asaas/client.ts</code>. O header é ` +
                    `<code>access_token</code>, nunca <code>Authorization: Bearer</code>.`,
            ]
    }
}
