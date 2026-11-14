import 'server-only'

import { BRAND } from '../../marca'

/**
 * A casca dos e-mails transacionais, num lugar só.
 *
 * ## Por que tabela e estilo inline em 2026
 *
 * Cliente de e-mail não é navegador: Outlook renderiza com o motor do Word,
 * Gmail remove `<style>` em alguns contextos, e flexbox não é confiável em
 * nenhum dos dois. Tabela aninhada com estilo em atributo é o que chega igual
 * nos dois — é feio de ler e é o que funciona.
 *
 * ## O que mudou na revisão de 2026-11-05
 *
 * Ele pediu formato novo, mais ilustração do próprio app e rodapé revisado,
 * "alguns com links quebrados apontando para páginas inexistentes". As quatro
 * mudanças:
 *
 * 1. **Os links do rodapé existem.** Eram nenhum; o corpo das boas-vindas
 *    apontava para `/docs`, rota que **nunca existiu** — todo cliente novo
 *    recebia um 404. A ajuda mora em `/suporte` desde 2026-10-18. Agora os três
 *    links do rodapé saem de `CAMINHOS`, que é a lista do que existe.
 * 2. **O botão vai onde o rótulo promete.** Quem resolve isso é `ctaUrlFor` em
 *    `billing.ts`; a casca só recebe a URL pronta.
 * 3. **Ilustração do app, em tabela.** O desenho aprovado mostra uma miniatura
 *    da interface. SVG embutido não serve: o Gmail o remove e o Outlook não o
 *    desenha. Então a miniatura é feita de **tabelas com fundo colorido** —
 *    retângulos que insinuam a calha, a conversa e o botão. Funciona em
 *    qualquer cliente, e não envelhece como um print, que era a objeção do
 *    DESIGN.md (Tela 05) a capturar tela.
 * 4. **Passos numerados**, quando o e-mail pede ação em mais de um lugar. As
 *    boas-vindas tinham "configure seus números, adicione sua equipe e comece a
 *    atender" numa frase só, sem dizer onde fica nada disso.
 *
 * ## A palavra que muda entre os três apps
 *
 * `BRAND.vocabulario` carrega a palavra do nicho de cada produto. A casca nunca
 * escreve a palavra literal.
 */

/**
 * Preguiçoso, e isto não é estilo: a marca agora vem de um registro, e um
 * `const` aqui chamaria `BRAND()` no instante em que o módulo é avaliado —
 * antes de `registrarBrand()` se o grafo de imports mudar de ordem — e
 * congelaria o valor. Este módulo é carregado por fila e cron, onde não há
 * requisição para reavaliá-lo.
 */
function appUrl(): string {
    return process.env.NEXT_PUBLIC_APP_URL ?? `https://${BRAND().appHost}`
}

/**
 * A caixa que atende quem responde a um e-mail nosso.
 *
 * Fica aqui, e não repetida em `send.ts`, porque o rodapé e o `Reply-To` têm de
 * apontar para o mesmo lugar — divergir é anunciar um endereço e encaminhar
 * para outro.
 */
export const CONTATO = 'contato@venn360.com'

/**
 * Os destinos do rodapé — **e todos existem**.
 *
 * É a lista que fecha o defeito relatado. Acrescentar um link aqui obriga a
 * apontar para uma rota do app; `/docs` morreu porque alguém escreveu o caminho
 * à mão no corpo de um template.
 */
/**
 * Getters, e não valores — para os seis pontos de uso não mudarem.
 *
 * `CAMINHOS.ajuda` continua se escrevendo igual; o que mudou é QUANDO a marca
 * é lida. Como literal de módulo, este objeto chamaria `BRAND()` no import,
 * que é exatamente o que o registro não pode exigir.
 */
export const CAMINHOS = {
    get ajuda() { return `${appUrl()}/suporte` },
    get assinatura() { return `${appUrl()}/gerenciamento/conta?tab=plano` },
    get painel() { return `${appUrl()}/dashboard` },
    contato: `mailto:${CONTATO}`,
} as const

const FONTE =
    "'Open Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif"

