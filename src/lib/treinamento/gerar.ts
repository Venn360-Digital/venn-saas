import { acharDocumento, SECAO_EXEMPLOS, type DocumentoDeTreinamento } from './documentos'

/**
 * O rascunho de um documento, montado a partir dos campos antigos do agente.
 *
 * Existe para a transição não custar redigitação. Os campos que o método
 * absorve — endereço, descrição da empresa, atribuições, tom, instrução livre —
 * já têm conteúdo escrito nos agentes que atendem, e pedir para a conta
 * reescrever tudo em Markdown seria jogar fora trabalho feito.
 *
 * **É rascunho, não verdade.** Por isso roda na tela e não num script contra o
 * banco: o botão preenche o campo, a pessoa lê, e só grava se aprovar. Script
 * escreveria em produção antes de alguém conferir — e o que está aqui é o que o
 * agente vai dizer ao paciente.
 *
 * **O aviso vai num comentário de HTML**, que `semComentarios` tira antes de
 * indexar e antes do prompt. Então ele avisa quem edita e **nunca chega ao
 * modelo** — era isso que não dava para fazer antes do descarte de comentário
 * existir.
 *
 * Cinco dos oito não têm origem nenhuma nos campos antigos (serviços, técnicas
 * de venda, FAQ, privacidade): para eles não há rascunho, e devolver `null` é
 * mais honesto que devolver um modelo vazio disfarçado de conteúdo gerado.
 */

export interface CamposAntigos {
    agentName?: string | null
    companyName?: string | null
    companySector?: string | null
    companyAddress?: string | null
    companyDescription?: string | null
    jobDescription?: string | null
    agentFunction?: string | null
    voiceTone?: string | null
    systemPrompt?: string | null
}

/**
 * O objetivo que cada função implica, **escrito para gente ler**.
 *
 * Parecido com o `POSTURA` do construtor de prompt, e de propósito não é o mesmo
 * texto: aquele é instrução para o modelo, na segunda pessoa; este é um
 * parágrafo que o admin vai editar. Mesma intenção, vozes diferentes — e quem
 * escreve o `.md` precisa de algo que pareça escrito por alguém.
 */
const OBJETIVO: Record<string, string> = {
    sdr_atendimento:
        'Entender o que a pessoa precisa e conduzi-la até o agendamento de uma avaliação. ' +
        'Uma pergunta por vez, confirmando o que entendeu antes de propor horário.',
    vendas:
        'Esclarecer dúvidas sobre tratamentos, valores e formas de pagamento, e fechar o ' +
        'agendamento. Ser direto sobre preço quando a informação constar na base; nunca inventar valor.',
    suporte:
        'Resolver a dúvida ou o problema de quem já é paciente. Não forçar venda: quando a ' +
        'pessoa só precisa de uma informação, entregar a informação.',
}

const TOM: Record<string, string> = {
    pratico: 'Prático e objetivo.',
    formal: 'Formal e respeitoso.',
    casual: 'Casual e leve.',
    amigavel: 'Amigável e acolhedor.',
    entusiasmado: 'Entusiasmado.',
}

/** Uma seção só sai quando tem corpo — cabeçalho vazio não vira trecho. */
function secao(titulo: string, corpo?: string | null): string | null {
    const limpo = corpo?.trim()
    return limpo ? `## ${titulo}\n\n${limpo}` : null
}

function montar(doc: DocumentoDeTreinamento, secoes: (string | null)[]): string | null {
    const corpo = secoes.filter((s): s is string => s !== null)
    if (corpo.length === 0) return null

    const aviso =
        '<!-- Rascunho gerado a partir dos campos antigos do cadastro. Revise antes de salvar: ' +
        'este texto é o que o agente vai usar para responder. Este comentário não chega ao modelo. -->'

    /**
     * As seções previstas e **ainda vazias** entram como cabeçalho.
     *
     * Sem elas, o rascunho pareceria completo: a conferência de estrutura diria
     * "todas as seções preenchidas" porque as que faltam nem existiriam no
     * texto. Com o cabeçalho presente e sem corpo, o corte as descarta e a tela
     * conta zero trecho para elas — que é a verdade.
     *
     * (O comentário antigo citava a mensagem "sem conteúdo em: …". Ela foi
     * removida da tela quando se descobriu que as seções são da clínica, não
     * nossas; hoje o que aparece é o contador de trechos.)
     */
    const escritas = new Set(
        corpo.map((s) => s.slice(3, s.indexOf('\n')).trim())
    )
    const faltantes = doc.secoes
        .filter((s) => !escritas.has(s))
        .map((s) => `## ${s}\n`)

    return [`# ${doc.titulo}`, aviso, ...corpo, ...faltantes].join('\n\n')
}

export function gerarRascunho(slug: string, campos: CamposAntigos): string | null {
    const doc = acharDocumento(slug)
    if (!doc) return null

    switch (slug) {
        case 'instrucoes-centrais':
            return montar(doc, [
                secao(
                    'Identidade do agente',
                    [campos.agentName && `Você é ${campos.agentName}`, campos.companyName && `, da ${campos.companyName}`]
                        .filter(Boolean)
                        .join('') || null
                ),
                secao('Tom de voz', campos.voiceTone ? TOM[campos.voiceTone] ?? campos.voiceTone : null),
                secao(
                    'Objetivo principal',
                    campos.agentFunction ? OBJETIVO[campos.agentFunction] ?? null : null
                ),
                // A instrução livre era, na prática, a lista de limites: "nunca
                // prometa prazo", "não informe preço fora da base". É onde ela
                // pertence.
                secao('Limites técnicos', campos.systemPrompt),
            ])

        case 'empresa':
            return montar(doc, [
                secao(
                    'Identificação da empresa',
                    [
                        campos.companyName && `Nome: ${campos.companyName}`,
                        campos.companySector && `Setor: ${campos.companySector}`,
                    ]
                        .filter(Boolean)
                        .join('\n') || null
                ),
                secao('Endereço', campos.companyAddress),
                secao('Sobre a empresa', campos.companyDescription),
            ])

        case 'processo-comercial':
            // "Funções e atribuições" descrevia, nos agentes reais, as etapas do
            // atendimento — o que o agente faz, em ordem.
            return montar(doc, [secao('Etapas do atendimento', campos.jobDescription)])

        default:
            // Serviços, Técnicas de venda, FAQ e Privacidade não têm origem nos
            // campos antigos. `null` é mais honesto que um modelo vazio
            // disfarçado de conteúdo gerado.
            return null
    }
}

/** Se há o que gerar — é o que habilita o botão. */
export function temRascunho(slug: string, campos: CamposAntigos): boolean {
    return gerarRascunho(slug, campos) !== null
}

/** Exportado para o teste conferir que a seção reservada nunca vem preenchida. */
export const SECAO_RESERVADA = SECAO_EXEMPLOS
