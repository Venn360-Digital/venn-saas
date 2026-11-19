// Types for Agent Creation Form

/**
 * Com o que um agente novo nasce — e para o que o duplicado cai quando o
 * original não tinha o campo preenchido.
 *
 * Existe para a clínica não precisar decidir seis coisas antes de ter o
 * primeiro agente atendendo. Cada valor é a escolha certa para a maioria:
 * SDR porque o trabalho é agendar, `gpt-4o-mini` porque dá conta da rotina por
 * uma fração do nosso custo, e 0,6 de criatividade porque preço e regra não
 * podem variar a cada pergunta.
 */
/**
 * Os textos com que os campos longos nascem — preenchidos, não como dica.
 *
 * Campo em branco com uma frase cinza por trás é um pedido de redação: a clínica
 * abre, não sabe o que escrever ali, e salva vazio. O agente então atende sem
 * saudação e sem nenhuma regra de conduta.
 *
 * Preenchido, vira edição em vez de redação — e mesmo quem não mexer sai com um
 * texto que funciona. São modelos deliberadamente genéricos de clínica, para
 * serem ajustados: o que é específico de cada uma (preço, convênio, horário)
 * mora no Cérebro, não aqui.
 */
/**
 * Função memoizada, e não constante: o texto lê o vocabulário, e `BRAND()` é
 * fail-fast. Constante de módulo é avaliada quando a Cloudflare VALIDA o
 * script — sem requisição e sem marca registrada —, e a publicação reprova com
 * `MarcaNaoRegistradaError`. A forma que já reprovou cinco publicações.
 */
function montarModelosDeTexto(v: Vocabulario, semente: SementeDoAgente) {
    /** "uma avaliação" / "um encontro" — o determinante segue o gênero declarado. */
    const umCompromisso = `${semente.compromisso.genero === 'f' ? 'uma' : 'um'} ${semente.compromisso.nome}`
    /** "sua avaliação" / "seu encontro". */
    const seuCompromisso = `${semente.compromisso.genero === 'f' ? 'sua' : 'seu'} ${semente.compromisso.nome}`
    /** O ramo é opcional: vazio num produto sem nicho, e aí não entra espaço algum. */
    const comRamo = (substantivo: string) =>
        semente.ramo ? `${substantivo} ${semente.ramo}` : substantivo

    /*
     * As regras de conduta: as COMUNS ficam aqui, as do RAMO vêm da marca.
     *
     * A divisão não é estética. "Não informe preço que não esteja na base" vale
     * em qualquer produto e, no core, melhora para os três de uma vez. "Não
     * prometa diagnóstico sem avaliação presencial" não diz nada a uma agência,
     * e manter isso aqui foi o que fez todo agente dos clones nascer com
     * instruções de clínica dentária.
     */
    const topicos = [
        `Responder dúvidas sobre ${comArtigo(v, 'servicos')} que ${comArtigo(v, 'organizacao')} oferece`,
        'Informar valores e formas de pagamento quando constarem na base de conhecimento',
        ...semente.topicosDoRamo,
        'Oferecer horários e registrar o interesse em agendar',
        `Encaminhar para a equipe quando o assunto for ${semente.assuntoDaEquipe} ou uma reclamação`,
    ]

    const regras = [
        ...semente.regrasDoRamo,
        'Não informe preço que não esteja na sua base de conhecimento; diga que vai confirmar com a equipe',
        'Peça o nome quando ainda não souber, uma única vez',
        `Reclamação ou assunto ${semente.assuntoDaEquipe} vai para a equipe, sem tentar resolver sozinho`,
    ]

    return {
    initialMessage:
        `Olá! Sou o assistente virtual ${comArtigo(v, 'organizacao', 'de')}. 😊\n\n` +
        `Posso tirar dúvidas sobre ${semente.duvidasSobre}, e também ` +
        `agendar ${seuCompromisso}.\n\n` +
        'Como posso ajudar você hoje?',

    jobDescription:
        'Atender quem chega pelo WhatsApp, entender o que a pessoa precisa e ' +
        `conduzi-la até o agendamento de ${umCompromisso}.\n\n` +
        topicos.map((t) => `- ${t}`).join('\n'),

    companyDescription:
        `${comRamo(v.Organizacao)} que atende ${semente.exemplosDeOferta}. ` +
        'Atendemos de [dia] a [dia], das [hora] às [hora].\n\n' +
        `Nosso diferencial é [o que ${comArtigo(v, 'organizacao')} faz melhor que as outras].`,

    systemPrompt:
        'Fale com acolhimento e vá direto ao ponto.\n\n' +
        regras.map((r) => `- ${r}`).join('\n'),
}
}