const NAVY = '#0b1f3b'
const TEAL = '#06b6d4'
const MENTA = '#a7f3d0'
const GELO = '#e6f7f5'
const TINTA = '#53707f'
const LINHA = '#dce7ec'
const FUNDO = '#f8fbfd'
const AMBAR = '#b45309'

export interface PassoDoEmail {
    titulo: string
    corpo: string
}

export interface CascaDeEmail {
    headline: string
    /** Cada item vira um parágrafo. Aceita `<strong>` e `<a>`. */
    body: string[]
    cta: { texto: string; url: string }
    /** `urgent` pinta a tarja e o filete de âmbar. */
    tone?: 'neutral' | 'urgent'
    /** A miniatura do app, acima do título. */
    ilustracao?: 'conversa' | 'cobranca'
    /** Passos numerados, entre o corpo e o botão. */
    passos?: PassoDoEmail[]
    /** Uma linha sob o botão — onde ir se o botão não for o caminho. */
    sobOBotao?: string
    /** Fecho acima do rodapé. Sem isto, sai a frase padrão de contato. */
    rodape?: string
    /** Por que esta pessoa está recebendo. Muda por tipo de aviso. */
    porque?: string
}

/** Escapa o que vai para o HTML. */
function esc(texto: string): string {
    return texto
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
}

/**
 * A miniatura do app, em tabelas.
 *
 * Sem SVG e sem imagem: retângulos coloridos que insinuam a interface. O
 * objetivo não é mostrar a tela — é dar ao e-mail a cara do produto, que era o
 * pedido, sem assumir a dívida de um print que envelhece.
 */
function ilustracaoDe(tipo: 'conversa' | 'cobranca'): string {
    const bloco = (largura: string, altura: string, cor: string, raio = '4px') =>
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 7px;"><tr><td style="width:${largura};height:${altura};background-color:${cor};border-radius:${raio};font-size:0;line-height:0;">&nbsp;</td></tr></table>`

    const miolo =
        tipo === 'conversa'
            ? `<td style="padding:16px 18px;">
                 ${bloco('120px', '9px', LINHA)}
                 ${bloco('176px', '26px', '#ffffff', '9px')}
                 ${bloco('210px', '30px', GELO, '9px')}
                 ${bloco('140px', '26px', TEAL, '9px')}
               </td>`
            : `<td style="padding:16px 18px;">
                 ${bloco('96px', '9px', LINHA)}
                 ${bloco('210px', '12px', NAVY, '6px')}
                 ${bloco('150px', '9px', LINHA)}
                 ${bloco('120px', '26px', TEAL, '9px')}
               </td>`

    return `
<tr><td align="center" style="background-color:${GELO};padding:26px 36px 8px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:300px;background-color:#ffffff;border:1px solid ${MENTA};border-radius:10px;">
<tr>
<td style="width:62px;background-color:${FUNDO};border-right:1px solid ${LINHA};padding:16px 10px;vertical-align:top;">
${bloco('40px', '7px', NAVY, '3px')}
${bloco('34px', '6px', TEAL, '3px')}
${bloco('38px', '6px', LINHA, '3px')}
${bloco('30px', '6px', LINHA, '3px')}
</td>
${miolo}
</tr>
</table>
</td></tr>`
}

