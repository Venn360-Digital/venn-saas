import 'server-only'

/**
 * A casca dos e-mails transacionais, num lugar só.
 *
 * Ela já existia duplicada: `billing.ts` carregava as 25 linhas de tabela e
 * estilo inline, com o comentário "same shell as the auth e-mails" — e os
 * e-mails de autenticação eram modelos do GoTrue, servidos pela rota `/email/`
 * que saiu com a plataforma anterior. A casca sobreviveu ao parente, e o e-mail de
 * redefinição de senha precisava dela de volta.
 *
 * **Por que tabela e estilo inline em 2026.** Cliente de e-mail não é
 * navegador: Outlook renderiza com o motor do Word, Gmail remove `<style>` em
 * alguns contextos, e flexbox não é confiável em nenhum dos dois. Tabela
 * aninhada com estilo em atributo é o que chega igual nos dois — é feio de ler e
 * é o que funciona.
 */

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://odontobox.venn360.com'

const FONTE =
    "'Open Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif"

export interface CascaDeEmail {
    headline: string
    /** Cada item vira um parágrafo. */
    body: string[]
    cta: { texto: string; url: string }
    /** `urgent` pinta a tarja de vermelho. */
    tone?: 'neutral' | 'urgent'
    /** Linha final acima do rodapé. */
    rodape?: string
}

/** Escapa o que vai para o HTML. */
function esc(texto: string): string {
    return texto
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
}

export function renderEmail(copy: CascaDeEmail): string {
    const accent = copy.tone === 'urgent' ? '#c62828' : '#a7f3d0'
    /**
     * O envio sai de `noreply@mail.venn360.com`, e `mail.venn360.com` não tem
     * MX — o subdomínio é só de envio, e quem responder recebe devolução. O
     * rodapé anterior convidava a responder, o que mandava o cliente falar com
     * uma caixa que não existe justamente quando ele tinha dúvida de cobrança.
     */
    const rodape = copy.rodape ?? 'Este é um aviso automático. Este endereço não recebe respostas.'

    return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(copy.headline)}</title></head>
<body style="margin:0;padding:0;background-color:#f8fbfd;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f8fbfd;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
<tr><td align="center" style="padding-bottom:28px;">
<img src="${APP_URL}/logos/logo-wordmark-light.png" width="150" height="50" alt="OdontoBox360" style="display:block;border:0;width:150px;height:auto;">
</td></tr>
<tr><td style="background-color:#ffffff;border:1px solid #dce7ec;border-radius:12px;padding:40px 36px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="width:44px;height:3px;background-color:${accent};border-radius:2px;font-size:0;line-height:0;">&nbsp;</td></tr></table>
<h1 style="margin:22px 0 0;font-family:${FONTE};font-size:26px;line-height:1.25;font-weight:700;color:#0b1f3b;letter-spacing:-0.3px;">${esc(copy.headline)}</h1>
${copy.body
    .map(
        (p) =>
            `<p style="margin:14px 0 0;font-family:${FONTE};font-size:15px;line-height:1.65;color:#53707f;">${p}</p>`
    )
    .join('\n')}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:30px 0 0;"><tr>
<td align="center" bgcolor="#06b6d4" style="border-radius:10px;">
<a href="${esc(copy.cta.url)}" target="_blank" style="display:inline-block;padding:14px 30px;font-family:${FONTE};font-size:15px;font-weight:600;color:#0b1f3b;text-decoration:none;border-radius:10px;">${esc(copy.cta.texto)}</a>
</td></tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 0;"><tr><td style="height:1px;background-color:#dce7ec;font-size:0;line-height:0;">&nbsp;</td></tr></table>
<p style="margin:20px 0 0;font-family:${FONTE};font-size:13px;line-height:1.6;color:#53707f;">${rodape}</p>
</td></tr>
<tr><td align="center" style="padding:24px 8px 0;">
<p style="margin:0;font-family:${FONTE};font-size:12px;line-height:1.6;color:#8099a8;">OdontoBox360 &middot; atendimento, agenda e CRM para clínicas odontológicas<br>uma solução Venn360</p>
</td></tr></table></td></tr></table></body></html>`
}
