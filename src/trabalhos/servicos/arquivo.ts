import { CLASSES, ClasseBloqueadaError, enderecoPara, gravar, type Classe, type Referencia } from '@/lib/storage'
import { createLogger } from '@/trabalhos/registro'

/**
 * Arquiva bytes que chegaram ou saíram numa conversa.
 *
 * Substitui as três chamadas a `supabase.storage.upload(...).getPublicUrl()`
 * que existiam em `media.ts`, `speech.ts` e `avatar.ts`.
 *
 * **O que muda, e não é o endereço do bucket.** O Supabase Storage devolvia uma
 * URL pública permanente, e as três gravavam essa URL no banco. Conteúdo de
 * conversa de paciente — foto que ele mandou, nota de voz, foto de perfil —
 * é **clínico**, e no desenho novo material clínico sai por URL assinada de
 * validade curta que nunca é persistida (ver `lib/storage/index.ts`). Guardar
 * uma dessas no banco faria a imagem do paciente dar 404 dez minutos depois de
 * chegar: pior do que não arquivar.
 *
 * Então enquanto o provedor brasileiro não estiver aprovado, `provedorDa`
 * recusa a classe clínica e esta função devolve `null`. As três chamadoras já
 * tratam `null` — era o caminho de "o Storage recusou" —, então a mensagem
 * continua chegando, sendo gravada e sendo respondida; só o anexo não é
 * arquivado.
 *
 * **O que falta para fechar**, e é um item só: aprovar o provedor
 * (`00-storage-brasil-options.md`) e trocar a coluna de URL por **referência**
 * (`provedor`/`bucket`/`chave`), com o endereço assinado na leitura. Enquanto
 * for coluna de URL, nenhum conteúdo clínico pode ser arquivado sem criar um
 * link que vence.
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
export function deBase64(base64: string): Uint8Array<ArrayBuffer> {
    const bin = atob(base64)
    const u8 = new Uint8Array(new ArrayBuffer(bin.length))
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
    return u8
}

export { CLASSES }
