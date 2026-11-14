/**
 * Extração de texto de página e a guarda de endereço, isoladas do handler.
 *
 * Moram fora da rota por um motivo prático: a rota importa a autorização, que é
 * `server-only` e não carrega fora de um contexto de servidor. Com os helpers
 * aqui, o comportamento deles pode ser exercitado direto, que é o que importa
 * numa extração baseada em expressão regular e numa lista de faixas de IP.
 */

/**
 * Converte HTML em texto corrido.
 *
 * Sem dependência nova: o que o agente precisa é da prosa da página, e um
 * parser completo de DOM resolveria um problema que não temos. Script, estilo e
 * marcação saem; o texto sobra.
 */
export function htmlToText(html: string): string {
    return html
        // Blocos cujo conteúdo não é texto de leitura.
        .replace(/<(script|style|noscript|template|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        // Quebras onde a marcação implica parágrafo, para o texto não virar
        // uma linha só — o chunker divide melhor com a estrutura preservada.
        .replace(/<\/(p|div|section|article|li|tr|h[1-6]|br)\s*>/gi, '\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        // Entidades que aparecem em texto de página brasileira.
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/&[a-z]+;/gi, ' ')
        .replace(/[ \t ]+/g, ' ')
        .replace(/\n\s*\n\s*\n+/g, '\n\n')
        .replace(/^[ \t]+|[ \t]+$/gm, '')
        .trim()
}

export function pageTitle(html: string, fallback: string): string {
    const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
    const title = match ? htmlToText(match[1]).slice(0, 200) : ''
    return title || fallback
}

/**
 * Hospedeiro que não deve ser buscado pelo servidor: localhost, faixas privadas,
 * link-local (onde vive o metadata das nuvens) e nomes sem ponto.
 *
 * Checagem pelo texto do hostname, não por resolução de DNS — um nome público
 * que resolve para IP interno escapa daqui. É a guarda proporcional ao risco:
 * o retorno é texto para uma base de conhecimento, não uma credencial, e a rota
 * exige sessão de membro do workspace.
 */
export function isPrivateHost(hostname: string): boolean {
    const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')

    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true
    if (host === '::1' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return true
    if (!host.includes('.')) return true

    const octets = host.split('.')
    if (octets.length === 4 && octets.every((part) => /^\d{1,3}$/.test(part))) {
        const [a, b] = octets.map(Number)
        if (a === 10 || a === 127 || a === 0) return true
        if (a === 192 && b === 168) return true
        if (a === 172 && b >= 16 && b <= 31) return true
        if (a === 169 && b === 254) return true
        if (a === 100 && b >= 64 && b <= 127) return true
    }

    return false
}
