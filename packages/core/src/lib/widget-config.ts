/**
 * A aparência e as regras do widget do site — o que a clínica configura e o que
 * o navegador do visitante recebe.
 *
 * ## Onde mora, e por que não há migração
 *
 * Em `AgentIntegration.config`, que é `Json?` e já existe. A alternativa seria
 * oito colunas novas numa tabela que já tem vinte, para guardar o que nunca é
 * consultado por filtro — ninguém vai perguntar "quais widgets são bolha". E
 * migração custa caro neste ponto do portfólio: a produção dos clones ainda não
 * tem caminho para rodar uma (ver `migracoes-nos-3-apps`). JSON aqui é a
 * escolha certa pelos dois lados.
 *
 * ## Puro de propósito
 *
 * Sem Prisma, sem React, sem `server-only`. É lido pela tela de configuração,
 * pela API pública do widget e pelo script que roda no site do cliente — três
 * lugares, uma definição. E `origemPermitida` é a regra de autorização do
 * domínio: função pura, provada por `npm run test:widget-config`, porque uma
 * regra de autorização que só se testa pelo navegador não se testa.
 *
 * ## Não há foto aqui
 *
 * A foto que o visitante vê é a **do agente**, configurada em Treinamento →
 * Perfil. Uma segunda foto, só do widget, daria à clínica dois lugares para
 * manter a mesma cara e uma pergunta nova ("por que a do site é outra?") para
 * cada vez que as duas divergissem. O widget já enviava `agent.avatar` antes
 * desta configuração existir; o que mudou foi tudo em volta, não isso.
 */

export type FormatoDoWidget = 'bolha' | 'balao'
export type PosicaoDoWidget = 'direita' | 'esquerda'

export interface CapturaDeContato {
    nome: boolean
    whatsapp: boolean
    email: boolean
    /**
     * Pedir **antes** de deixar falar, ou oferecer e deixar pular.
     *
     * Obrigatório converte menos gente em conversa e qualifica mais quem
     * converte; opcional é o contrário. É decisão da clínica, não nossa — mas o
     * padrão é opcional, porque o pior desfecho possível é o visitante com
     * dúvida simples desistir na porta.
     */
    obrigatorio: boolean
}

export interface ConfiguracaoDoWidget {
    formato: FormatoDoWidget
    posicao: PosicaoDoWidget
    /** Cor principal, em hex. Vazio = a cor do agente. */
    cor: string | null
    /** Nome de quem atende, como o visitante lê. Vazio = o nome do agente. */
    nomeExibido: string | null
    /** Primeira mensagem. Vazio = a mensagem inicial do agente. */
    saudacao: string | null
    /**
     * Os domínios onde este widget pode abrir. **Vazio é "qualquer um"**, e
     * isso é deliberado: é o comportamento que todo widget já colado tem hoje,
     * e fechá-lo por omissão apagaria o atendimento dos sites no ar no deploy.
     * A tela diz, em palavras, o que a lista vazia significa.
     */
    dominios: string[]
    captura: CapturaDeContato
}

export const WIDGET_PADRAO: ConfiguracaoDoWidget = {
    formato: 'bolha',
    posicao: 'direita',
    cor: null,
    nomeExibido: null,
    saudacao: null,
    dominios: [],
    captura: { nome: false, whatsapp: false, email: false, obrigatorio: false },
}

const FORMATOS: FormatoDoWidget[] = ['bolha', 'balao']
const POSICOES: PosicaoDoWidget[] = ['direita', 'esquerda']

/** Cor que o CSS aceita sem interpretação: `#rgb` ou `#rrggbb`. */
function corValida(v: unknown): string | null {
    return typeof v === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim())
        ? v.trim()
        : null
}

function textoOuNulo(v: unknown, teto: number): string | null {
    if (typeof v !== 'string') return null
    const limpo = v.trim().slice(0, teto)
    return limpo.length > 0 ? limpo : null
}

/**
 * `https://WWW.Clinica.com.br:443/precos?x=1` → `www.clinica.com.br`.
 *
 * Só o host interessa: um widget autorizado em `clinica.com.br` vale em
 * qualquer página dela, e a porta e o esquema não dizem nada sobre de quem é o
 * site. Minúsculas porque host não diferencia caixa e digitar `Clinica.com.br`
 * não pode recusar o próprio site de quem digitou.
 */
export function hostDe(valor: string): string | null {
    const bruto = valor.trim()
    if (!bruto) return null
    try {
        const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(bruto) ? bruto : `https://${bruto}`)
        return url.hostname.toLowerCase() || null
    } catch {
        return null
    }
}

