/**
 * Como a ficha do paciente nasceu, do jeito que isso se escreve na tela.
 *
 * Era `sourceLabel`, e rotulava uma coluna que guardava três planos ao mesmo
 * tempo: o canal (`whatsapp`, `instagram`, `site`), o nascimento da ficha
 * (`manual`, `import`, `ligacao`) e a origem comercial (`google`, `facebook`,
 * `indicacao`). A tela chamava os três de "Origem" — e aí "WhatsApp" aparecia
 * como resposta para "de onde vêm nossos pacientes?", que é por onde eles
 * escrevem e não diz nada sobre o que os trouxe.
 *
 * Aqui ficou só o nascimento, que é lista fechada e curta. A origem comercial
 * virou tabela que a clínica alimenta (`origins`), então o rótulo dela vem do
 * banco e não deste arquivo. O canal se deriva da conversa.
 */
const LABELS: Record<string, string> = {
    manual: 'Cadastro manual',
    import: 'Importação',
    ligacao: 'Ligação',
    inbound: 'Escreveu primeiro',
    /** Preencheu um formulário de captura no site (Marketing → Formulários). */
    formulario: 'Formulário do site',
}

/**
 * Valor que não estiver na lista volta capitalizado em vez de sumir: as rotas
 * crescem sem passar por aqui, e um nascimento novo deve aparecer legível na
 * primeira vez, não depois de alguém lembrar de cadastrá-lo.
 */
export function createdViaLabel(createdVia: string | null | undefined): string {
    if (!createdVia) return 'Sem registro'
    const known = LABELS[createdVia.toLowerCase()]
    if (known) return known
    return createdVia.charAt(0).toUpperCase() + createdVia.slice(1)
}

/** Como a ficha nasceu, para o filtro — com "todas" na frente. */
export const CREATED_VIA_FILTER_OPTIONS = [
    { value: '', label: 'Qualquer cadastro' },
    ...['inbound', 'formulario', 'manual', 'ligacao', 'import'].map((value) => ({
        value,
        label: LABELS[value],
    })),
]
