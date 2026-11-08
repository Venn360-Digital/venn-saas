/**
 * O conteúdo de uma campanha de e-mail, em blocos, e o HTML que sai deles.
 *
 * ## Por que esta casca não é a de `layout.ts`
 *
 * `renderEmail` serve o transacional: assina com a nossa marca, tem um botão
 * obrigatório e um rodapé que aponta para o nosso app (`/suporte`, `/plano`).
 * Campanha sai do **domínio do cliente**, com a marca dele — reusar aquela
 * casca mandaria o paciente de uma clínica para a tela de assinatura da
 * plataforma, e anunciaria a nossa marca num e-mail que não é nosso.
 *
 * O que se reusa é a **técnica**, que é o que custou caro para descobrir:
 * tabela aninhada com estilo em atributo, porque cliente de e-mail não é
 * navegador — o Outlook renderiza com o motor do Word, o Gmail remove `<style>`
 * em alguns contextos e flexbox não é confiável em nenhum dos dois.
 *
 * ## Por que blocos e não HTML do cliente
 *
 * Três coisas que HTML cru custaria: o dono da clínica teria de escrever HTML;
 * um `<script>` ou `onerror=` colado de fora viraria problema nosso, e o
 * projeto **não tem sanitizador** (nem `dompurify` nem `sanitize-html`); e a
 * casca não poderia melhorar depois sem reescrever cada template salvo.
 *
 * Com blocos, o conteúdo é dado e a aparência é código. E não existe caminho
 * para HTML arbitrário chegar ao e-mail: todo texto passa por `esc()`, e toda
 * URL por `urlSegura()`.
 */

export type Bloco =
    | { tipo: 'titulo'; texto: string }
    | { tipo: 'texto'; texto: string }
    | { tipo: 'imagem'; url: string; alt?: string; link?: string }
    | { tipo: 'botao'; texto: string; url: string }
    | { tipo: 'divisor' }

/** Os tipos aceitos, para a tela oferecer e a rota validar pela mesma lista. */
export const TIPOS_DE_BLOCO: Bloco['tipo'][] = [
    'titulo',
    'texto',
    'imagem',
    'botao',
    'divisor',
]

const FONTE =
    "'Open Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif"

const TINTA = '#1f2937'
const TINTA_FRACA = '#6b7280'
const LINHA = '#e5e7eb'
const FUNDO = '#f4f5f7'

/**
 * A cor do botão — neutra, e **não** a da nossa marca.
 *
 * `BRAND.colors.teal` seria o reflexo errado: o e-mail sai do domínio do
 * cliente, com o nome dele no remetente, e pintar o botão com a nossa cor
 * anunciaria a plataforma num e-mail que não é dela. Quase-preto funciona em
 * qualquer identidade e não compete com a marca de ninguém.
 *
 * O dia em que a unidade tiver cor própria no cadastro, ela entra aqui como
 * parâmetro da casca — o lugar já está isolado.
 */
const BOTAO = TINTA

