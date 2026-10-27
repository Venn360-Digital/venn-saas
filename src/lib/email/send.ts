/**
 * E-mail transacional, pelo binding de Email Sending da Cloudflare.
 *
 * **O binding é registrado, não importado** — mesma costura que o driver de
 * fila usa, e pelo mesmo motivo: binding só existe dentro do Worker e chega por
 * `env`. Alcançá-lo daqui exigiria `import { env } from 'cloudflare:workers'`,
 * que não resolve no typecheck desta máquina (sem Miniflare local,
 * `.cloudflare/types` não é gerado). Ver `src/lib/queue/driver.ts`.
 *
 * A assinatura é a mesma de quando o envio era pela API do Resend: um argumento,
 * sem nada de plataforma. Os chamadores — o gancho de senha do Better Auth, os
 * avisos de cobrança, as rotas — não sabem por onde o e-mail sai.
 */

import { CONTATO } from './layout'

/**
 * O recorte do binding que este módulo usa.
 *
 * Declarado aqui em vez de importado de `@cloudflare/workers-types` para o
 * arquivo passar no typecheck do app (`lib: dom`) **e** no do Worker — a mesma
 * razão que está em `driver-cloudflare.ts`. O Worker passa o binding real; o
 * tipo confere a forma.
 *
 * `from` é objeto, nunca a string `"Nome <endereço>"`: o builder do binding não
 * parseia esse formato.
 */
interface RemetenteDaCloudflare {
    send(mensagem: {
        from: { email: string; name: string }
        replyTo: string
        to: { email: string }[]
        subject: string
        text: string
        html: string
    }): Promise<void>
}

export interface SendResult {
    ok: boolean
    error?: string
}

let remetente: RemetenteDaCloudflare | null = null
let enderecoDeEnvio = ''

/** Chamado por `registrarCosturas`, na entrada do Worker. */
export function registrarRemetenteDeEmail(
    binding: RemetenteDaCloudflare,
    from: string
): void {
    remetente = binding
    enderecoDeEnvio = from
}

export async function sendEmail(input: {
    to: string
    subject: string
    html: string
}): Promise<SendResult> {
    if (!remetente) {
        // Não é exceção: binding ausente não pode derrubar o cron que só estava
        // tentando avisar alguém. Fica no retorno, e quem chamou registra.
        return { ok: false, error: 'binding de e-mail não registrado' }
    }

    const [email, name] = separarRemetente(enderecoDeEnvio)

    try {
        // Sempre texto **e** HTML: e-mail só-HTML pesa contra a entrega de um
        // domínio de envio que ainda não tem reputação.
        await remetente.send({
            from: { email, name },
            // O remetente é `noreply@` num subdomínio sem MX. Sem este
            // `Reply-To`, apertar "responder" devolve a mensagem.
            replyTo: CONTATO,
            to: [{ email: input.to }],
            subject: input.subject,
            text: emTextoSimples(input.html),
            html: input.html,
        })

        return { ok: true }
    } catch (erro) {
        const mensagem = erro instanceof Error ? erro.message : 'falha de rede'
        // O erro do Email Sending carrega `code` (`E_SENDER_NOT_VERIFIED`,
        // `E_RATE_LIMIT_EXCEEDED`). É ele que diz se o problema é configuração
        // ou volume, então vai junto.
        const codigo =
            typeof erro === 'object' && erro !== null && 'code' in erro
                ? ` (${String((erro as { code: unknown }).code)})`
                : ''

        return { ok: false, error: `${mensagem}${codigo}` }
    }
}

/** De `"OdontoBox360 <conta@dominio>"` para `["conta@dominio", "OdontoBox360"]`. */
function separarRemetente(valor: string): [string, string] {
    const encontrado = valor.match(/^(.+?)\s*<(.+?)>$/)
    return encontrado ? [encontrado[2], encontrado[1]] : [valor, 'OdontoBox360']
}

function emTextoSimples(html: string): string {
    return html
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&')
        .split('\n')
        .map((linha) => linha.trim())
        .filter((linha) => linha.length > 0)
        .join('\n')
}
