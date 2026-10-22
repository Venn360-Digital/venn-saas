/**
 * O roteamento do Worker de produção `odontobox-evolution`, em funções puras.
 *
 * Mesmo motivo do `decisoes.ts`: o workerd não roda nesta máquina, então o que
 * pode errar — em qual contêiner uma chamada cai, se um webhook é legítimo, se
 * um evento dispara o reciclo — fica isolado aqui, sem efeito, testável. A
 * casca (`index.ts`) só obedece.
 *
 * O erro que este módulo existe para impedir é o pior do multi-tenant: uma
 * chamada da clínica A cair no contêiner da clínica B. A **sala** é a fronteira,
 * e é o `id` da integração (linha de WhatsApp) — estável, uma sala por número
 * pareado.
 */

/** Comparação de tempo constante, para segredo não vazar por cronometragem. */
export function iguais(a: string, b: string): boolean {
    if (a.length !== b.length) return false
    let diferenca = 0
    for (let i = 0; i < a.length; i++) diferenca |= a.charCodeAt(i) ^ b.charCodeAt(i)
    return diferenca === 0
}

/** As duas naturezas de requisição que este Worker atende. */
export type Rota = 'webhook' | 'api'

/**
 * Classifica pelo caminho.
 *
 * `/entrada/` é o webhook do Evolution Go — autorização no próprio caminho,
 * porque ele não assina o que emite. Todo o resto é a API do Evolution Go
 * (inclusive `/license/*`), que chega pelo service binding do app, guardada por
 * gateway+sala.
 *
 * O `/manager` e o SPA de ativação saíram: a licença é ativada pelo servidor
 * (`GET /license/activate?code=…`), e publicar a API administrativa inteira
 * atrás de um proxy de cookie era o que o próprio código marcava como "não pode
 * ir para produção".
 */
export function classificarRota(pathname: string): Rota {
    return pathname.startsWith('/entrada/') ? 'webhook' : 'api'
}

/**
 * Lê `/entrada/{segredo}/{sala}` — e nada além disso conta como webhook válido.
 *
 * Nulo quando faltar segredo ou sala: um `/entrada/` sem as duas partes não é
 * webhook, é alguém sondando a URL.
 */
export function partesDaEntrada(pathname: string): { segredo: string; sala: string } | null {
    const partes = pathname.split('/').filter(Boolean)
    // ['entrada', segredo, sala]
    if (partes.length < 3 || partes[0] !== 'entrada') return null
    const [, segredo, sala] = partes
    if (!segredo || !sala) return null
    return { segredo, sala }
}

/**
 * A sala é o `id` da integração, e tem de ser um id — não um caminho.
 *
 * O id do Prisma é `cuid`: letras e dígitos, sem separador. Recusar qualquer
 * outra coisa fecha a porta para `..`, barra e afins chegarem a
 * `idFromName`/`getContainer` como nome de sala.
 */
export function salaValida(sala: string): boolean {
    return /^[a-z0-9]{20,40}$/i.test(sala)
}

/**
 * Deriva a sala do nome da instância: `odontobox_{idDaIntegração}_{carimbo}`.
 *
 * É a mesma convenção de `whatsapp/route.ts` (`instanceNameFor`). O id fica no
 * meio porque o nome ganha um carimbo de tempo a cada reconexão, mas o id da
 * integração — a linha — é estável, e é ele a sala. Nulo quando o nome não
 * segue a convenção, para o chamador falhar alto em vez de rotear para "".
 */
export function salaDoNomeDeInstancia(instanceName: string): string | null {
    const partes = instanceName.split('_')
    // ['odontobox', id, carimbo?] — o id é sempre a segunda parte.
    if (partes.length < 2 || partes[0] !== 'odontobox') return null
    const id = partes[1]
    return id && salaValida(id) ? id : null
}

/**
 * Quais eventos do Evolution Go disparam o reciclo pós-pareamento.
 *
 * Só `PairSuccess`. É o instante em que a goroutine do QR passa a ameaçar a
 * sessão recém-criada (ver `decisoes.ts`), e o reciclo a +25 s é o que a
 * preserva. Os demais eventos são repassados ao app e não tocam o ciclo de
 * vida do contêiner.
 */
export function eventoDisparaReciclo(evento: string): boolean {
    return evento === 'PairSuccess'
}

/** Os cabeçalhos do gateway, nomeados num lugar só (o app manda os mesmos). */
export const CABECALHO = {
    /** Prova de que a chamada é do nosso app: o valor é a chave global. */
    GATEWAY: 'x-evo-gateway',
    /** A sala (id da integração) para a qual rotear. */
    SALA: 'x-evo-sala',
} as const
