import { CLASSES, ClasseBloqueadaError, enderecoPara, gravar, type Classe, type Referencia } from '../../lib/storage'
import { createLogger } from '../registro'

/**
 * Arquiva bytes que chegaram ou saíram numa conversa.
 *
 * Substitui as três chamadas ao upload do storage anterior
 * que existiam em `media.ts`, `speech.ts` e `avatar.ts`.
 *
 * **O que muda, e não é o endereço do bucket.** Aquele storage devolvia uma
 * URL pública permanente, e as três gravavam essa URL no banco. Conteúdo de
 * conversa de paciente — foto que ele mandou, nota de voz, foto de perfil —
 * é **clínico**, e no desenho novo material clínico sai por URL assinada de
 * validade curta que nunca é persistida (ver `lib/storage/index.ts`). Guardar
 * uma dessas no banco faria a imagem do paciente dar 404 dez minutos depois de
 * chegar: pior do que não arquivar.
 *
 * O provedor foi decidido em 2026-10-21: R2, bucket `odontobox-private`. A
 * classe clínica **já não é recusada** — ver `lib/storage/classificacao.ts`.
 *
 * **O que falta, e é o que impede ligar isto no caminho real:** a coluna
 * `Message.mediaUrl` guarda URL, e para clínico a URL é assinada com validade
 * de 10 minutos. Persistir uma dessas faz a imagem do paciente dar 404 dez
 * minutos depois de chegar — pior do que não arquivar.
 *
 * Então **quem persiste o retorno precisa mudar antes**, de uma das duas
 * formas: trocar a coluna por referência (`provedor`/`bucket`/`chave`, assinando
 * na leitura), ou persistir um endereço interno estável servido por rota que
 * assina sob demanda e confere a fronteira de inquilino. A segunda é menor e
 * dispensa migração; nenhuma das duas está feita.
 */
const log = createLogger('ARQUIVO')

export interface Arquivado {
    referencia: Referencia
    /**
     * Endereço para servir agora.
     *
     * **Não persistir** quando a classe é clínica: vence em minutos. Para
     * público é URL direta e estável.
     */
    url: string
}

export async function arquivar(entrada: {
    classe: Classe
    chave: string
    bytes: Uint8Array<ArrayBuffer>
    contentType: string
}): Promise<Arquivado | null> {
    try {
        const referencia = await gravar(entrada.classe, entrada.chave, entrada.bytes, {
            contentType: entrada.contentType,
        })
        return { referencia, url: await enderecoPara(referencia) }
    } catch (erro) {
        if (erro instanceof ClasseBloqueadaError) {
            // Em `warn` e não `error`: é pendência conhecida e registrada, não
            // defeito. Em `error` encheria o log e esconderia falha de verdade.
            log.warn(
                `classe "${entrada.classe}" sem destino aprovado; "${entrada.chave}" não foi arquivado`
            )
            return null
        }

        log.error(`falha ao arquivar "${entrada.chave}"`, erro instanceof Error ? erro.message : erro)
        return null
    }
}

/** Bytes de base64, no formato que o `gravar` aceita. */
/**
 * Normaliza um base64 antes de decodificar.
 *
 * `atob` é estrito: qualquer caractere fora do alfabeto padrão o faz lançar
 * `InvalidCharacterError`. Medido em 2026-10-23, com a imagem do paciente já
 * entrando pelo download (`/message/downloadmedia`) depois do corte dos 128 KB
 * da fila: o Evolution Go devolve o base64 num formato que o `atob` recusa — e
 * o arquivamento morria, `mediaUrl` ficava nulo e a foto não abria na conversa.
 *
 * Três formas que aparecem e que esta função absorve, e **nenhuma delas é
 * destrutiva para um base64 padrão já bem-formado** (o caminho do cofre, que
 * também usa `deBase64`, passa intacto):
 *
 *   - prefixo de data URL (`data:image/jpeg;base64,…`);
 *   - quebras de linha e espaços (base64 quebrado em 76 colunas);
 *   - alfabeto URL-safe (`-`/`_` no lugar de `+`/`/`), sem padding.
 */
function normalizarBase64(entrada: string): string {
    let b = entrada.trim()

    // Prefixo de data URL: fica só o que vem depois da vírgula.
    const virgula = b.indexOf(',')
    if (b.startsWith('data:') && virgula !== -1) b = b.slice(virgula + 1)

    // Espaços e quebras de linha não fazem parte do dado.
    b = b.replace(/\s+/g, '')

    // URL-safe → padrão.
    b = b.replace(/-/g, '+').replace(/_/g, '/')

    // Padding: `atob` exige múltiplo de 4.
    const resto = b.length % 4
    if (resto === 2) b += '=='
    else if (resto === 3) b += '='
    else if (resto === 1) {
        // Comprimento impossível para base64 — não inventa padding, deixa o
        // `atob` lançar com a mensagem dele.
    }

    return b
}

export function deBase64(base64: string): Uint8Array<ArrayBuffer> {
    const bin = atob(normalizarBase64(base64))
    const u8 = new Uint8Array(new ArrayBuffer(bin.length))
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
    return u8
}

export { CLASSES }
