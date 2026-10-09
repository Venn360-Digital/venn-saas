/**
 * Telefone: uma forma no banco, outra na tela.
 *
 * Mora separado de `lib/intake` porque isto é usado no navegador — a tabela de
 * pacientes, o campo de digitação — e `intake` importa Prisma e o provedor de
 * WhatsApp. Um `import` descuidado levaria o cliente Prisma para o bundle do
 * cliente.
 */
import { normalizeNumber } from '@/lib/whatsapp/types'

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

/**
 * Como a recepção lê de volta: o número nacional, só dígitos.
 *
 * Sem parênteses nem hífen, pelo mesmo motivo que o campo de digitação não tem:
 * a pontuação não existe no banco, não sobrevive a copiar e colar, e dá a
 * impressão de fazer parte do dado. O país sai porque é sempre o mesmo e só
 * ocupa espaço na leitura.
 */
export function formatPhone(digits: string | null | undefined): string {
    if (!digits) return ''
    return digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits
}