/** Escapa o que vai para o HTML. */
function esc(texto: string): string {
    return texto
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

/**
 * Só `http` e `https` passam.
 *
 * Sem isto, um `javascript:` num bloco de botão viaja até o cliente de e-mail.
 * A maioria dos clientes o bloqueia, e "a maioria" não é garantia que se
 * publique em nome da clínica. URL recusada vira `#`, que não navega.
 */
function urlSegura(url: string): string {
    try {
        const alvo = new URL(url)
        return alvo.protocol === 'http:' || alvo.protocol === 'https:' ? alvo.toString() : '#'
    } catch {
        return '#'
    }
}

// ─────────────────────────── Campos de mesclagem ───────────────────────────

/**
 * O que `{{...}}` aceita no texto de um bloco.
 *
 * Curto de propósito. A tentação é expor a ficha inteira, e o custo aparece no
 * envio: campo que não existe naquele contato vira buraco no meio da frase
 * ("Olá , tudo bem?"), e quem lê não sabe se a clínica foi desleixada ou se o
 * cadastro dela está furado. Cada campo aqui tem um padrão de queda — ver
 * `aplicarCampos`.
 */
export interface CamposDaMesclagem {
    /** O primeiro nome. Mais natural que o nome inteiro numa saudação. */
    nome?: string | null
    nomeCompleto?: string | null
    /** O nome da unidade que está enviando. */
    unidade?: string | null
}

const PADRAO_DE_QUEDA: Record<keyof CamposDaMesclagem, string> = {
    // "Olá, tudo bem?" em vez de "Olá , tudo bem?" — a vírgula órfã é o que
    // denuncia o disparo em massa.
    nome: 'tudo bem',
    nomeCompleto: '',
    unidade: '',
}

/**
 * Troca `{{nome}}` pelo valor, ou pelo padrão de queda quando não há valor.
 *
 * Marcador desconhecido fica **como está**, visível. Apagá-lo em silêncio
 * esconderia o erro de digitação até o e-mail já ter saído para dois mil
 * contatos; deixá-lo à vista faz a prévia na tela acusar antes do disparo.
 */
export function aplicarCampos(texto: string, campos: CamposDaMesclagem): string {
    return texto.replace(/\{\{\s*(\w+)\s*\}\}/g, (inteiro, chave: string) => {
        if (!(chave in PADRAO_DE_QUEDA)) return inteiro
        const nome = chave as keyof CamposDaMesclagem
        const valor = campos[nome]
        return valor && valor.trim().length > 0 ? valor.trim() : PADRAO_DE_QUEDA[nome]
    })
}

/** O primeiro nome, para `{{nome}}`. */
export function primeiroNome(nomeCompleto: string | null | undefined): string | null {
    const limpo = (nomeCompleto ?? '').trim()
    if (limpo.length === 0) return null
    return limpo.split(/\s+/)[0]
}

// ──────────────────────────────── Blocos ────────────────────────────────

function renderBloco(bloco: Bloco, campos: CamposDaMesclagem): string {
    const linha = (conteudo: string) => `<tr><td style="padding:0 32px;">${conteudo}</td></tr>`

    switch (bloco.tipo) {
        case 'titulo':
            return linha(
                `<h1 style="margin:24px 0 8px;font-family:${FONTE};font-size:24px;line-height:1.3;font-weight:700;color:${TINTA};">${esc(aplicarCampos(bloco.texto, campos))}</h1>`
            )

        case 'texto':
            // Cada linha em branco separa parágrafo. É como se escreve num
            // textarea, e evita pedir que o usuário pense em markup.
            return aplicarCampos(bloco.texto, campos)
                .split(/\n{2,}/)
                .filter((p) => p.trim().length > 0)
                .map((p) =>
                    linha(
                        `<p style="margin:0 0 16px;font-family:${FONTE};font-size:16px;line-height:1.6;color:${TINTA};">${esc(p.trim()).replace(/\n/g, '<br>')}</p>`
                    )
                )
                .join('')

        case 'imagem': {
            // `max-width:100%` e `height:auto` para a imagem não estourar a
            // largura no celular; `display:block` mata o vão que o Outlook
            // desenha embaixo de img dentro de tabela.
            const img = `<img src="${esc(urlSegura(bloco.url))}" alt="${esc(bloco.alt ?? '')}" width="536" style="display:block;width:100%;max-width:536px;height:auto;border:0;border-radius:8px;">`
            return linha(
                bloco.link
                    ? `<a href="${esc(urlSegura(bloco.link))}" style="text-decoration:none;">${img}</a>`
                    : img
            )
        }

        case 'botao':
            // Tabela em volta do link, não um `<a>` com padding: o Outlook ignora
            // padding em âncora e o botão sai como texto sublinhado.
            return linha(
                `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;"><tr><td align="center" bgcolor="${BOTAO}" style="border-radius:8px;"><a href="${esc(urlSegura(bloco.url))}" style="display:inline-block;padding:14px 28px;font-family:${FONTE};font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;">${esc(aplicarCampos(bloco.texto, campos))}</a></td></tr></table>`
            )

        case 'divisor':
            return linha(
                `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid ${LINHA};font-size:0;line-height:0;height:1px;">&nbsp;</td></tr></table><div style="height:16px;"></div>`
            )
    }
}

export interface CascaDeCampanha {
    blocos: Bloco[]
    campos: CamposDaMesclagem
    /** O nome que assina o rodapé — a unidade, não a plataforma. */
    assinatura: string
    /**
     * O link de descadastro. **Obrigatório**, e não por formalidade: sem saída
     * visível, quem quer sair marca como spam, e reclamação é a métrica que
     * derruba a reputação do domínio do cliente.
     */
    descadastroUrl: string
    /** A linha de prévia ao lado do assunto na caixa de entrada. */
    preheader?: string
}

/**
 * O HTML completo de um e-mail de campanha.
 *
 * A largura de 600px é a convenção que cabe no painel de leitura do Outlook sem
 * rolagem horizontal; 536 é ela menos os 32px de respiro de cada lado, e é por
 * isso que a imagem tem esse `max-width`.
 */
export function renderCampanha(casca: CascaDeCampanha): string {
    const corpo = casca.blocos.map((b) => renderBloco(b, casca.campos)).join('')

    /**
     * O preheader some da tela e aparece na lista de mensagens.
     *
     * Os caracteres invisíveis depois do texto empurram para longe o que o
     * cliente de e-mail pegaria em seguida — sem eles, a caixa de entrada mostra
     * o preheader seguido do começo do primeiro parágrafo, colados.
     */
    const previa = casca.preheader
        ? `<div style="display:none;font-size:1px;color:${FUNDO};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${esc(aplicarCampos(casca.preheader, casca.campos))}${'&#8199;&#65279;&#847; '.repeat(30)}</div>`
        : ''

    return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:0;background-color:${FUNDO};">
${previa}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${FUNDO};"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border-radius:12px;">
${corpo}
<tr><td style="padding:8px 32px 28px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid ${LINHA};padding-top:16px;font-family:${FONTE};font-size:12px;line-height:1.6;color:${TINTA_FRACA};">
<p style="margin:0 0 6px;">${esc(casca.assinatura)}</p>
<p style="margin:0;">Você recebe este e-mail porque está cadastrado neste contato.<br><a href="${esc(urlSegura(casca.descadastroUrl))}" style="color:${TINTA_FRACA};text-decoration:underline;">Não quero mais receber estes e-mails</a></p>
</td></tr></table>
</td></tr>
</table>
</td></tr></table>
</body></html>`
}

/**
 * A versão em texto puro, derivada dos mesmos blocos.
 *
 * Derivada dos blocos e **não** por strip de tags do HTML: o strip perderia o
 * destino dos botões — o leitor de texto veria "Agendar agora" sem link nenhum.
 * Aqui o botão sai como rótulo seguido da URL.
 *
 * E-mail só-HTML pesa contra a entrega; é a mesma regra que o transacional já
 * segue em `send.ts`.
 */
export function campanhaEmTexto(casca: CascaDeCampanha): string {
    const partes: string[] = []

    for (const bloco of casca.blocos) {
        switch (bloco.tipo) {
            case 'titulo':
                partes.push(aplicarCampos(bloco.texto, casca.campos).trim())
                break
            case 'texto':
                partes.push(aplicarCampos(bloco.texto, casca.campos).trim())
                break
            case 'botao':
                partes.push(
                    `${aplicarCampos(bloco.texto, casca.campos).trim()}: ${urlSegura(bloco.url)}`
                )
                break
            case 'imagem':
                if (bloco.alt) partes.push(`[${bloco.alt}]`)
                break
            case 'divisor':
                partes.push('---')
                break
        }
    }

    partes.push('---')
    partes.push(casca.assinatura)
    partes.push(`Para não receber mais estes e-mails: ${casca.descadastroUrl}`)

    return partes.filter((p) => p.length > 0).join('\n\n')
}

// ────────────────────────────── Validação ──────────────────────────────

/**
 * Lê o `blocks Json` do banco como lista de blocos.
 *
 * Valida aqui e não no schema porque acrescentar um tipo de bloco não deve ser
 * migração. Bloco de forma errada é **descartado**, não lançado: um template
 * salvo por uma versão anterior do editor não pode derrubar o disparo inteiro da
 * campanha — ele rende o que dá para render.
 */
export function lerBlocos(valor: unknown): Bloco[] {
    if (!Array.isArray(valor)) return []

    return valor.filter((item): item is Bloco => {
        if (typeof item !== 'object' || item === null) return false
        const b = item as Record<string, unknown>
        switch (b.tipo) {
            case 'titulo':
            case 'texto':
                return typeof b.texto === 'string'
            case 'imagem':
                return typeof b.url === 'string'
            case 'botao':
                return typeof b.texto === 'string' && typeof b.url === 'string'
            case 'divisor':
                return true
            default:
                return false
        }
    })
}