/**
 * A origem desta requisição pode abrir este widget?
 *
 * Regras, e cada uma tem um caso real atrás:
 *
 *  - **lista vazia libera.** É o estado de todo widget já colado; fechar por
 *    omissão derrubaria o atendimento dos sites no ar.
 *  - **sem `Origin` libera.** O cabeçalho não vem em navegação direta nem em
 *    `curl`, e a rota é pública de qualquer forma — tratar a ausência como
 *    recusa quebraria o widget em navegador que não manda `Origin` em `GET`
 *    sem credencial. O que a lista protege é o uso **em outra página**, e essa
 *    sempre manda `Origin`.
 *  - **subdomínio conta.** Autorizar `clinica.com.br` vale para
 *    `www.clinica.com.br`, que é onde metade dos sites realmente responde.
 *    Casar só o host exato faria a clínica cadastrar os dois e descobrir isso
 *    pelo widget sumindo no ar.
 *  - **`localhost` nunca entra sozinho**: se a clínica o cadastrar, vale; não
 *    é liberado por fora, para a lista significar exatamente o que ela diz.
 */
export function origemPermitida(origem: string | null, dominios: string[]): boolean {
    if (dominios.length === 0) return true
    if (!origem) return true

    const host = hostDe(origem)
    if (!host) return false

    return dominios.some((d) => {
        const permitido = hostDe(d)
        if (!permitido) return false
        return host === permitido || host.endsWith(`.${permitido}`)
    })
}

/**
 * Lê a coluna `config`, que é JSON e pode conter o que outra versão gravou.
 *
 * Tolerante por contrato: campo inválido cai no padrão em vez de derrubar o
 * atendimento do site. A coluna também guarda o que os **outros** canais
 * escrevem ali (`qrCode`, `sessionId`, `accessToken`) — por isso a leitura pega
 * chave a chave em vez de confiar na forma do objeto inteiro.
 */
export function lerConfiguracaoDoWidget(bruto: unknown): ConfiguracaoDoWidget {
    if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return WIDGET_PADRAO

    const raw = bruto as Record<string, unknown>
    const captura = (raw.captura ?? {}) as Record<string, unknown>

    const dominios = Array.isArray(raw.dominios)
        ? Array.from(
              new Set(
                  raw.dominios
                      .map((d) => (typeof d === 'string' ? hostDe(d) : null))
                      .filter((d): d is string => Boolean(d))
              )
          ).slice(0, 20)
        : []

    return {
        formato: FORMATOS.includes(raw.formato as FormatoDoWidget)
            ? (raw.formato as FormatoDoWidget)
            : WIDGET_PADRAO.formato,
        posicao: POSICOES.includes(raw.posicao as PosicaoDoWidget)
            ? (raw.posicao as PosicaoDoWidget)
            : WIDGET_PADRAO.posicao,
        cor: corValida(raw.cor),
        nomeExibido: textoOuNulo(raw.nomeExibido, 60),
        saudacao: textoOuNulo(raw.saudacao, 300),
        dominios,
        captura: {
            nome: captura.nome === true,
            whatsapp: captura.whatsapp === true,
            email: captura.email === true,
            /**
             * Obrigatório só vale quando há **o que** pedir. Marcado sozinho,
             * ele travaria a conversa atrás de um formulário sem campo — e o
             * visitante ficaria olhando um botão que não abre nada.
             */
            obrigatorio:
                captura.obrigatorio === true &&
                (captura.nome === true || captura.whatsapp === true || captura.email === true),
        },
    }
}

/** O que o PATCH da tela aceita gravar, já limpo. Mesma tolerância da leitura. */
export function sanearConfiguracaoDoWidget(bruto: unknown): ConfiguracaoDoWidget {
    return lerConfiguracaoDoWidget(bruto)
}

/**
 * A configuração pronta para a coluna JSON do Prisma.
 *
 * `InputJsonValue` não aceita `null` dentro de objeto — o Prisma reserva o nulo
 * de JSON para `Prisma.JsonNull`, no nível de cima. Como `lerConfiguracaoDoWidget`
 * trata **ausente e nulo do mesmo jeito** (os dois caem no valor do agente),
 * omitir a chave é equivalente a gravá-la nula, e é o que cabe no tipo.
 *
 * O ganho não é só de tipo: a linha gravada fica menor e diz só o que a clínica
 * escolheu, em vez de uma fileira de `null` que parece escolha.
 */
export function comoJsonDoWidget(config: ConfiguracaoDoWidget): Record<string, unknown> {
    const saida: Record<string, unknown> = {
        formato: config.formato,
        posicao: config.posicao,
        dominios: config.dominios,
        captura: { ...config.captura },
    }
    if (config.cor) saida.cor = config.cor
    if (config.nomeExibido) saida.nomeExibido = config.nomeExibido
    if (config.saudacao) saida.saudacao = config.saudacao
    return saida
}
