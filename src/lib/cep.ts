/**
 * Busca de endereço por CEP, pela nossa própria rota.
 *
 * **Mesma origem, e não `viacep.com.br` direto** — foi aqui que a busca
 * quebrava. A CSP da resposta declara `connect-src 'self'` mais o R2
 * (`next.config.ts`), então o navegador recusava a chamada ao terceiro antes de
 * ela sair: `catch`, `null`, e nenhum sinal na tela. Quem consulta o ViaCEP
 * agora é o Worker, em `app/api/cep/[cep]`, onde CSP não se aplica e a resposta
 * ainda ganha cache.
 *
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
        const res = await fetch(`/api/cep/${limpo}`)
        if (!res.ok) return null
        // A rota responde `null` quando o CEP não existe ou o ViaCEP falhou.
        return (await res.json()) as EnderecoDoCep | null
    } catch {
        return null
    }
}
