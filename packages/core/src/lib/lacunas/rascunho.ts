/**
 * O rascunho que a mineração propõe, e o que ela deliberadamente NÃO escreve.
 *
 * Parte pura: o prompt e a leitura da resposta. Quem chama o modelo é o job
 * semanal.
 *
 * ## A regra que organiza este arquivo inteiro
 *
 * **A mineração não escreve a resposta.** Ela escreve a *pergunta* e deixa a
 * resposta em branco, marcada.
 *
 * O motivo não é cautela, é lógica: a lacuna existe porque a resposta não está
 * em lugar nenhum do acervo. Um modelo que a escrevesse estaria inventando — e
 * inventando exatamente as três coisas que o prompt do agente proíbe inventar
 * (preço, horário, prazo), porque são essas que faltam.
 *
 * E o estrago teria um caminho curto até o paciente: o instrutor abre a fila com
 * vinte sugestões, aprova em sequência, e um preço plausível que ninguém
 * cobrou vira **fonte de verdade** do agente. Seria o pior defeito deste
 * sistema inteiro, produzido pela funcionalidade que existe para melhorá-lo.
 *
 * ## O que torna o branco seguro
 *
 * O lugar do branco é um comentário de HTML, e `semComentarios` (ver
 * `lib/rag/secoes.ts`) descarta comentário antes de cortar o texto para o
 * acervo. Então rascunho aprovado **sem preencher** não entrega resposta
 * errada ao modelo: entrega nada, e a pergunta volta a ser lacuna na semana
 * seguinte — que é o comportamento correto.
 */

import { DOCUMENTOS } from '../treinamento/documentos'
import type { Grupo } from './agrupar'
import { vocab } from '../vocabulario'
import { comArtigo } from '../concordancia'

/**
 * Os documentos que podem receber um rascunho: os dois de **conteúdo**, pelo
 * slug — nunca pelo modo de indexação.
 *
 * O critério já foi “modo rag”, e isso quebrou em silêncio: quando `servicos` e
 * `faq` passaram ao modo `prompt` (12/11, para o preço não depender de busca),
 * o filtro ficou vazio e a mineração morreu — todo alvo era recusado. O modo
 * diz COMO o documento chega ao modelo; quem pode receber rascunho é decisão
 * sobre O QUE o documento é.
 *
 * Os demais continuam fora, e o motivo continua o mesmo: carregam limites e
 * identidade — o que o agente não promete, o que ele não diagnostica. Deixar a
 * mineração propor texto para eles seria deixar uma sugestão automática mexer
 * na parte do sistema em que um erro não tem como ser percebido depois. O
 * branco segue seguro nos dois destinos: tanto o acervo (`indexar.ts`) quanto o
 * prompt (`prompt.ts`) descartam comentário HTML via `semComentarios`.
 */
/**
 * Memoizada porque depende de `DOCUMENTOS()`, que passou a interpolar o
 * vocabulário — a dependência se propaga, e uma constante aqui voltaria a ler
 * a marca na validação do script.
 */
let alvosCache: string[] | null = null
export function ALVOS_POSSIVEIS(): string[] {
    if (alvosCache === null) {
        alvosCache = ['faq', 'servicos'].filter((slug) => DOCUMENTOS().some((d) => d.slug === slug))
    }
    return alvosCache
}

export type AlvoDoRascunho = string

/** O alvo padrão: a FAQ existe exactamente para isto, um `##` por pergunta. */
export const ALVO_PADRAO = 'faq'

/**
 * O prompt que transforma um grupo de lacunas numa entrada rascunhada.
 *
 * Pede três coisas e proíbe uma. Pede: o documento de destino (de uma lista
 * fechada), o cabeçalho da seção escrito como pergunta, e as variações que as
 * pessoas usaram — porque a FAQ é recuperada por busca e os sinônimos **dentro**
 * da resposta são o que fazem a quarta formulação achar a entrada.
 *
 * Proíbe: escrever a resposta.
 */
