/**
 * O que falta para a conta poder pagar — e por que isso virou um módulo.
 *
 * O Asaas exige o documento do pagador, e exige o endereço **inteiro** quando a
 * gente manda `customerData`: metade é o único envio que ele recusa (a tabela
 * está em `asaas/checkout.ts`). Então há duas perguntas diferentes, e elas
 * precisavam parar de ser respondidas em três lugares com critérios distintos:
 *
 * - **dá para cobrar?** → só o documento. Sem ele não há cliente no gateway.
 * - **dá para cobrar sem fazer o cliente digitar tudo de novo?** → o conjunto
 *   completo. Faltando qualquer peça, a página do Asaas pergunta — e o cliente
 *   preenche na tela deles o que já tinha preenchido na nossa.
 *
 * A segunda é a que o Andre apontou em 2026-11-07: "sair da tela de assinatura,
 * voltar pra preencher um CNPJ ou endereço e depois voltar não é nada
 * amigável". O conserto é pedir o conjunto **ali**, antes de abrir o pagamento,
 * e para isso a tela precisa saber exatamente o que falta — daí esta função
 * devolver a lista de campos, e não um booleano.
 *
 * Pura e sem Prisma de propósito: o worker não usa, a rota passa o que leu, e
 * assim a regra é conferível sem banco.
 */

/** Os campos que o cartão exige, na ordem em que o formulário os pede. */
export const CAMPOS_DE_COBRANCA = [
    'cpfCnpj',
    'postalCode',
    'address',
    'addressNumber',
    'province',
    'city',
    'state',
    'billingPhone',
] as const

export type CampoDeCobranca = (typeof CAMPOS_DE_COBRANCA)[number]

/** Como cada campo se chama na tela — a recusa cita o nome que a pessoa vê. */
export const NOME_DO_CAMPO: Record<CampoDeCobranca, string> = {
    cpfCnpj: 'CPF ou CNPJ',
    postalCode: 'CEP',
    address: 'logradouro',
    addressNumber: 'número',
    province: 'bairro',
    city: 'cidade',
    state: 'UF',
    billingPhone: 'telefone',
}

/**
 * O complemento **não** entra na lista.
 *
 * Nem o Asaas o exige, nem metade dos endereços o tem. Exigi-lo faria quem mora
 * numa casa inventar "casa" para poder pagar.
 */
export type DadosDeCobranca = Partial<Record<CampoDeCobranca, string | null>> & {
    complement?: string | null
}

export interface EstadoDaCobranca {
    /** O conjunto inteiro está preenchido: o checkout vai sem perguntar nada. */
    completo: boolean
    /** Há documento: dá para cobrar, mesmo que o endereço seja pedido lá. */
    podeCobrar: boolean
    /** Quais campos faltam, na ordem do formulário. */
    faltando: CampoDeCobranca[]
}

function vazio(valor: string | null | undefined): boolean {
    return (valor ?? '').trim().length === 0
}

export function conferirCobranca(dados: DadosDeCobranca): EstadoDaCobranca {
    const faltando = CAMPOS_DE_COBRANCA.filter((campo) => vazio(dados[campo]))

    return {
        completo: faltando.length === 0,
        podeCobrar: !vazio(dados.cpfCnpj),
        faltando,
    }
}

/** "o CEP, o número e o telefone" — para a frase que explica o que falta. */
export function listarFaltantes(faltando: readonly CampoDeCobranca[]): string {
    const nomes = faltando.map((campo) => NOME_DO_CAMPO[campo])
    if (nomes.length === 0) return ''
    if (nomes.length === 1) return nomes[0]
    return `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`
}

/**
 * Os dados completos, ou nada — para quem precisa deles **tipados**.
 *
 * `conferirCobranca` responde "falta algo?" e serve à tela. Quem vai montar o
 * `customerData` do Asaas precisa de outra coisa: os oito campos como `string`,
 * sem `null`. Sem esta função, o chamador conferia com uma e afirmava com um
 * `!` — e um `!` é exatamente a promessa que ninguém verifica quando a lista de
 * campos muda.
 */
export function cobrancaCompleta(
    dados: DadosDeCobranca
): Record<CampoDeCobranca, string> | null {
    const { completo } = conferirCobranca(dados)
    if (!completo) return null

    return Object.fromEntries(
        CAMPOS_DE_COBRANCA.map((campo) => [campo, (dados[campo] ?? '').trim()])
    ) as Record<CampoDeCobranca, string>
}