/**
 * O vocabulário e a semente entram por PARÂMETRO, e os dois são obrigatórios.
 *
 * Este módulo é alcançado pelo bundle do CLIENTE, e no navegador ninguém
 * registrou a marca: ler `vocab()` por dentro lançava
 * `MarcaNaoRegistradaError` na hidratação — depois de compilar, buildar e
 * publicar sem uma reclamação. Medido em 15/11/2026, e era defeito em
 * produção. No cliente as palavras vêm de `useVocab()` e a semente de
 * `useMarca()`; no servidor, de `vocab(settings)` e `BRAND()`. Na assinatura,
 * a cobrança é do compilador — e é por isso que a semente nasceu assim, em vez
 * de `BRAND().sementeDoAgente` lido aqui dentro, que seria a oitava ocorrência
 * do mesmo defeito.
 *
 * A memoização de módulo saiu junto: o resultado depende dos argumentos, e um
 * cache global devolveria a palavra da primeira unidade a todas as outras.
 */
export function MODELOS_DE_TEXTO(v: Vocabulario, semente: SementeDoAgente) {
    return montarModelosDeTexto(v, semente)
}

export const PADROES_DO_AGENTE = {
    agentFunction: 'sdr_atendimento' as const,
    voiceTone: 'pratico',
    language: 'pt-BR',
    timezone: 'America/Sao_Paulo',
    llmModel: 'gpt-4o-mini',
    temperature: 0.6,
}

export interface PerfilData {
    name: string
    /** O fuso da unidade, que o prompt usa para dizer que horas são agora. */
    timezone?: string
    /**
     * A imagem do agente, que vivia numa aba Visual só dela.
     *
     * `avatar` é a URL já gravada; `avatarFile` é o arquivo recém-escolhido, que
     * só pode subir depois do agente existir — o caminho no Storage é escopado
     * por workspace e agente.
     */
    avatar?: string
    avatarFile?: File | null
    initialMessage?: string
    agentFunction?: 'sdr_atendimento' | 'vendas' | 'suporte'
    voiceTone?: string
    language: string
}

export interface TrabalhoData {
    jobDescription?: string
    companyName?: string
    companySector?: string
    companyWebsite?: string
    companyDescription?: string
    /** Logradouro completo da unidade que este agente atende. */
    companyAddress?: string
}

/**
 * A instrução livre, o modelo e a temperatura.
 *
 * Existiam no banco sem nenhuma tela que os editasse — o único editor era um
 * diálogo inalcançável. Todo agente nascia no modelo padrão a 0,7 e ficava lá.
 */
export interface InstrucoesData {
    systemPrompt?: string
    llmModel: string
    temperature: number
}

/**
 * Um documento de treinamento como a tela o segura.
 *
 * O carimbo de indexação vem do banco e **não é editável**: é o que a tela
 * mostra para a conta saber que o que ela escreveu chegou ao Cérebro.
 */
export interface DocumentoGravado {
    content: string
    indexedAt: string | null
    indexedChunks: number | null
    /**
     * O acervo está atrasado: o que está indexado não é o que o texto publicado
     * daria hoje. Só o servidor sabe disso — depende de `indexedHash`.
     */
    desatualizado: boolean
}

