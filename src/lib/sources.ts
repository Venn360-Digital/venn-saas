/**
 * A origem do paciente, como ela se escreve na tela.
 *
 * No banco é uma string curta e minúscula — `manual`, `whatsapp`, `ligacao` —
 * porque é isso que as rotas gravam. A tela mostrava o valor cru: "ligacao",
 * sem cedilha e sem acento, numa coluna chamada Origem. Num filtro ao lado, a
 * mesma origem aparecia escrita certo, porque o seletor tinha a sua própria
 * lista de rótulos. Esta é a lista única.
 *
 * Valor que não estiver aqui volta capitalizado em vez de sumir: a lista das
 * rotas cresce sem passar por este arquivo, e uma origem nova deve aparecer
 * legível na primeira vez, não depois de alguém lembrar de cadastrá-la.
 */
const LABELS: Record<string, string> = {
    manual: 'Manual',
    whatsapp: 'WhatsApp',
    instagram: 'Instagram',
    import: 'Importação',
    ligacao: 'Ligação',
    indicacao: 'Indicação',
    google: 'Google',
    site: 'Site',
    facebook: 'Facebook',
}

export function sourceLabel(source: string | null | undefined): string {
    if (!source) return 'Sem origem'
    const known = LABELS[source.toLowerCase()]
    if (known) return known
    return source.charAt(0).toUpperCase() + source.slice(1)
}

/** As origens que o filtro oferece, com "todas" na frente. */
export const SOURCE_FILTER_OPTIONS = [
    { value: '', label: 'Todas as origens' },
    ...['manual', 'whatsapp', 'ligacao', 'instagram', 'import'].map((value) => ({
        value,
        label: LABELS[value],
    })),
]
