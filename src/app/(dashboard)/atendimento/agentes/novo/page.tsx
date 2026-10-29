'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { useEffect, useState, useRef, useCallback } from 'react'
import { getSession } from '@/lib/auth/cliente'
import { AgentFrame } from '@/components/agents/creation/AgentFrame'
import { CamposSomenteLeitura } from '@/components/agents/creation/CamposSomenteLeitura'
import { EsqueletoDoFormulario } from '@/components/agents/creation/EsqueletoDoFormulario'
import { marcarSujo } from '@/components/agents/creation/unsaved'
import { usePermissions } from '@/hooks/usePermissions'
import { Button } from '@/components/ui/button'
import { PerfilTab } from '@/components/agents/creation/tabs/PerfilTab'
import { TrabalhoTab } from '@/components/agents/creation/tabs/TrabalhoTab'
import { CerebroTab } from '@/components/agents/creation/tabs/CerebroTab'
import { VozTab } from '@/components/agents/creation/tabs/VozTab'
import { EnsaioTab } from '@/components/agents/creation/tabs/EnsaioTab'
import { DocumentoDeTreinamento } from '@/components/agents/creation/DocumentoDeTreinamento'
import { acharDocumento } from '@/lib/treinamento/documentos'
import { useAgentCreation } from '@/hooks/useAgentCreation'
import { Loader2, Save } from 'lucide-react'
import { toast } from 'sonner'

interface KnowledgeSource {
    id: string
    title: string
    type: string
    url: string | null
    chars: number
    chunks: number
    createdAt: string
    content: string
}

/**
 * A resposta de uma FAQ, de volta do texto indexado.
 *
 * O trecho é gravado como "Pergunta: …\nResposta: …" para que a busca encontre
 * pela pergunta, que é como o paciente escreve. FAQ gravada por uma versão
 * anterior tem só a resposta no conteúdo, e cai no retorno direto.
 */
function faqAnswer(content: string): string {
    const match = content.match(/\nResposta:\s*([\s\S]*)$/)
    return (match ? match[1] : content).trim()
}

