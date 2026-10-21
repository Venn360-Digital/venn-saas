'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { marcarSujo } from '@/components/agents/creation/unsaved'
import {
    PerfilData, TrabalhoData, CerebroData, VozData, InstrucoesData,
    PADROES_DO_AGENTE, MODELOS_DE_TEXTO,
} from '@/types/agent-creation'
import { ENTONACAO_PADRAO, VOZ_PADRAO } from '@/lib/voz'
import { SETOR_PADRAO } from '@/components/agents/creation/tabs/TrabalhoTab'

/**
 * A instrução livre com que um agente novo nasce — curta de propósito.
 *
 * O que descreve a clínica (nome, setor, endereço, atribuições, tom, idioma) é
 * montado pelo worker a partir dos campos estruturados. Repetir isso aqui era o
 * que fazia o modelo receber a mesma informação duas vezes: uma em texto corrido
 * vindo deste modelo, outra em seções vindas do worker.
 */
const PROMPT_INICIAL =
    'Você é o assistente de atendimento desta clínica. Responda com base nas informações ' +
    'da empresa e na sua base de conhecimento. Quando não souber, diga que vai verificar ' +
    'com a equipe em vez de inventar.'

export function useAgentCreation(workspaceId: string) {
    const router = useRouter()
    const [isSaving, setIsSaving] = useState(false)

    // Estado inicial
    const [perfil, setPerfil] = useState<PerfilData>({
        name: '',
        agentFunction: PADROES_DO_AGENTE.agentFunction,
        voiceTone: PADROES_DO_AGENTE.voiceTone,
        language: PADROES_DO_AGENTE.language,
        timezone: PADROES_DO_AGENTE.timezone,
        initialMessage: MODELOS_DE_TEXTO.initialMessage,
    })

    const [trabalho, setTrabalho] = useState<TrabalhoData>({
        jobDescription: MODELOS_DE_TEXTO.jobDescription,
        companyDescription: MODELOS_DE_TEXTO.companyDescription,
    })

    const [cerebro, setCerebro] = useState<CerebroData>({
        files: [],
        websites: [],
        videos: [],
        faqs: [],
    })

    /**
     * A voz nasce desligada, mas **já escolhida e já com entonação**.
     *
     * Ligar o interruptor não pode ser o momento de descobrir que falta
     * configurar duas coisas. A voz padrão é a `coral` e o texto é o de
     * `ENTONACAO_PADRAO` — ambos visíveis na aba, ambos editáveis.
     */
    const [voz, setVoz] = useState<VozData>({
        voiceEnabled: false,
        voiceModel: VOZ_PADRAO,
        voiceTraining: ENTONACAO_PADRAO,
    })

    const [instrucoes, setInstrucoes] = useState<InstrucoesData>({
        llmModel: PADROES_DO_AGENTE.llmModel,
        temperature: PADROES_DO_AGENTE.temperature,
        systemPrompt: MODELOS_DE_TEXTO.systemPrompt,
    })

    const handleSave = async (agentId?: string | null) => {
        // Validação básica
        if (!perfil.name) {
            toast.error('Nome do agente é obrigatório')
            return
        }

        if (!workspaceId) {
            toast.error('Workspace não encontrado. Recarregue a página.')
            return
        }

        setIsSaving(true)

        try {
            // Construir payload
            const payload = {
                // Perfil
                name: perfil.name,
                initialMessage: perfil.initialMessage,
                agentFunction: perfil.agentFunction,
                voiceTone: perfil.voiceTone,
                language: perfil.language,
                timezone: perfil.timezone,

                // Trabalho
                jobDescription: trabalho.jobDescription,
                companyName: trabalho.companyName,
                // Fixo: o produto atende clínicas odontológicas. Gravar sempre
                // normaliza também o agente criado antes desta decisão.
                companySector: SETOR_PADRAO,
                companyWebsite: trabalho.companyWebsite,
                companyDescription: trabalho.companyDescription,
                companyAddress: trabalho.companyAddress,

                // Voz
                voiceEnabled: voz.voiceEnabled,
                voiceModel: voz.voiceModel,
                voiceTraining: voz.voiceTraining,


                // Instruções
                llmProvider: 'openai',
                llmModel: instrucoes.llmModel,
                temperature: instrucoes.temperature,
                /**
                 * Só vai quando tem conteúdo.
                 *
                 * Campo vazio não pode sobrescrever a instrução gravada — e o
                 * schema exige 10 caracteres, então mandar vazio seria um 400
                 * em cima de quem só queria trocar o tom de voz.
                 */
                ...(instrucoes.systemPrompt?.trim()
                    ? { systemPrompt: instrucoes.systemPrompt.trim() }
                    : {}),
                isActive: true,
            }

            let response
            // Verificação robusta: agentId deve ser string não-vazia
            if (agentId && typeof agentId === 'string' && agentId.trim() !== '') {
                /**
                 * Editar NÃO reescreve o `systemPrompt`.
                 *
                 * O payload montava um prompt a partir de um modelo e o enviava a
                 * cada salvar. Como a lista de agentes tem um editor que deixa
                 * escrever o prompt à mão, trocar o tom de voz numa aba apagava o
                 * que alguém tinha escrito lá — sem aviso, e sem jeito de
                 * recuperar.
                 *
                 * A persona é montada pelo worker a partir dos campos
                 * estruturados (empresa, função, endereço, tom, idioma). O
                 * `systemPrompt` é a instrução livre da clínica, e só muda quando
                 * ela mesma o edita.
                 */
                response = await fetch(`/api/agents/${agentId}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                })
            } else {
                // CREATE - Criar novo agente
                response = await fetch(`/api/agents?workspaceId=${workspaceId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        ...payload,
                        // Agente novo sem instrução escrita nasce com a curta
                        // padrão: o schema exige um prompt, e um texto que
                        // repetisse empresa e tom duplicaria o que o worker monta.
                        systemPrompt: instrucoes.systemPrompt?.trim() || PROMPT_INICIAL,
                    }),
                })
            }

            if (!response.ok) {
                const errorText = await response.text()
                console.error('[SAVE] Error response:', errorText)
                throw new Error(`Falha ao ${agentId ? 'atualizar' : 'criar'} agente: ${response.status} - ${errorText}`)
            }

            const agent = await response.json()

            /**
             * A base de conhecimento acompanha o salvar, criando ou editando.
             *
             * Antes só gravava na criação: arquivo, FAQ ou site acrescentado
             * depois sumia no salvar sem dizer nada. Os itens novos são os que
             * não vieram da base — a tela de edição carrega o que já existe e
             * marca como `persisted`, então salvar não re-indexa o acervo.
             */
            // `videos` fora da conta: o YouTube não é indexado ainda — ver a
            // nota na aba Cérebro — e um vídeo na lista não dá o que gravar.
            if (cerebro.faqs.length > 0 || cerebro.websites.length > 0 || cerebro.files.length > 0) {
                await saveKnowledgeBase(agent.id)
            }

            /**
             * A imagem sobe depois do agente existir.
             *
             * O caminho no Storage é escopado por workspace e agente, então não
             * há onde colocar o arquivo antes de haver um id. Falhar aqui não
             * desfaz o agente salvo: o aviso é específico e o resto do trabalho
             * da clínica fica de pé.
             */
            if (perfil.avatarFile) {
                const form = new FormData()
                form.append('file', perfil.avatarFile)

                const avatarResponse = await fetch(`/api/agents/${agent.id}/avatar`, {
                    method: 'POST',
                    body: form,
                })

                if (avatarResponse.ok) {
                    const { avatar } = await avatarResponse.json()
                    setPerfil((atual) => ({ ...atual, avatar: avatar ?? undefined, avatarFile: null }))
                } else {
                    const { error } = await avatarResponse.json().catch(() => ({ error: '' }))
                    toast.error(error || 'O agente foi salvo, mas a imagem não subiu')
                }
            } else if (perfil.avatar === '' && agentId) {
                // Imagem removida na tela: a coluna precisa ser limpa no banco,
                // senão o retrato antigo volta no próximo carregamento.
                await fetch(`/api/agents/${agentId}/avatar`, { method: 'DELETE' })
            }

            // Gravou: não há mais o que perder ao trocar de seção.
            marcarSujo(false)
            toast.success(`Agente ${agentId ? 'atualizado' : 'criado'}`)

            /**
             * Editar continua na aba onde se estava.
             *
             * Salvar jogava de volta para a lista, mesmo editando: quem ajustava
             * o tom de voz e queria conferir o Cérebro em seguida tinha de abrir
             * o agente de novo e navegar até lá. Criar é diferente — o agente
             * passa a existir e a URL precisa ganhar o id, senão o próximo salvar
             * criaria um segundo agente.
             */
            if (!agentId) {
                const tab = new URLSearchParams(window.location.search).get('tab') ?? 'perfil'
                router.replace(`/atendimento/agentes/novo?id=${agent.id}&tab=${tab}`)
            }
        } catch (error) {
            console.error('[SAVE] Error saving agent:', error)
            const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido'
            toast.error(`Erro ao salvar agente: ${errorMessage}`)
        } finally {
            setIsSaving(false)
        }
    }

    /**
     * Grava o Cérebro — tudo por `/api/rag/index`, que é o único caminho que
     * gera vetor.
     *
     * Antes, só arquivo ia para a fila de indexação. FAQ e site eram gravados
     * como linha crua em `/api/agents/[id]/knowledge`, sem embedding, e o
     * buscador ordena por distância de vetor: linha sem vetor ordena por último
     * e só aparecia enquanto houvesse menos trechos vetorizados que o limite.
     * Bastava um PDF para as FAQs da clínica sumirem da consulta para sempre.
     *
     * Só o que é novo é enviado: `persisted` marca o que já veio da base ao abrir
     * a tela, e reenviar tudo a cada salvar pagaria embedding do acervo inteiro.
     */
    const saveKnowledgeBase = async (agentId: string) => {
        const index = async (body: {
            title: string
            content: string
            type: 'faq' | 'doc' | 'website'
            url?: string
        }) => {
            const response = await fetch('/api/rag/index', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    agentId,
                    ...body,
                    // Reenviar a mesma fonte substitui o que havia, em vez de
                    // somar uma segunda cópia de cada trecho.
                    replaceExisting: true,
                }),
            })
            if (!response.ok) {
                throw new Error(body.title)
            }
        }

        const failed: string[] = []

        /**
         * A pergunta entra no texto indexado, não só no título.
         *
         * O embedding é calculado sobre o conteúdo do trecho. Indexando apenas a
         * resposta, "vocês atendem convênio?" tinha que se parecer com o texto
         * da resposta — que normalmente não repete a pergunta. Com as duas
         * linhas juntas, a busca encontra pela pergunta, que é como o paciente
         * escreve.
         */
        for (const faq of cerebro.faqs) {
            if (faq.persisted) continue
            try {
                await index({
                    title: faq.question,
                    content: `Pergunta: ${faq.question}\nResposta: ${faq.answer}`,
                    type: 'faq',
                })
            } catch {
                failed.push(faq.question)
            }
        }

        for (const website of cerebro.websites) {
            if (website.persisted) continue
            if (!website.content?.trim()) continue
            try {
                await index({
                    title: website.title || website.url,
                    content: website.content,
                    type: 'website',
                    url: website.url,
                })
            } catch {
                failed.push(website.url)
            }
        }

        for (const file of cerebro.files) {
            if (file.persisted) continue
            if (!file.content?.trim()) continue
            try {
                await index({ title: file.filename, content: file.content, type: 'doc' })
            } catch {
                failed.push(file.filename)
            }
        }

        if (failed.length > 0) {
            toast.error(
                `Não foi possível indexar: ${failed.slice(0, 3).join(', ')}` +
                (failed.length > 3 ? ` e mais ${failed.length - 3}` : '')
            )
        }
    }

    return {
        perfil,
        setPerfil,
        trabalho,
        setTrabalho,
        cerebro,
        setCerebro,
        voz,
        setVoz,
        instrucoes,
        setInstrucoes,
        handleSave,
        isSaving,
    }
}
