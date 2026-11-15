import { BRAND } from '../../marca'

/**
 * O prefixo do nome de instância na Evolution.
 *
 * ## É nome de recurso CRIADO, não texto
 *
 * O nome (`<prefixo>_<id>`) é criado na Evolution quando alguém conecta um
 * número, e guardado no `config` daquela linha. Ele volta em cada webhook, e é
 * por ele que o Worker descobre a qual sala a mensagem pertence.
 *
 * Isso faz dele contrato com um sistema externo e com dados já gravados:
 * trocá-lo não renomeia nada na Evolution — só faz o reconhecimento falhar
 * para toda linha já conectada. As mensagens chegariam e seriam descartadas
 * como "sala desconhecida", sem erro visível.
 *
 * ## Por que derivar, então
 *
 * Porque o segundo produto precisa do seu próprio prefixo: duas instâncias com
 * o mesmo nome na mesma Evolution seriam a mesma instância. E porque hoje o
 * slug da marca é **byte a byte** o literal que estava escrito — a mudança é
 * de origem, não de valor, e `test:instancia` existe para que continue assim.
 *
 * Linha já conectada não é tocada: ela guarda o nome dela em `config` e segue
 * com ele. Esta função só nomeia linha nova.
 */
let prefixoCache: string | null = null
export function prefixoDaInstancia(): string {
    if (prefixoCache === null) prefixoCache = BRAND().slug
    return prefixoCache
}

/** `<prefixo>_<id>` — o nome de uma instância nova. */
export function nomeDaInstancia(...partes: string[]): string {
    return [prefixoDaInstancia(), ...partes].join('_')
}