function NovoAgenteContent() {
    const { canManage } = usePermissions()
    const searchParams = useSearchParams()
    const currentTab = searchParams.get('tab') || 'perfil'

    const urlAgentId = searchParams.get('id')
    const agentIdRef = useRef<string | null>(urlAgentId)

    useEffect(() => {
        agentIdRef.current = urlAgentId
    }, [urlAgentId])

    const [workspaceId, setWorkspaceId] = useState<string>('')
    const [loading, setLoading] = useState(!!urlAgentId)
    const [dataLoaded, setDataLoaded] = useState(false)

    const {
        documentos,
        setDocumentos,
        carregarDocumentos,
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
        handleSave: originalHandleSave,
        isSaving,
    } = useAgentCreation(workspaceId)

    const handleSave = useCallback(() => {
        const currentAgentId = agentIdRef.current
        originalHandleSave(currentAgentId)
    }, [originalHandleSave, urlAgentId])

    useEffect(() => {
        fetchWorkspace()
    }, [])

    useEffect(() => {
        const agentId = agentIdRef.current
        if (agentId && workspaceId && !dataLoaded) {
            loadAgentData(agentId)
            void carregarDocumentos(agentId)
        }
    }, [workspaceId, dataLoaded, urlAgentId])

    const fetchWorkspace = async () => {
        try {
            const { data: sessao } = await getSession()

            if (sessao?.user) {
                const response = await fetch('/api/workspaces')
                if (response.ok) {
                    const workspaces = await response.json()
                    if (workspaces && workspaces.length > 0) {
                        setWorkspaceId(workspaces[0].id)
                    }
                } else {
                    const agentsResponse = await fetch('/api/agents?workspaceId=current')
                    if (agentsResponse.ok) {
                        setWorkspaceId('current')
                    }
                }
            }
        } catch (error) {
            console.error('Error fetching workspace:', error)
            setWorkspaceId('current')
        }
    }

    const loadAgentData = async (agentId: string) => {
        try {
            const response = await fetch(`/api/agents/${agentId}`)
            if (!response.ok) throw new Error('Failed to load agent')

            const agent = await response.json()

            setPerfil({
                name: agent.name,
                avatar: agent.avatar || undefined,
                avatarFile: null,
                initialMessage: agent.initialMessage || '',
                agentFunction: agent.agentFunction || undefined,
                voiceTone: agent.voiceTone || '',
                language: agent.language || 'pt-BR',
                timezone: agent.timezone || 'America/Sao_Paulo',
            })

            setTrabalho({
                jobDescription: agent.jobDescription || '',
                companyName: agent.companyName || '',
                companySector: agent.companySector || '',
                companyWebsite: agent.companyWebsite || '',
                companyDescription: agent.companyDescription || '',
                companyAddress: agent.companyAddress || '',
            })

            setInstrucoes({
                systemPrompt: agent.systemPrompt || '',
                llmModel: agent.llmModel,
                temperature: agent.temperature ?? 0.7,
            })

            setVoz({
                voiceEnabled: agent.voiceEnabled || false,
                voiceModel: agent.voiceModel || '',
                voiceTraining: agent.voiceTraining || '',
            })

            await loadKnowledge(agentId)

            setDataLoaded(true)
            setLoading(false)
        } catch (error) {
            console.error('Error loading agent:', error)
            toast.error('Erro ao carregar dados do agente')
            setLoading(false)
        }
    }

    /**
     * Carrega o Cérebro já indexado.
     *
     * Faltava: a tela de edição montava perfil, trabalho, voz e visual e deixava
     * `cerebro` vazio. Quem abria um agente para editar não via nenhum dos
     * arquivos, FAQs ou sites que havia cadastrado — e não tinha por onde apagar
     * nada. O que vem da base é marcado como `persisted`, então salvar não paga
     * embedding de novo pelo acervo inteiro.
     *
     * Falhar aqui não impede a edição do resto: o aviso é específico e as outras
     * abas continuam utilizáveis.
     */
    const loadKnowledge = async (agentId: string) => {
        try {
            const response = await fetch(`/api/agents/${agentId}/knowledge`)
            if (!response.ok) throw new Error('Failed to load knowledge')

            const sources: KnowledgeSource[] = await response.json()

            setCerebro({
                files: sources
                    .filter((source) => source.type === 'doc')
                    .map((source) => ({
                        id: source.id,
                        filename: source.title,
                        size: 0,
                        type: '',
                        uploadedAt: new Date(source.createdAt),
                        // O texto não volta inteiro: a tela só precisa do nome e
                        // do tamanho, e trazer o acervo todo para o navegador a
                        // cada abertura não serviria a ninguém.
                        content: '',
                        chars: source.chars,
                        persisted: true,
                    })),
                websites: sources
                    .filter((source) => source.type === 'website')
                    .map((source) => ({
                        id: source.id,
                        url: source.url || source.title,
                        title: source.title,
                        addedAt: new Date(source.createdAt),
                        chars: source.chars,
                        persisted: true,
                    })),
                videos: sources
                    .filter((source) => source.type === 'video')
                    .map((source) => ({
                        id: source.id,
                        url: source.url || source.title,
                        title: source.title,
                        platform: 'youtube' as const,
                        addedAt: new Date(source.createdAt),
                        persisted: true,
                    })),
                faqs: sources
                    .filter((source) => source.type === 'faq')
                    .map((source) => ({
                        id: source.id,
                        question: source.title,
                        answer: faqAnswer(source.content),
                        persisted: true,
                    })),
            })
        } catch (error) {
            console.error('Error loading knowledge:', error)
            toast.error('Não foi possível carregar a base de conhecimento do agente')
        }
    }

    /**
     * Os campos antigos, para o rascunho da transição.
     *
     * Montado da tela e não do banco: é o que a pessoa está vendo, inclusive o
     * que ela acabou de digitar e ainda não salvou.
     */
    const camposAntigos = {
        agentName: perfil.name,
        companyName: trabalho.companyName,
        companySector: trabalho.companySector,
        companyAddress: trabalho.companyAddress,
        companyDescription: trabalho.companyDescription,
        jobDescription: trabalho.jobDescription,
        agentFunction: perfil.agentFunction,
        voiceTone: perfil.voiceTone,
        systemPrompt: instrucoes.systemPrompt,
    }

    const renderTab = () => {
        switch (currentTab) {
            case 'perfil':
                return (
                    <PerfilTab
                        data={perfil}
                        onChange={(data) => { marcarSujo(true); setPerfil({ ...perfil, ...data }) }}
                        somenteLeitura={!canManage}
                        instrucoes={instrucoes}
                        onInstrucoesChange={(data) => { marcarSujo(true); setInstrucoes({ ...instrucoes, ...data }) }}
                        centrais={{
                            valor: documentos['instrucoes-centrais']?.content ?? '',
                            indexadoEm: documentos['instrucoes-centrais']?.indexedAt ?? null,
                            trechos: documentos['instrucoes-centrais']?.indexedChunks ?? null,
                        }}
                        camposAntigos={camposAntigos}
                        onCentraisChange={(content) => {
                            marcarSujo(true)
                            setDocumentos((atual) => ({
                                ...atual,
                                'instrucoes-centrais': { ...atual['instrucoes-centrais'], content },
                            }))
                        }}
                    />
                )
            case 'trabalho':
                return (
                    <TrabalhoTab
                        data={trabalho}
                        onChange={(data) => { marcarSujo(true); setTrabalho({ ...trabalho, ...data }) }}
                    />
                )
            case 'cerebro':
                return (
                    <CerebroTab
                        data={cerebro}
                        onChange={(data) => { marcarSujo(true); setCerebro({ ...cerebro, ...data }) }}
                        agentId={urlAgentId}
                        canManage={canManage}
                    />
                )
            case 'ensaio':
                /**
                 * O ensaio não tem estado no formulário, e isso é o desenho.
                 *
                 * Ele não edita nada do agente: conversa com o que está
                 * gravado. Por isso não recebe `onChange` nem chama
                 * `marcarSujo` — abrir o console e fazer dez perguntas não pode
                 * deixar a tela "suja" e cobrar um Salvar que não tem o que
                 * salvar.
                 */
                return <EnsaioTab agentId={urlAgentId} canManage={canManage} />
            case 'voz':
                return (
                    <VozTab
                        data={voz}
                        onChange={(data) => { marcarSujo(true); setVoz({ ...voz, ...data }) }}
                    />
                )
            default: {
                /**
                 * As seis guias de documento, todas pelo mesmo componente.
                 *
                 * Não há um `case` por documento porque não há código por
                 * documento: o catálogo descreve teto, modo, seções e
                 * explicação, e a guia é o mesmo campo desenhado a partir
                 * disso. O oitavo documento não passa por aqui.
                 */
                const doc = acharDocumento(currentTab)
                if (!doc) return <div>Aba não encontrada</div>

                const gravado = documentos[doc.slug]
                return (
                    <DocumentoDeTreinamento
                        doc={doc}
                        valor={gravado?.content ?? ''}
                        somenteLeitura={!canManage}
                        camposAntigos={camposAntigos}
                        indexadoEm={gravado?.indexedAt ?? null}
                        trechos={gravado?.indexedChunks ?? null}
                        onChange={(content) => {
                            marcarSujo(true)
                            setDocumentos((atual) => ({
                                ...atual,
                                [doc.slug]: { ...atual[doc.slug], content },
                            }))
                        }}
                    />
                )
            }
        }
    }


    return (
        <AgentFrame
            secao="personalidade"
            dica="Grava o agente com o que está nas guias de Treinamento."
            /* Sem Salvar para quem não administra: a API recusa, e um botão
               que só sabe recusar é pior que a sua ausência. */
            acoes={canManage ? (
                <Button onClick={handleSave} size="sm" className="h-8" disabled={isSaving || loading}>
                    {isSaving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                    {isSaving ? 'Salvando…' : 'Salvar agente'}
                </Button>
            ) : null}
        >
            {loading ? <EsqueletoDoFormulario /> : (
                <CamposSomenteLeitura ativo={!canManage}>{renderTab()}</CamposSomenteLeitura>
            )}

            {/* O Salvar vive com o formulário, não no cabeçalho: lá em cima ele
                parece valer para a tela inteira, e numa tela de guias vale para
                uma guia só (DESIGN.md, Tela 03).

                O rótulo diz "agente" e não o nome da guia porque é o que ele
                faz: a gravação manda o agente inteiro, com o que as guias
                têm em mão. Chamá-lo de "Salvar perfil" seria um nome bonito
                para algo que grava mais do que diz. */}
        </AgentFrame>
    )
}

export default function NovoAgentePage() {
    return (
        <Suspense fallback={
            <div className="flex h-full min-h-[60vh] items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        }>
            <NovoAgenteContent />
        </Suspense>
    )
}