function passosDe(passos: PassoDoEmail[]): string {
    return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 0;">
${passos
    .map(
        (p, i) => `<tr>
<td style="width:28px;vertical-align:top;padding:0 12px 16px 0;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td align="center" style="width:24px;height:24px;background-color:${GELO};border-radius:12px;font-family:${FONTE};font-size:12px;font-weight:700;color:#0a5566;">${i + 1}</td>
</tr></table>
</td>
<td style="padding:0 0 16px;font-family:${FONTE};">
<p style="margin:0;font-size:14px;font-weight:700;color:${NAVY};">${p.titulo}</p>
<p style="margin:3px 0 0;font-size:13px;line-height:1.55;color:${TINTA};">${p.corpo}</p>
</td>
</tr>`
    )
    .join('\n')}
</table>`
}

export function renderEmail(copy: CascaDeEmail): string {
    const accent = copy.tone === 'urgent' ? AMBAR : MENTA

    /**
     * O envio sai de `noreply@mail.venn360.com`, e `mail.venn360.com` não tem
     * MX — é subdomínio de envio, e resposta a ele volta. Por isso o rodapé
     * manda para a caixa de verdade, e `send.ts` põe o mesmo endereço no
     * `Reply-To`: quem apertar "responder" por reflexo chega no mesmo lugar
     * que quem clicar aqui.
     */
    const porque =
        copy.porque ??
        `Você recebe este e-mail porque é responsável pela conta no ${BRAND().name}.`

    return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(copy.headline)}</title></head>
<body style="margin:0;padding:0;background-color:${FUNDO};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${FUNDO};"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">

<tr><td align="center" style="padding-bottom:26px;">
<img src="${appUrl()}${BRAND().logo.wordmarkLight}" width="150" height="50" alt="${esc(BRAND().name)}" style="display:block;border:0;width:150px;height:auto;">
</td></tr>

<tr><td style="background-color:#ffffff;border:1px solid ${LINHA};border-radius:12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${copy.ilustracao ? ilustracaoDe(copy.ilustracao) : ''}
<tr><td style="padding:${copy.ilustracao ? '30px' : '40px'} 36px 34px;">

<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="width:44px;height:3px;background-color:${accent};border-radius:2px;font-size:0;line-height:0;">&nbsp;</td></tr></table>

<h1 style="margin:20px 0 0;font-family:${FONTE};font-size:25px;line-height:1.25;font-weight:700;color:${NAVY};letter-spacing:-0.3px;">${esc(copy.headline)}</h1>

${copy.body
    .map(
        (p) =>
            `<p style="margin:14px 0 0;font-family:${FONTE};font-size:15px;line-height:1.65;color:${TINTA};">${p}</p>`
    )
    .join('\n')}

${copy.passos?.length ? passosDe(copy.passos) : ''}

<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px auto 0;"><tr>
<td align="center" bgcolor="${TEAL}" style="border-radius:10px;">
<a href="${esc(copy.cta.url)}" target="_blank" style="display:inline-block;padding:14px 32px;font-family:${FONTE};font-size:15px;font-weight:700;color:${NAVY};text-decoration:none;border-radius:10px;">${esc(copy.cta.texto)}</a>
</td></tr></table>

${
    copy.sobOBotao
        ? `<p style="margin:14px 0 0;text-align:center;font-family:${FONTE};font-size:13px;line-height:1.6;color:${TINTA};">${copy.sobOBotao}</p>`
        : ''
}

${
    copy.rodape
        ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 0;"><tr><td style="height:1px;background-color:${LINHA};font-size:0;line-height:0;">&nbsp;</td></tr></table>
<p style="margin:20px 0 0;font-family:${FONTE};font-size:13px;line-height:1.6;color:${TINTA};">${copy.rodape}</p>`
        : ''
}

</td></tr></table>
</td></tr>

<tr><td align="center" style="padding:22px 8px 0;">
<p style="margin:0;font-family:${FONTE};font-size:12.5px;line-height:1.6;color:${TINTA};">
<a href="${CAMINHOS.ajuda}" style="color:#0a5566;text-decoration:none;">Central de ajuda</a>
<span style="color:#c0d4de;">&nbsp;&middot;&nbsp;</span>
<a href="${CAMINHOS.assinatura}" style="color:#0a5566;text-decoration:none;">Minha assinatura</a>
<span style="color:#c0d4de;">&nbsp;&middot;&nbsp;</span>
<a href="${CAMINHOS.contato}" style="color:#0a5566;text-decoration:none;">Falar com a gente</a>
</p>
<p style="margin:12px 0 0;font-family:${FONTE};font-size:11.5px;line-height:1.65;color:#8099a8;">
${porque}<br>
Respondendo a esta mensagem, você fala com <a href="${CAMINHOS.contato}" style="color:${TINTA};">${CONTATO}</a>.
</p>
<p style="margin:10px 0 0;font-family:${FONTE};font-size:11.5px;line-height:1.6;color:#8099a8;">
${esc(BRAND().emailFooter)}<br>uma solução ${esc(BRAND().vendor)}
</p>
</td></tr>

</table></td></tr></table></body></html>`
}
