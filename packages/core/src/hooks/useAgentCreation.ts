'use client'

import { useCallback, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { marcarSujo } from '../components/agents/creation/unsaved'
import {
    PerfilData, TrabalhoData, CerebroData, VozData, InstrucoesData, DocumentoGravado,
    PADROES_DO_AGENTE, MODELOS_DE_TEXTO,
} from '../types/agent-creation'
import { ENTONACAO_PADRAO, VOZ_PADRAO } from '../lib/voz'
import { SETOR_PADRAO } from '../components/agents/creation/tabs/TrabalhoTab'
import { acharDocumento, DOCUMENTOS } from '../lib/treinamento/documentos'

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

    /**
     * Os sete documentos de treinamento, por slug.
     *
     * Começa com os sete presentes e vazios, não com um objeto em branco: a tela
     * desenha sete campos desde o primeiro acesso, e sete campos vazios são sete
     * coisas que o agente não sabe — que é a informação que se quer dar.
     */
    const [documentos, setDocumentos] = useState<Record<string, DocumentoGravado>>(() =>
        Object.fromEntries(
            DOCUMENTOS.map((doc) => [
                doc.slug,
                { content: '', indexedAt: null, indexedChunks: null, desatualizado: false },
            ])
        )
    )

    /**
     * A versão publicada e o que está pendente de publicação.
     *
     * Vivem aqui e não na tela porque quem fala com a rota de treinamento é este
     * hook: a tela que mostrasse pendência por conta própria divergiria do que o
     * servidor sabe no primeiro salvar que falhasse.
     *
     * Zero quer dizer "nunca publicou", e a tela tem de dizer isso em vez de
     * mostrar delta contra o vazio.
     */
    const [versao, setVersao] = useState(0)
    const [pendentes, setPendentes] = useState<string[]>([])

    /**
     * Os slugs cujo acervo está atrasado — **sem rascunho nenhum pendente**.
     *
     * Lista separada de `pendentes` porque os dois motivos para reindexar são
     * diferentes: rascunho é mudança de texto que alguém escreveu; atrasado é o
     * acervo que ficou para trás quando o código que decide o que vai para ele
     * mudou. Somar os dois numa lista só faria a tela dizer "publicar 3
     * mudanças" para duas edições e um documento que ninguém tocou.
     *
     * Quem calcula é o servidor: depende de `indexedHash`, que a tela não vê.
     */
    const [desatualizados, setDesatualizados] = useState<string[]>([])

    /**
     * Publica o que está em rascunho.
     *
     * **Salvar não publica, e esta é a diferença.** Salvar grava rascunho; o
     * agente continua respondendo pelo texto anterior até alguém apertar aqui. É
     * o que torna possível medir antes de publicar, que é o princípio 5 do
     * estudo — e é a razão de a indexação ter saído do salvar e vindo para cá.
     */
    const [publicando, setPublicando] = useState(false)

    const publicar = async (agentId: string) => {
        setPublicando(true)
        try {
            const res = await fetch(`/api/agents/${agentId}/training/publicar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            })
            const corpo = await res.json().catch(() => null)
            if (!res.ok) throw new Error(corpo?.error ?? String(res.status))

            setVersao(corpo.versao)
            setPendentes([])
            /**
             * Limpa junto, otimista, pelo mesmo critério de `pendentes`: o job
             * de indexação já está na fila. O carimbo no banco só muda quando o
             * processador roda, e manter o aviso aceso até lá faria a tela
             * oferecer reindexar o que acabou de ser enfileirado.
             */
            setDesatualizados([])
            /* E o aviso por documento junto, senão o botão sai e a frase
               "o acervo deste documento está atrasado" fica acesa até alguém
               recarregar a tela. */
            setDocumentos((atual) =>
                Object.fromEntries(
                    Object.entries(atual).map(([slug, doc]) => [slug, { ...doc, desatualizado: false }])
                )
            )
            toast.success(
                // Sem texto novo, não houve publicação: dizer "versão publicada"
                // seria anunciar uma versão que a rota não criou.
                corpo.mudaram?.length === 0
                    ? 'Acervo em reindexação.'
                    : corpo.enfileirados?.length > 0
                      ? `Versão ${corpo.versao} publicada. O acervo está sendo reindexado.`
                      : `Versão ${corpo.versao} publicada.`
            )
            return true
        } catch (erro) {
            console.error('[TREINAMENTO] publicar', erro)
            toast.error(erro instanceof Error ? erro.message : 'Não foi possível publicar.')
            return false
        } finally {
            setPublicando(false)
        }
    }

    /**
     * O que veio do banco, para saber o que mudou.
     *
     * `useRef` e não estado: ninguém renderiza por causa disto, e em estado ele
     * entraria nas dependências de quem grava e disparia o laço de atualização.
     */
    const originais = useRef<Record<string, string>>({})

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

            await salvarDocumentos(agent.id)

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

    /**
     * Carrega os sete documentos do agente.
     *
     * A rota devolve sempre os sete — o catálogo inteiro, com conteúdo vazio no
     * que não foi escrito —, então a tela não precisa reconciliar ausência.
     */
    const carregarDocumentos = useCallback(async (agentId: string) => {
        try {
            const res = await fetch(`/api/agents/${agentId}/training`)
            if (!res.ok) throw new Error(String(res.status))
            /**
             * A rota devolve objeto, não array, desde o passo 4.
             *
             * Além dos documentos vêm a **versão publicada** e quais slugs têm
             * rascunho pendente — a tela precisa dos dois na mesma renderização
             * para poder oferecer Publicar e dizer o que vai junto.
             *
             * `content` é o rascunho quando há rascunho: é o que a tela edita. O
             * que está no ar vem em `publicado`, e é a diferença entre os dois que
             * o aviso de pendência mostra.
             */
            const corpo: {
                versao: number
                pendentes: string[]
                desatualizados: string[]
                docs: Array<{
                    slug: string
                    content: string
                    publicado: string
                    temRascunho: boolean
                    indexedAt: string | null
                    indexedChunks: number | null
                    desatualizado: boolean
                }>
            } = await res.json()

            const porSlug: Record<string, DocumentoGravado> = {}
            for (const item of corpo.docs) {
                porSlug[item.slug] = {
                    content: item.content,
                    indexedAt: item.indexedAt,
                    indexedChunks: item.indexedChunks,
                    desatualizado: item.desatualizado,
                }
                originais.current[item.slug] = item.content
            }
            setDocumentos((atual) => ({ ...atual, ...porSlug }))
            setVersao(corpo.versao)
            setPendentes(corpo.pendentes)
            setDesatualizados(corpo.desatualizados ?? [])
        } catch (erro) {
            console.error('[TREINAMENTO] carregar', erro)
            toast.error('Não foi possível carregar os documentos de treinamento')
        }
    }, [])

    /**
     * Grava os documentos de treinamento que mudaram.
     *
     * **Aqui, e não na tela**, pelo mesmo motivo da base de conhecimento: é
     * depois desta linha que o agente tem id. Num agente novo, o que foi escrito
     * nos sete campos se perderia se a gravação dependesse de um id que ainda
     * não existe.
     *
     * **Só o que mudou vai.** `originais` guarda o que veio do banco; comparar
     * evita sete requisições a cada salvar, e a rota ainda confere o hash antes
     * de gastar embedding — duas guardas, porque esta aqui não sobrevive a um
     * recarregamento e a de lá sim.
     *
     * Falha de um documento não impede os outros nem desfaz o agente salvo: o
     * aviso diz quais ficaram de fora, e o resto do trabalho fica de pé.
     */
    const salvarDocumentos = async (agentId: string) => {
        const mudaram = Object.entries(documentos).filter(
            ([slug, doc]) => doc.content !== (originais.current[slug] ?? '')
        )
        if (mudaram.length === 0) return

        const falharam: string[] = []

        for (const [slug, doc] of mudaram) {
            try {
                const res = await fetch(`/api/agents/${agentId}/training/${slug}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ content: doc.content }),
                })
                if (!res.ok) {
                    const corpo = await res.json().catch(() => null)
                    throw new Error(corpo?.error ?? String(res.status))
                }
                originais.current[slug] = doc.content
                /**
                 * Pendência marcada aqui, com o que o servidor acabou de
                 * confirmar.
                 *
                 * O `rascunho: false` da rota quer dizer "o que você salvou é
                 * igual ao que está no ar" — acontece quando alguém desfaz uma
                 * edição à mão. Nesse caso o slug **sai** da lista, senão a tela
                 * diria "há mudanças para publicar" e o Publicar recusaria com
                 * "nada para publicar".
                 */
                const corpo = await res.clone().json().catch(() => null)
                setPendentes((atual) =>
                    corpo?.rascunho === false
                        ? atual.filter((s) => s !== slug)
                        : atual.includes(slug)
                          ? atual
                          : [...atual, slug]
                )
            } catch (erro) {
                falharam.push(acharDocumento(slug)?.titulo ?? slug)
                console.error(`[TREINAMENTO] ${slug}`, erro)
            }
        }

        if (falharam.length > 0) {
            toast.error(`Não foi possível gravar: ${falharam.join(', ')}`)
        }
    }

    return {
        documentos,
        setDocumentos,
        carregarDocumentos,
        versao,
        pendentes,
        desatualizados,
        publicar,
        publicando,
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
