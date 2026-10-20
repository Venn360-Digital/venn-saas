import { formatPhone } from '@/lib/phone'

/**
 * Como uma linha se chama na tela.
 *
 * Havia **quatro cópias** desta função — na lista de conversas, na aba de
 * canais do agente, na ficha do paciente e na ficha do negócio — e elas já
 * tinham divergido: três formatavam o número e a ficha do paciente mostrava os
 * treze dígitos crus, com o 55 na frente. Divergência assim não dá erro em
 * lugar nenhum; só faz a mesma linha ter dois nomes em duas telas.
 *
 * O apelido vem primeiro porque é o que a clínica escreveu para se orientar
 * ("Unidade Centro"), e o número é o que sempre existe. A pontuação não entra:
 * é decisão de `lib/phone.ts` — ela não existe no banco, não sobrevive a copiar
 * e colar e dá a impressão de fazer parte do dado.
 */
export function apelidoDaLinha(
    linha: { label?: string | null; phoneNumber?: string | null } | null | undefined,
    semNumero = ''
): string {
    const apelido = linha?.label?.trim()
    if (apelido) return apelido
    if (linha?.phoneNumber) return formatPhone(linha.phoneNumber)
    return semNumero
}

/** O nome do canal na tela, quando o que importa é o canal e não a linha. */
export const NOME_DO_CANAL: Record<string, string> = {
    whatsapp_qr: 'WhatsApp',
    whatsapp_business: 'WhatsApp API oficial',
    instagram: 'Instagram',
    site: 'Site',
    telegram: 'Telegram',
    mercadolivre: 'Mercado Livre',
}

/**
 * Canal e linha juntos: "WhatsApp · Unidade Centro".
 *
 * O apelido só aparece quando existe. Num canal de linha única — o site — ele
 * não existe, e o nome do canal já diz tudo; repetir ali um separador vazio
 * seria ruído.
 */
export function canalComApelido(
    canal: string,
    linha: { label?: string | null; phoneNumber?: string | null } | null | undefined
): string {
    const nome = NOME_DO_CANAL[canal] ?? canal
    const apelido = apelidoDaLinha(linha)
    return apelido ? `${nome} · ${apelido}` : nome
}
