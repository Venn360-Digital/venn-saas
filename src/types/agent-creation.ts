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
    voiceTraining?: string
}

export interface VisualData {
    avatar?: string
    visualConfig?: {
        userMessageColor?: string
        userFontColor?: string
        agentMessageColor?: string
        agentFontColor?: string
    }
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
export interface KnowledgeFile {
    id: string
    filename: string
    url: string
    size: number
    type: string
    uploadedAt: Date
}

export interface KnowledgeWebsite {
    id: string
    url: string
    title?: string
    addedAt: Date
}

export interface KnowledgeVideo {
    id: string
    url: string
    title?: string
    platform: 'youtube' | 'vimeo' | 'other'
    addedAt: Date
}

export interface KnowledgeFAQ {
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

// Menu Comandos de Intenção - Preferências
export interface PreferenciasData {
    showTypingIndicator: boolean
    responseSpeed: number
    keepContext: boolean
    useEmojis: boolean
    allowManualTakeover: boolean
    restrictTopics: boolean
    interactionLimit: number
}

// Menu Comandos de Intenção - Regras
export interface RuleCondition {
    type: 'message_contains' | 'user_intent' | 'time_elapsed' | 'custom'
    operator: 'equals' | 'contains' | 'greater_than' | 'less_than' | 'starts_with'
    value: string
}

export interface RuleAction {
    type: 'send_message' | 'notify_human' | 'add_tag' | 'move_pipeline' | 'schedule_followup'
    params: Record<string, any>
}

export interface RuleData {
    id?: string
    name: string
    isActive: boolean
    conditions: RuleCondition[]
    actions: RuleAction[]
}