export interface CerebroData {
    files: KnowledgeFile[]
    websites: KnowledgeWebsite[]
    videos: KnowledgeVideo[]
    faqs: KnowledgeFAQ[]
}

export interface VozData {
    voiceEnabled: boolean
    voiceModel?: string
    /** Prático, formal, casual, amigável — campo próprio, não a voz. */
    voiceTone?: string
    voiceTraining?: string
}

export interface AgentCreationData {
    // AI Configuration
    llmProvider: 'openai'
    llmModel: string
    systemPrompt: string
    temperature: number

    // Perfil
    perfil: PerfilData

    // Trabalho
    trabalho: TrabalhoData

    // Cérebro
    cerebro: CerebroData

    // Voz
    voz: VozData

    isActive: boolean
}

// Knowledge Base Types

/**
 * Já indexado para este agente, carregado da base ao abrir a tela de edição.
 *
 * Distingue o que a clínica acabou de acrescentar do que já está gravado: só o
 * primeiro grupo é enviado para indexação ao salvar. Sem esta marca, abrir um
 * agente e salvar re-embeddaria todo o acervo — e a tela de edição nem chegava a
 * carregar o cérebro, então ninguém via o que o agente já sabia.
 */
interface Persisted {
    persisted?: boolean
}

export interface KnowledgeFile extends Persisted {
    id: string
    filename: string
    size: number
    type: string
    uploadedAt: Date
    /** O texto extraído: é ele que vira cérebro, não o arquivo. */
    content: string
    chars: number
    /** Texto cortado no teto de extração — a tela avisa. */
    truncated?: boolean
}

export interface KnowledgeWebsite extends Persisted {
    id: string
    url: string
    title?: string
    addedAt: Date
    /**
     * O texto da página, lido por `/api/agents/knowledge/fetch-url`.
     *
     * Antes só a URL era guardada e a página nunca era lida: o site aparecia na
     * lista e o agente não sabia nada dele.
     */
    content?: string
    chars?: number
    truncated?: boolean
}

export interface KnowledgeVideo extends Persisted {
    id: string
    url: string
    title?: string
    platform: 'youtube' | 'vimeo' | 'other'
    addedAt: Date
}

export interface KnowledgeFAQ extends Persisted {
    id: string
    question: string
    answer: string
}

// API Response Types
export interface UploadResponse {
    url: string
    filename: string
    size: number
    type: string
}

export interface KnowledgeDocument {
    id: string
    title: string
    type: 'faq' | 'doc' | 'website' | 'video'
    url?: string
    metadata?: Record<string, unknown>
    createdAt: Date
}

// As preferências da conversa moram em `./agent-preferences`, junto com o
// schema que a API valida e o leitor que o worker usa. A cópia que vivia aqui
// divergiu do worker em `responseSpeed` e anulou o slider.

// Menu Comandos de Intenção - Regras

/**
 * A forma de condição e ação vem de `./rules`, que é a mesma que a API
 * valida e o motor de regras executa.
 *
 * Havia uma segunda cópia aqui, e ela divergia no que importa: declarava
 * `value` como `string`, enquanto o avaliador aceita lista (qualquer-uma-delas)
 * e número (minutos). É o mesmo tipo de duplicata que, nas preferências, deixou
 * o slider de velocidade inerte por meses.
 */
export type { RuleCondition, RuleAction } from './rules'
import type { RuleCondition, RuleAction } from './rules'
import type { Vocabulario } from '../lib/vocabulario'
import { comArtigo } from '../lib/concordancia'

import type { Brand } from '@venn/config/marca'

/** O pedaço da marca que estes textos consomem. */
type SementeDoAgente = Brand['sementeDoAgente']
export interface RuleData {
    id?: string
    name: string
    isActive: boolean
    /** Maior é avaliada primeiro. O worker ordena por ela; a tela não a expunha. */
    priority?: number
    conditions: RuleCondition[]
    actions: RuleAction[]
}
