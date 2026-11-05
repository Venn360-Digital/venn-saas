'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { useEffect, useState, useRef, useCallback } from 'react'
import { getSession } from '@/lib/auth/cliente'
import { AgentFrame, type SecaoId } from '@/components/agents/creation/AgentFrame'
import { CamposSomenteLeitura } from '@/components/agents/creation/CamposSomenteLeitura'
import { EsperaDoFormulario } from '@/components/agents/creation/EsperaDoFormulario'
import { marcarSujo } from '@/components/agents/creation/unsaved'
import { usePermissions } from '@/hooks/usePermissions'
import { Button } from '@/components/ui/button'
import { PerfilTab } from '@/components/agents/creation/tabs/PerfilTab'
import { TrabalhoTab } from '@/components/agents/creation/tabs/TrabalhoTab'
import { CerebroTab } from '@/components/agents/creation/tabs/CerebroTab'
import { VozTab } from '@/components/agents/creation/tabs/VozTab'
import { EnsaioTab } from '@/components/agents/creation/tabs/EnsaioTab'
import { LacunasTab } from '@/components/agents/creation/tabs/LacunasTab'
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
        versao,
        pendentes,
        desatualizados,
        publicar,
        publicando,
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
            case 'lacunas':
                /**
                 * `urlAgentId` e não `agentIdRef`, igual ao Ensaio e pelo mesmo
                 * motivo: a guia não edita nada do agente, ela lê o que está
                 * gravado. Agente que acabou de ser criado não tem lacuna
                 * nenhuma para colher.
                 */
                return <LacunasTab agentId={urlAgentId} canManage={canManage} />
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
                        indexadoEm={gravado?.indexedAt ?? null}
                        trechos={gravado?.indexedChunks ?? null}
                        desatualizado={gravado?.desatualizado ?? false}
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


    /**
     * Esta página serve **quatro** seções da barra, não uma.
     *
     * Ensaio, Lacunas e Voz subiram para a barra em 2026-11-04 e continuam
     * morando aqui, no mesmo `?tab=`: são o mesmo formulário carregado, com o
     * mesmo agente em mão, e separá-las em rotas próprias faria cada uma
     * recarregar o agente inteiro para mostrar um painel. Quem a barra marca
     * como aberta sai da guia, então.
     */
    const secaoDaGuia: SecaoId =
        currentTab === 'ensaio' || currentTab === 'lacunas' || currentTab === 'voz'
            ? currentTab
            : 'personalidade'

    /**
     * Ensaio e Lacunas não gravam nada.
     *
     * Ensaio é um console de teste e Lacunas é uma bandeja de leitura; o Salvar
     * ali gravaria o agente inteiro sem que nada na tela tivesse mudado — botão
     * que faz algo diferente do que a tela sugere. Voz mantém o Salvar: é
     * configuração do agente como as guias de Treinamento, e é a mesma gravação.
     */
    const guiaGrava = secaoDaGuia === 'personalidade' || secaoDaGuia === 'voz'

    const dicaDoRodape =
        secaoDaGuia === 'ensaio'
            ? 'A conversa de ensaio não é gravada nem cobra crédito do agente no ar.'
            : secaoDaGuia === 'lacunas'
              ? 'O que o agente não soube responder. Responder aqui vira documento de treinamento.'
              : secaoDaGuia === 'voz'
                ? 'Grava o agente com a configuração de fala.'
                : 'Grava o agente com o que está nas guias de Treinamento.'

    return (
        <AgentFrame
            secao={secaoDaGuia}
            dica={dicaDoRodape}
            /* Sem Salvar para quem não administra: a API recusa, e um botão
               que só sabe recusar é pior que a sua ausência. */
            acoes={canManage && guiaGrava ? (
                <div className="flex items-center gap-2">
                    {/**
                     * **Publicar é outro botão, e tem de ser.**
                     *
                     * Salvar grava rascunho: o agente continua respondendo pelo
                     * texto anterior até alguém publicar. É o que torna possível
                     * medir antes de publicar — sem dois estados não há o que
                     * comparar — e é onde o embedding do acervo é pago, uma vez.
                     *
                     * Aparece **só quando há pendência**. Um botão Publicar sempre
                     * aceso convidaria a publicar o nada, e a rota recusaria com
                     * "nada para publicar": botão que só sabe recusar é pior que a
                     * sua ausência, o mesmo critério que já vale para o Salvar.
                     *
                     * **Pendência tem dois motivos, e o rótulo muda com eles.**
                     * Sem rascunho nenhum, o acervo ainda pode estar atrasado:
                     * quando muda o código que decide o que vai para ele, todo
                     * documento já indexado fica obsoleto sem ninguém ter
                     * editado nada. Era o estado em que não havia botão — a tela
                     * mostrava os números divergindo e não oferecia saída, e o
                     * conserto saiu por SQL à mão. Mesma rota, outro nome: aqui
                     * não se publica texto, se recorta o que já está no ar.
                     */}
                    {pendentes.length + desatualizados.length > 0 ? (
                        <Button
                            onClick={async () => {
                                const id = agentIdRef.current
                                if (id) await publicar(id)
                            }}
                            size="sm"
                            variant="outline"
                            className="h-8"
                            disabled={publicando || isSaving || loading}
                            title={
                                pendentes.length > 0 && desatualizados.length > 0
                                    ? `Publica o rascunho e reindexa ${desatualizados.length} documento(s) com acervo atrasado`
                                    : undefined
                            }
                        >
                            {publicando ? <Loader2 className="size-4 animate-spin" /> : null}
                            {publicando
                                ? pendentes.length > 0
                                    ? 'Publicando…'
                                    : 'Reindexando…'
                                : pendentes.length > 0
                                  ? `Publicar ${pendentes.length} ${pendentes.length === 1 ? 'mudança' : 'mudanças'}`
                                  : `Reindexar ${desatualizados.length} ${desatualizados.length === 1 ? 'documento' : 'documentos'}`}
                        </Button>
                    ) : (
                        <span className="text-xs text-muted-foreground">
                            {versao === 0 ? 'nunca publicado' : `versão ${versao} no ar`}
                        </span>
                    )}
                    <Button onClick={handleSave} size="sm" className="h-8" disabled={isSaving || loading}>
                        {isSaving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                        {isSaving ? 'Salvando…' : 'Salvar agente'}
                    </Button>
                </div>
            ) : null}
        >
            {loading ? <EsperaDoFormulario /> : (
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
