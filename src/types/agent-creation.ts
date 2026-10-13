// Types for Agent Creation Form

export interface PerfilData {
    name: string
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

/**
 * As cores por agente saíram: só teriam efeito no widget do site, que não
 * existe, e o widget vai nascer na paleta do sistema.
 *
 * `avatar` é a URL já gravada; `avatarFile` é o arquivo que a tela acabou de
 * escolher e que só pode subir depois do agente existir — o upload precisa de um
 * `agentId` para escopar o caminho no Storage. Antes, a tela mandava a imagem
 * inteira como data URL dentro do PATCH; a API descartava o campo, e se não
 * descartasse teria enfiado megabytes de base64 numa coluna que o worker lê a
 * cada mensagem recebida.
 */
export interface VisualData {
    avatar?: string
    avatarFile?: File | null
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

    // Visual
    visual: VisualData

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

// As preferências da conversa moram em `@/types/agent-preferences`, junto com o
// schema que a API valida e o leitor que o worker usa. A cópia que vivia aqui
// divergiu do worker em `responseSpeed` e anulou o slider.

// Menu Comandos de Intenção - Regras
export interface RuleCondition {
    type: 'message_contains' | 'user_intent' | 'time_elapsed' | 'custom'
    operator: 'equals' | 'contains' | 'greater_than' | 'less_than' | 'starts_with'
    value: string
}

export interface RuleAction {
    type: 'send_message' | 'notify_human' | 'add_tag' | 'move_pipeline' | 'schedule_followup'
    params: Record<string, unknown>
}

export interface RuleData {
    id?: string
    name: string
    isActive: boolean
    conditions: RuleCondition[]
    actions: RuleAction[]
}
