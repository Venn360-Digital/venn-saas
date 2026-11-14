/**
 * Telefone: uma forma no banco, outra na tela.
 *
 * Mora separado de `lib/intake` porque isto é usado no navegador — a tabela de
 * pacientes, o campo de digitação — e `intake` importa Prisma e o provedor de
 * WhatsApp. Um `import` descuidado levaria o cliente Prisma para o bundle do
 * cliente.
 */
import { normalizeNumber } from './whatsapp/types'

/**
 * O telefone, do jeito que o Brasil digita e o WhatsApp endereça.
 *
 * O WhatsApp endereça por E.164 sem o `+`: `5511999999999`. Quem digita na
 * recepção escreve `11999999999`. As duas formas têm de convergir, porque é por
 * este número que o paciente é encontrado — `Contact` é único por
 * `(workspaceId, phone)`, e um cadastro gravado com máscara ficaria invisível
 * para a mensagem que chega depois.
 *
 * Só o 55 é assumido, e só quando o comprimento é de número nacional. Um número
 * estrangeiro digitado com o código do país passa intacto.
 */
export function normalizePhone(input: string): { digits: string; valid: boolean } {
    const digits = normalizeNumber(input)

    // 10 ou 11 dígitos: nacional sem o país (DDD + 8 ou 9 dígitos).
    if (digits.length === 10 || digits.length === 11) {
        return { digits: `55${digits}`, valid: true }
    }
    // 12 ou 13 com 55 na frente: já está completo.
    if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) {
        return { digits, valid: true }
    }
    // Estrangeiro: aceita, sem palpite.
    if (digits.length >= 11 && digits.length <= 15) {
        return { digits, valid: true }
    }
    return { digits, valid: false }
}

/** O que o campo aceita e a tela mostra: DDD + 8 ou 9 dígitos, sem o país. */
const MAX_NATIONAL = 11

/**
 * O número nacional, só dígitos — a forma que o campo e a tela usam.
 *
 * O banco guarda com o país (`5531988501161`), então todo formulário que abre
 * para edição precisa tirar o `55` antes de mostrar: sem isso o campo exibia 13
 * dígitos e um `55` que ele mesmo recusa ao ser digitado — o cadastro parecia
 * estar com o telefone errado.
 */
export function nationalDigits(input: string | null | undefined): string {
    const digits = (input ?? '').replace(/\D/g, '')
    if (digits.length > MAX_NATIONAL && digits.startsWith('55')) return digits.slice(2)
    return digits
}

/**
 * Por que este telefone não serve — `null` quando serve.
 *
 * Vazio serve: o telefone é opcional em quase todo cadastro (o paciente que
 * chegou pelo e-mail não tem). O que não pode é **gravar errado**: é por este
 * número que o paciente é encontrado quando a mensagem chega, e um número
 * incompleto cria um cadastro que nunca será reencontrado — nem pela busca, nem
 * pelo webhook do WhatsApp.
 *
 * As três regras são do plano de numeração brasileiro, não invenção da tela:
 * DDD de 11 a 99; 10 dígitos é fixo; 11 dígitos é móvel e começa com 9.
 */
export function phoneIssue(input: string | null | undefined): string | null {
    const digits = nationalDigits(input)
    if (!digits) return null
    if (digits.length < 10) return 'Telefone incompleto: DDD + 8 ou 9 dígitos.'
    if (digits.length > MAX_NATIONAL) return 'Telefone com dígitos demais.'
    if (Number(digits.slice(0, 2)) < 11) return 'DDD inválido — os dois primeiros dígitos.'
    if (digits.length === MAX_NATIONAL && digits[2] !== '9') {
        return 'Celular com 11 dígitos começa com 9 depois do DDD.'
    }
    return null
}

/**
 * Como a recepção lê de volta: o número nacional, só dígitos.
 *
 * Sem parênteses nem hífen, pelo mesmo motivo que o campo de digitação não tem:
 * a pontuação não existe no banco, não sobrevive a copiar e colar, e dá a
 * impressão de fazer parte do dado. O país sai porque é sempre o mesmo e só
 * ocupa espaço na leitura.
 */
export function formatPhone(digits: string | null | undefined): string {
    return nationalDigits(digits)
}