export function promptDoRascunho(grupo: Grupo, variacoes: string[]): string {
    const lista = variacoes.slice(0, 8).map((v) => `- ${v}`).join('\n')

    return [
        `Você organiza a base de conhecimento de um agente de atendimento de ${vocab().organizacao}.`,
        '',
        `${grupo.demanda} pessoa(s) perguntaram isto e o agente não soube responder:`,
        '',
        `**${grupo.representante.pergunta}**`,
        '',
        'As formas como perguntaram:',
        lista,
        '',
        '## O que fazer',
        `Escolha o documento de destino entre: ${ALVOS_POSSIVEIS().join(', ')}.`,
        `\`servicos\` é para preço, duração e condição de ${comArtigo(vocab(), 'servico', 'um')}. \`faq\` é para ` +
            'qualquer outra dúvida recorrente.',
        '',
        'Escreva o cabeçalho da seção **como pergunta**, na forma mais natural, e em ' +
            'seguida liste as outras formas de perguntar a mesma coisa — elas fazem a ' +
            'busca encontrar a entrada quando alguém pergunta diferente.',
        '',
        '## O que você NÃO faz',
        '**Não escreva a resposta.** Você não sabe: ela não está em lugar nenhum da base, ' +
            'e é por isso que esta pergunta chegou até aqui. Nunca escreva preço, valor, ' +
            'horário, prazo, duração ou condição de pagamento — nem como exemplo, nem ' +
            'como "normalmente é".',
        '',
        '## Formato da resposta',
        'Exatamente assim, e nada mais:',
        '',
        'ALVO: <servicos ou faq>',
        'SECAO: ## <a pergunta>',
        'VARIACOES: <as outras formas, separadas por ponto e vírgula>',
    ].join('\n')
}

export interface RascunhoLido {
    alvo: string
    /** O cabeçalho, já com `##`. */
    secao: string
    variacoes: string[]
}

/**
 * Lê a saída do modelo, ou devolve `null`.
 *
 * `null` quando o alvo não é um dos permitidos ou quando a seção não veio: a
 * sugestão é descartada e a lacuna fica como estava, para a próxima semana.
 * Aceitar um alvo inventado gravaria rascunho num documento que não existe, e
 * aceitar seção vazia poria um `##` sem título no acervo da clínica.
 */
export function interpretarRascunho(saida: string): RascunhoLido | null {
    const alvo = saida.match(/^ALVO:\s*(.+)$/m)?.[1]?.trim().toLowerCase()
    if (!alvo || !ALVOS_POSSIVEIS().includes(alvo)) return null

    const secaoCrua = saida.match(/^SECAO:\s*(.+)$/m)?.[1]?.trim()
    if (!secaoCrua) return null

    // O `##` é garantido aqui e não pedido ao modelo: ele erra o número de
    // cerquilhas, e o corte por seção depende do nível do cabeçalho.
    const titulo = secaoCrua.replace(/^#+\s*/, '').trim()
    if (!titulo) return null

    const variacoes = (saida.match(/^VARIACOES:\s*(.+)$/m)?.[1] ?? '')
        .split(';')
        .map((v) => v.trim())
        .filter((v) => v.length > 2)

    return { alvo, secao: `## ${titulo}`, variacoes }
}

/**
 * O texto que vai para o rascunho do documento, com o branco marcado.
 *
 * O comentário de HTML é o que torna a aprovação segura: `semComentarios`
 * descarta comentário antes de o texto ir para o acervo, então aprovar sem
 * preencher não entrega resposta inventada ao modelo — entrega nada, e a
 * pergunta volta a aparecer como lacuna.
 */
export function textoDoRascunho(lido: RascunhoLido, demanda: number): string {
    const sinonimos =
        lido.variacoes.length > 0
            ? `\nTambém perguntam assim: ${lido.variacoes.join('; ')}.\n`
            : '\n'

    return (
        `${lido.secao}\n` +
        sinonimos +
        `<!-- confirmar: escreva aqui a resposta. ${demanda} pessoa(s) perguntaram isto e o ` +
        'agente não soube responder. Enquanto este comentário estiver aqui, nada desta ' +
        'seção chega ao agente. -->\n'
    )
}

/**
 * Junta o rascunho ao fim do texto que já existe.
 *
 * No fim e não no começo: a ordem das seções de um documento de acervo é a ordem
 * que quem escreveu escolheu, e empurrar uma sugestão para o topo reordena o
 * trabalho de outra pessoa. O corte por seção não se importa com a posição.
 */
export function somarAoDocumento(atual: string, rascunho: string): string {
    const base = atual.trimEnd()
    return base.length === 0 ? rascunho : `${base}\n\n${rascunho}`
}
