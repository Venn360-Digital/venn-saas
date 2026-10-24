import { CLASSES, type Classe, type Referencia, enderecoPara, referenciaDe } from '@/lib/storage'

/**
 * O que fica gravado em `Message.mediaUrl`, e como vira endereço na saída.
 *
 * ## O defeito
 *
 * A coluna guardava a **URL assinada**. Mídia de paciente é `CLINICO`, logo vai
 * para o bucket privado, logo o endereço é assinado com validade de no máximo
 * 600 s (`VALIDADE_MAXIMA_SEGUNDOS`). Gravar isso significa que **arquivo com
 * mais de dez minutos está morto na tela** — o exame que o paciente mandou em
 * março abre um 403.
 *
 * Era defeito dos dois lados ao mesmo tempo:
 *
 * - **funcional**, porque o painel de arquivos da conversa existe justamente
 *   para achar o que foi enviado há meses, e nenhum deles abria;
 * - **de segurança**, porque enquanto vale a URL assinada é uma chave ao
 *   portador: quem a tiver — de um log, de um backup, de um `select` — baixa o
 *   arquivo clínico sem passar por autorização nenhuma. `lib/storage/index.ts`
 *   afirmava em comentário que o endereço sensível "nunca é persistida", e
 *   `trabalhos/servicos/media.ts` o persistia.
 *
 * ## O desenho
 *
 * O banco guarda **referência**, nunca endereço: `ref:<classe>:<chave>`. O
 * endereço é cunhado na **saída**, a cada leitura, por quem já autorizou — as
 * rotas de conversa conferem `assertConversationAccess` antes de serializar.
 * Assim o link nasce válido, vale dez minutos a partir de agora, e nunca existe
 * em repouso.
 *
 * ## Por que não uma rota própria de mídia
 *
 * Seria melhor ainda: `/api/midia/<id>` autorizaria e redirecionaria, e o link
 * seria permanente. Mas trocaria o que o cliente recebe em 58 pontos e pediria
 * migração das linhas antigas. Assinar na saída resolve os dois defeitos sem
 * tocar em nada do lado do navegador — `src={msg.mediaUrl}` continua igual.
 *
 * ## Linha antiga
 *
 * O que já está gravado começa com `http` e é devolvido como está. Essas URLs
 * já estão vencidas e seguem vencidas; o que muda é que param de nascer novas.
 * Converter o histórico exigiria extrair a chave de dentro da URL assinada — dá
 * para fazer, e é migração própria, não parte deste conserto.
 */

const PREFIXO = 'ref:'

/** Como a referência é gravada na coluna. */
export function comoReferencia(ref: Pick<Referencia, 'classe' | 'chave'>): string {
    return `${PREFIXO}${ref.classe}:${ref.chave}`
}

/** As classes aceitas na volta, por nome. Desconhecida não vira referência. */
const POR_NOME = new Map<string, Classe>(
    Object.values(CLASSES).map((c) => [String(c), c as Classe])
)

/**
 * O endereço utilizável de um valor gravado — assinado na hora, se for
 * referência.
 *
 * Devolve `null` para nulo. Devolve o próprio valor para linha antiga (`http`)
 * e para o que não souber interpretar: perder o link é pior que devolver um que
 * talvez funcione, e quem chama não tem como consertar o dado aqui.
 */
export async function enderecoDaMidia(valor: string | null | undefined): Promise<string | null> {
    if (!valor) return null
    if (!valor.startsWith(PREFIXO)) return valor

    const resto = valor.slice(PREFIXO.length)
    const corte = resto.indexOf(':')
    if (corte <= 0) return valor

    const classe = POR_NOME.get(resto.slice(0, corte))
    const chave = resto.slice(corte + 1)
    if (!classe || !chave) return valor

    try {
        return await enderecoPara(referenciaDe(classe, chave))
    } catch {
        // Bucket fora do ar ou credencial faltando: devolver a referência crua
        // faria a tela mostrar `ref:clinico:...` como se fosse link. `null` é
        // mais honesto — o componente já sabe lidar com mídia ausente.
        return null
    }
}

/**
 * O mesmo, para uma lista de mensagens — que é como as rotas serializam.
 *
 * Em paralelo porque assinar é cálculo local (HMAC), não ida à rede: uma
 * conversa com cinquenta arquivos não paga cinquenta viagens.
 */
export async function comEnderecoDeMidia<T extends { mediaUrl?: string | null }>(
    mensagens: T[]
): Promise<T[]> {
    return Promise.all(
        mensagens.map(async (m) => ({ ...m, mediaUrl: await enderecoDaMidia(m.mediaUrl) }))
    )
}
