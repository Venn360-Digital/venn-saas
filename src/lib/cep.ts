/**
 * Busca de endereço por CEP, pelo ViaCEP.
 *
 * Serviço público dos Correios espelhado pelo ViaCEP, sem chave e sem cadastro.
 * Vale a dependência porque o que ela evita é digitação: logradouro, bairro,
 * cidade e UF digitados à mão em formulário de cobrança erram — e endereço
 * errado em cobrança de cartão é recusa de transação, não erro cosmético.
 *
 * **Falha é silenciosa de propósito.** Se o ViaCEP estiver fora, ou o CEP não
 * existir, a pessoa continua digitando os campos à mão e contrata do mesmo
 * jeito. Travar o formulário porque um serviço de terceiro não respondeu seria
 * transformar conveniência em requisito.
 */

export interface EnderecoDoCep {
    address: string
    province: string
    city: string
    state: string
}

/** Só os dígitos; o CEP tem oito. */
function digitos(cep: string): string {
    return cep.replace(/\D/g, '')
}

export async function buscarCep(cep: string): Promise<EnderecoDoCep | null> {
    const limpo = digitos(cep)
    if (limpo.length !== 8) return null

    try {
        const res = await fetch(`https://viacep.com.br/ws/${limpo}/json/`, {
            // Sem cookies nem credenciais para um terceiro.
            credentials: 'omit',
        })
        if (!res.ok) return null

        const dados = (await res.json()) as {
            erro?: boolean | string
            logradouro?: string
            bairro?: string
            localidade?: string
            uf?: string
        }

        // CEP inexistente devolve 200 com `{ "erro": true }` — e já apareceu
        // como a string "true" também, então a conferência aceita as duas.
        if (dados.erro) return null

        return {
            address: dados.logradouro ?? '',
            province: dados.bairro ?? '',
            city: dados.localidade ?? '',
            state: dados.uf ?? '',
        }
    } catch {
        return null
    }
}
