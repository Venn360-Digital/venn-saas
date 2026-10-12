/**
 * As máscaras dos campos de cadastro — aparecem ao digitar, gravam limpo.
 *
 * O molde usa `0` para dígito; tudo o mais é pontuação que entra sozinha. O
 * valor guardado é sempre só o que importa (dígitos, centavos); a formatação
 * é da tela. Validação forte (dígito verificador, data que existe) roda ao
 * sair do campo, não a cada tecla — avisar "CPF inválido" no terceiro dígito
 * é ruído.
 */
export const MASKS = {
    phone: '(00) 00000-0000',
    phone8: '(00) 0000-0000',
    date: '00/00/0000',
    cpf: '000.000.000-00',
    cnpj: '00.000.000/0000-00',
    cep: '00000-000',
} as const

export type MaskName = keyof typeof MASKS

export function onlyDigits(value: string | null | undefined): string {
    return (value ?? '').replace(/\D/g, '')
}

/** Quantos dígitos o molde comporta. */
export function maskCapacity(mask: string): number {
    return mask.split('').filter((c) => c === '0').length
}

/**
 * Aplica o molde aos dígitos: `applyMask('3199612', '(00) 00000-0000')` →
 * `(31) 99612`. Para na última posição preenchida — o resto do molde é
 * desenhado pelo campo, em cinza.
 */
export function applyMask(digits: string, mask: string): string {
    const d = onlyDigits(digits)
    let out = ''
    let i = 0
    for (const c of mask) {
        if (i >= d.length) break
        if (c === '0') {
            out += d[i]
            i++
        } else {
            out += c
        }
    }
    return out
}

/** O que falta do molde depois do que já foi digitado. */
export function maskRest(digits: string, mask: string): string {
    return mask.slice(applyMask(digits, mask).length)
}

/** Telefone nacional com a pontuação da tela: 10 dígitos usam o molde de 8. */
export function prettyPhone(digits: string | null | undefined): string {
    const d = onlyDigits(digits).replace(/^55(?=\d{10,11}$)/, '')
    if (!d) return ''
    return applyMask(d, d.length <= 10 ? MASKS.phone8 : MASKS.phone)
}

/** Centavos → "R$ 5.000,00". O campo guarda centavos para não somar erro de ponto flutuante. */
export function formatCents(cents: number | null | undefined): string {
    if (cents == null) return ''
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

/** O que a pessoa digitou (só os números contam) → centavos. */
export function parseCents(typed: string): number | null {
    const d = onlyDigits(typed)
    if (!d) return null
    return parseInt(d, 10)
}

/** "12/05/1988" → "1988-05-12", ou null quando a data não existe. */
export function dateFromMask(typed: string): string | null {
    const d = onlyDigits(typed)
    if (d.length !== 8) return null
    const day = parseInt(d.slice(0, 2), 10)
    const month = parseInt(d.slice(2, 4), 10)
    const year = parseInt(d.slice(4), 10)
    const dt = new Date(Date.UTC(year, month - 1, day))
    if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return null
    return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`
}

/** "1988-05-12" → "12051988" (os dígitos que o molde de data espera). */
export function maskDigitsFromIso(iso: string | null | undefined): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '')
    return m ? `${m[3]}${m[2]}${m[1]}` : ''
}

function checkDigits(digits: string, weights: number[][]): boolean {
    const base = digits.slice(0, digits.length - weights.length)
    let acc = base
    for (const w of weights) {
        const sum = acc.split('').reduce((s, c, i) => s + parseInt(c, 10) * w[i], 0)
        const dv = ((sum * 10) % 11) % 10
        acc += String(dv)
    }
    return acc === digits
}

export function cpfIsValid(digits: string): boolean {
    const d = onlyDigits(digits)
    if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false
    return checkDigits(d, [[10, 9, 8, 7, 6, 5, 4, 3, 2], [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]])
}

export function cnpjIsValid(digits: string): boolean {
    const d = onlyDigits(digits)
    if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false
    const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    const w2 = [6, ...w1]
    const calc = (base: string, w: number[]) => {
        const sum = base.split('').reduce((s, c, i) => s + parseInt(c, 10) * w[i], 0)
        const r = sum % 11
        return r < 2 ? 0 : 11 - r
    }
    const dv1 = calc(d.slice(0, 12), w1)
    const dv2 = calc(d.slice(0, 12) + dv1, w2)
    return d === d.slice(0, 12) + String(dv1) + String(dv2)
}
