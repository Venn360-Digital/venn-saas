import { CHAVE_ENV } from '../secrets/envelope'

/**
 * O link de descadastro, e como ele é verificado sem sessão.
 *
 * ## O problema
 *
 * Quem clica em "não quero mais receber" **não está logado** — é um paciente,
 * nunca entrou no sistema, e nem deveria precisar. Então a rota tem de saber de
 * quem é o pedido olhando só a URL.
 *
 * Três formas erradas de fazer isso, e por que:
 *
 * 1. **`?contato=<id>`**, cru. Qualquer pessoa troca o id e descadastra outro
 *    contato. E id de `cuid()` não é segredo — ele viaja em URL de tela.
 * 2. **Um token aleatório gravado numa coluna.** Funciona, e custa uma escrita
 *    por destinatário no disparo, mais uma tabela que cresce para sempre. Dois
 *    mil contatos = dois mil linhas para guardar o que dá para calcular.
 * 3. **Cifrar o id.** Resolve o sigilo, que não é o problema: o id não precisa
 *    ser secreto, precisa ser **inforjável**.
 *
 * ## A forma usada
 *
 * `<workspaceId>.<contactId>.<assinatura>`, onde a assinatura é um HMAC-SHA256
 * dos dois primeiros com a chave do servidor. Nada é gravado, nada expira, e
 * trocar um caractere do id invalida a assinatura. O workspace entra no payload
 * **e** no que é assinado porque opt-out é por unidade: o mesmo paciente pode
 * ser contato de duas clínicas da mesma rede, e sair da newsletter de uma não é
 * sair da outra.
 *
 * ## Sem validade
 *
 * De propósito. Um link de descadastro que expira é um link que, meses depois,
 * manda a pessoa para uma tela de erro em vez de tirá-la da lista — e ela então
 * marca como spam, que é exatamente o que o link existe para evitar. O botão
 * nativo do Gmail usa o mesmo endereço (`List-Unsubscribe`), e e-mail antigo na
 * caixa de alguém é a regra, não a exceção.
 *
 * ## A chave
 *
 * Reusa `TOKEN_ENCRYPTION_KEY`, que já é segredo obrigatório nos três apps —
 * um segredo novo seria uma variável a mais para gravar em doze lugares e
 * esquecer num. Derivada por HMAC, ela não é a chave do envelope: o uso é
 * separado pelo algoritmo, não pelo valor.
 */

function bytesDaChave(): Uint8Array {
    const valor = process.env[CHAVE_ENV]
    if (!valor) throw new Error(`${CHAVE_ENV} não está definida; o link de descadastro não pode ser assinado`)
    return new TextEncoder().encode(valor)
}

async function assinar(carga: string): Promise<string> {
    const chave = await crypto.subtle.importKey(
        'raw',
        // `as BufferSource`: o TS do app e o do Worker divergem na assinatura de
        // `importKey`, e a cópia garante um ArrayBuffer próprio.
        bytesDaChave().slice() as unknown as BufferSource,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    )
    const mac = await crypto.subtle.sign('HMAC', chave, new TextEncoder().encode(carga))

    // base64url: o token viaja em caminho de URL, e `+` e `/` do base64 comum
    // seriam reescritos por cliente de e-mail que normaliza link.
    let s = ''
    for (const b of new Uint8Array(mac)) s += String.fromCharCode(b)
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** O token que vai no link. */
export async function tokenDeDescadastro(
    workspaceId: string,
    contactId: string
): Promise<string> {
    const carga = `${workspaceId}.${contactId}`
    return `${carga}.${await assinar(carga)}`
}

/**
 * Confere o token e devolve de quem é.
 *
 * `null` quando não confere — e quem chama responde a **mesma** tela de
 * sempre, sem dizer que o token é inválido. Dizer "token inválido" transforma a
 * rota num oráculo para descobrir ids válidos por tentativa.
 */
export async function lerTokenDeDescadastro(
    token: string
): Promise<{ workspaceId: string; contactId: string } | null> {
    const partes = token.split('.')
    if (partes.length !== 3) return null

    const [workspaceId, contactId, assinatura] = partes
    if (!workspaceId || !contactId || !assinatura) return null

    let esperada: string
    try {
        esperada = await assinar(`${workspaceId}.${contactId}`)
    } catch {
        // Chave ausente. Não dá para verificar, então não se confia.
        return null
    }

    if (!iguaisEmTempoConstante(assinatura, esperada)) return null
    return { workspaceId, contactId }
}

/**
 * Comparação sem vazar onde as strings diferem.
 *
 * `a === b` em JS sai no primeiro byte diferente. A diferença de tempo é
 * minúscula e, sobre muitas tentativas, é o suficiente para adivinhar a
 * assinatura byte a byte. Custa três linhas evitar.
 */
function iguaisEmTempoConstante(a: string, b: string): boolean {
    if (a.length !== b.length) return false
    let diferenca = 0
    for (let i = 0; i < a.length; i++) diferenca |= a.charCodeAt(i) ^ b.charCodeAt(i)
    return diferenca === 0
}

/** A URL completa, para o rodapé do e-mail e o cabeçalho `List-Unsubscribe`. */
export async function urlDeDescadastro(
    baseUrl: string,
    workspaceId: string,
    contactId: string
): Promise<string> {
    const token = await tokenDeDescadastro(workspaceId, contactId)
    return `${baseUrl.replace(/\/+$/, '')}/descadastro/${token}`
}
