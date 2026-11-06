import 'server-only'

/**
 * O cofre **da conta** Cloudflare — um segredo, um lugar, três apps.
 *
 * ## O problema que isto resolve
 *
 * Até aqui todo segredo de texto era *do Worker*: `wrangler secret put` grava
 * um valor dentro de um Worker, e a Venn360 tem três. Cinco desses segredos
 * não variam por produto — eles identificam a Venn360 junto à OpenAI, ao Asaas
 * e ao Google —, então o mesmo valor estava **triplicado**, e manter três
 * cópias iguais é manter três chances de elas divergirem.
 *
 * Divergiram. Em 03/11/2026 a cópia de **um** dos produtos ficou inválida
 * enquanto as outras duas seguiam boas: a transcrição de voz morreu só ali, e
 * ninguém soube por três dias — porque "a chave está certa" era verdade em dois
 * dos três lugares. (Citar qual produto aqui é o que a auditoria de isolamento
 * recusa, e ela está certa: o arquivo é o mesmo nos três.)
 *
 * O Secrets Store da Cloudflare é um cofre de **conta**: o valor mora uma vez e
 * os Workers o recebem por binding. Rotacionar passa a ser um ato, não três.
 *
 * ## Por que semear `process.env` em vez de ler o binding em cada ponto
 *
 * O binding do Secrets Store entrega um objeto com `get()` assíncrono, e os
 * pontos que leem a chave da OpenAI são **síncronos** por desenho alheio:
 * `criarEmbeddings()` passa a chave para o construtor do `OpenAIEmbeddings`, e
 * `LLMFactory.getApiKey()` é estático e síncrono. Tornar os dois assíncronos
 * propagaria `await` por toda a cadeia de quem cria um provedor de LLM — um
 * refactor largo para não mudar nada observável.
 *
 * E há uma razão melhor, que já estava escrita em `trabalhos/ambiente.ts`:
 * este repositório escolheu `process.env` como **a** superfície de leitura de
 * segredo de texto, justamente porque é o único caminho que serve ao Worker e
 * ao `next dev` sem bifurcar o código. Semear o cofre ali estende essa escolha
 * em vez de abrir uma segunda.
 *
 * ## O que isto custa, dito com clareza
 *
 * **Rotação não é instantânea.** Segredo do Worker chega por um deploy novo, e
 * deploy troca os isolates — o valor velho morre com eles. Segredo do cofre da
 * conta muda *sem* deploy, que é o ganho; o preço é que um isolate já de pé
 * continua com o valor que semeou ao nascer. A janela é a vida de um isolate
 * (minutos), e a semeadura não sobrescreve o que o ambiente já trouxe, então
 * um valor posto por `wrangler secret put` continua vencendo. Para rotação
 * imediata, um deploy vazio resolve.
 *
 * **Nunca registra valor em log.** As funções abaixo devolvem presença, não
 * conteúdo, quando pedem para se explicar.
 */

/** O que um binding de Secrets Store oferece. Só a leitura interessa. */
export interface SegredoDoCofre {
    get(): Promise<string>
}

/**
 * Os segredos que moram no cofre da conta.
 *
 * Todos são de **plataforma**: identificam a Venn360 junto a um fornecedor, e
 * não a clínica junto a nós. Segredo que varia por produto — banco, token de
 * identidade, chave do Evolution daquele VPS — continua sendo do Worker, e
 * tem de continuar: é justamente o que não deve ser compartilhado.
 */
export const SEGREDOS_DA_CONTA = [
    'OPENAI_API_KEY',
    'PLATFORM_ASAAS_CLIENT_ID',
    'PLATFORM_ASAAS_CLIENT_SECRET',
    'PLATFORM_GOOGLE_CALENDAR_CLIENT_ID',
    'PLATFORM_GOOGLE_CALENDAR_CLIENT_SECRET',
] as const

export type SegredoDaConta = (typeof SEGREDOS_DA_CONTA)[number]

/** O formato que a costura entrega: binding por nome, todos opcionais. */
export type BindingsDoCofre = Partial<Record<SegredoDaConta, SegredoDoCofre | undefined>>

let semeado = false

export interface ResultadoDaSemeadura {
    /** Nomes que o cofre forneceu e o ambiente ainda não tinha. */
    doCofre: SegredoDaConta[]
    /** Nomes que já vinham do ambiente — o cofre não sobrescreve. */
    doAmbiente: SegredoDaConta[]
    /** Nomes sem binding e sem ambiente: faltando de verdade. */
    ausentes: SegredoDaConta[]
}

/**
 * Lê o cofre e completa `process.env`, uma vez por isolate.
 *
 * **O ambiente vence.** Se o valor já está em `process.env` — porque é um
 * segredo do Worker, ou um `.env` de desenvolvimento —, o cofre não o
 * substitui. Isso é o que torna a adoção reversível: declarar o binding não
 * tira o caminho antigo do ar, e tirar o binding não derruba quem já tinha o
 * segredo no Worker. Os dois convivem durante a migração.
 *
 * Nunca lança. Um `get()` que falhe deixa o nome em `ausentes`, e quem for
 * usar a chave reage à ausência como já reagia — a sonda diária é quem avisa.
 */
export async function semearCofreDaConta(
    bindings: BindingsDoCofre
): Promise<ResultadoDaSemeadura> {
    const resultado: ResultadoDaSemeadura = { doCofre: [], doAmbiente: [], ausentes: [] }
    if (semeado) return resultado

    for (const nome of SEGREDOS_DA_CONTA) {
        if (process.env[nome]?.trim()) {
            resultado.doAmbiente.push(nome)
            continue
        }

        const binding = bindings[nome]
        if (!binding) {
            resultado.ausentes.push(nome)
            continue
        }

        try {
            const valor = (await binding.get())?.trim()
            if (valor) {
                process.env[nome] = valor
                resultado.doCofre.push(nome)
            } else {
                resultado.ausentes.push(nome)
            }
        } catch {
            // Cofre indisponível não é motivo para o Worker não subir: o que
            // depende do segredo falha sozinho e com mensagem própria.
            resultado.ausentes.push(nome)
        }
    }

    semeado = true
    return resultado
}

/** Para o log da entrada: quem veio de onde, sem nenhum valor. */
export function resumirSemeadura(r: ResultadoDaSemeadura): string {
    const partes: string[] = []
    if (r.doCofre.length) partes.push(`cofre: ${r.doCofre.join(', ')}`)
    if (r.doAmbiente.length) partes.push(`ambiente: ${r.doAmbiente.join(', ')}`)
    if (r.ausentes.length) partes.push(`ausentes: ${r.ausentes.join(', ')}`)
    return partes.join(' · ') || 'nada a semear'
}
