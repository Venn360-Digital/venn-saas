'use client'

import { useState } from 'react'
import { ChevronDown, FileText, Globe, Upload, X } from 'lucide-react'
import { Button } from '@venn/ui/button'
import { Input } from '@venn/ui/input'
import { cn } from '@venn/ui/utils'
import { toast } from 'sonner'

import { CerebroData, KnowledgeFile, KnowledgeWebsite } from '@/types/agent-creation'

interface CerebroTabProps {
    data: CerebroData
    onChange: (data: Partial<CerebroData>) => void
    /**
     * Necessário para remover o que já está indexado: apagar só do estado da
     * tela deixaria a fonte no banco, e o agente seguiria respondendo com o que
     * a clínica acabou de tirar da lista.
     */
    agentId?: string | null
    /**
     * Se quem olha pode mudar o que o agente sabe.
     *
     * O cérebro é a parte mais destrutiva da tela: remover uma fonte apaga os
     * vetores dela e o agente passa a responder sem aquilo. Quem não administra
     * lê a lista de fontes e não vê nenhum controle que a altere.
     */
    canManage?: boolean
}

interface ExpandableSectionProps {
    title: string
    description: string
    icon: React.ReactNode
    children: React.ReactNode
    defaultExpanded?: boolean
}

function ExpandableSection({ title, description, icon, children, defaultExpanded = false }: ExpandableSectionProps) {
    const [isExpanded, setIsExpanded] = useState(defaultExpanded)

    return (
        <div className="rounded-lg border">
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="flex w-full items-center justify-between p-4 text-left transition-colors hover:bg-muted/50"
            >
                <div className="flex items-center gap-3">
                    <div className="text-muted-foreground">{icon}</div>
                    <div>
                        <h3 className="font-medium">{title}</h3>
                        <p className="text-[12.5px] text-muted-foreground">{description}</p>
                    </div>
                </div>
                <ChevronDown
                    className={cn(
                        'h-5 w-5 text-muted-foreground transition-transform',
                        isExpanded && 'rotate-180'
                    )}
                />
            </button>
            {isExpanded && <div className="border-t p-4">{children}</div>}
        </div>
    )
}

/**
 * O par (título, tipo) que identifica a fonte no banco — a mesma chave que o
 * indexador usa para substituir uma fonte reenviada. Devolve null quando o item
 * ainda não foi gravado, e aí não há nada para apagar lá.
 */
function findPersistedSource(
    data: CerebroData,
    kind: 'files' | 'websites' | 'videos' | 'faqs',
    id: string
): { title: string; type: string } | null {
    switch (kind) {
        case 'files': {
            const file = data.files.find((f) => f.id === id)
            return file?.persisted ? { title: file.filename, type: 'doc' } : null
        }
        case 'websites': {
            const site = data.websites.find((w) => w.id === id)
            return site?.persisted ? { title: site.title || site.url, type: 'website' } : null
        }
        case 'videos': {
            const video = data.videos.find((v) => v.id === id)
            return video?.persisted ? { title: video.title || video.url, type: 'video' } : null
        }
        case 'faqs': {
            const faq = data.faqs.find((f) => f.id === id)
            return faq?.persisted ? { title: faq.question, type: 'faq' } : null
        }
    }
}

export function CerebroTab({ data, onChange, agentId, canManage = true }: CerebroTabProps) {
    const [isUploading, setIsUploading] = useState(false)
    const [websiteUrl, setWebsiteUrl] = useState('')
    const [isReadingSite, setIsReadingSite] = useState(false)
    const [removing, setRemoving] = useState<string | null>(null)

    /**
     * Upload de verdade: o arquivo é lido e o texto fica com o agente.
     *
     * Antes o botão fingia — dois segundos de "enviando" e nada era guardado.
     * O arquivo em si não sobe para lugar nenhum: o que o agente consulta é o
     * texto, indexado em pedaços quando o agente é salvo.
     */
    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const chosen = Array.from(e.target.files ?? [])
        if (chosen.length === 0) return

        setIsUploading(true)
        const accepted: KnowledgeFile[] = []
        for (const file of chosen) {
            try {
                const form = new FormData()
                form.append('file', file)
                const res = await fetch('/api/agents/knowledge/extract', { method: 'POST', body: form })
                const payload = await res.json().catch(() => null)
                if (!res.ok) {
                    toast.error(`${file.name}: ${payload?.error ?? 'não foi possível ler o arquivo.'}`)
                    continue
                }
                accepted.push({
                    id: `${Date.now()}-${file.name}`,
                    filename: payload.filename,
                    size: payload.size,
                    type: file.type || 'text/plain',
                    uploadedAt: new Date(),
                    content: payload.content,
                    chars: payload.chars,
                    truncated: payload.truncated,
                })
                if (payload.truncated) {
                    toast.warning(`${file.name}: muito longo — indexamos o começo do documento.`)
                }
            } catch {
                toast.error(`${file.name}: não foi possível ler o arquivo.`)
            }
        }
        if (accepted.length > 0) {
            onChange({ files: [...data.files, ...accepted] })
            toast.success(`${accepted.length} arquivo(s) lido(s)`)
        }
        // Sem isto, escolher o mesmo arquivo de novo não dispara `change`.
        e.target.value = ''
        setIsUploading(false)
    }

    /**
     * A página é lida na hora de acrescentar, não no salvar.
     *
     * Antes, acrescentar um site guardava a URL e nada mais: a página nunca era
     * lida, e a clínica ficava convencida de que o agente conhecia o site — que
     * é justamente onde estão serviços e preços. Lendo aqui, a tela mostra
     * quantos caracteres entraram antes de gravar, e um site que não dá texto
     * (carrossel de imagens, conteúdo por script) diz isso na hora.
     */
    /**
     * Vários endereços de uma vez, separados por ponto e vírgula.
     *
     * Pedido do Andre para o cadastro em massa: implantar uma clínica é colar a
     * lista de páginas que ela já tem — serviços, preços, convênios, sobre —, e
     * uma por vez são quatro idas ao campo com uma espera de leitura em cada.
     *
     * O separador é `;` e não vírgula porque **URL tem vírgula**: um link de
     * mapa ou de busca a carrega no meio, e partir por vírgula quebraria o
     * endereço ao meio sem a pessoa entender por quê.
     *
     * As páginas são lidas **em sequência, não em paralelo**. A rota de leitura
     * busca a página inteira e a converte em texto; cinco buscas simultâneas
     * partindo do mesmo Worker é o tipo de rajada que o site de destino lê como
     * ataque, e algumas hospedagens respondem com bloqueio. Em sequência é mais
     * lento e é o certo.
     *
     * O resultado é contado por lote: a mensagem diz quantas entraram, e cada
     * falha é dita com o endereço dela — num lote de cinco, "não foi possível
     * ler a página" sem dizer qual não serve para nada.
     */
    const handleAddWebsite = async () => {
        if (isReadingSite) return

        const enderecos = websiteUrl
            .split(';')
            .map((u) => u.trim())
            .filter(Boolean)
            .map((u) => (/^https?:\/\//i.test(u) ? u : `https://${u}`))

        if (enderecos.length === 0) return

        // Repetido dentro do próprio lote conta como repetido.
        const vistos = new Set(data.websites.map((site) => site.url))
        const novos: KnowledgeWebsite[] = []
        const falhas: string[] = []
        let repetidos = 0

        setIsReadingSite(true)
        try {
            for (const endereco of enderecos) {
                if (vistos.has(endereco)) {
                    repetidos++
                    continue
                }
                vistos.add(endereco)

                try {
                    const res = await fetch('/api/agents/knowledge/fetch-url', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ url: endereco }),
                    })
                    const payload = await res.json().catch(() => null)

                    if (!res.ok) {
                        falhas.push(payload?.error ? `${endereco}: ${payload.error}` : endereco)
                        continue
                    }

                    novos.push({
                        id: `${Date.now()}-${endereco}`,
                        url: payload.url,
                        title: payload.title,
                        addedAt: new Date(),
                        content: payload.content,
                        chars: payload.chars,
                        truncated: payload.truncated,
                    })
                } catch {
                    falhas.push(endereco)
                }
            }

            if (novos.length > 0) {
                onChange({ websites: [...data.websites, ...novos] })
                const caracteres = novos.reduce((soma, w) => soma + (w.chars ?? 0), 0)
                toast.success(
                    novos.length === 1
                        ? `Lemos ${caracteres.toLocaleString('pt-BR')} caracteres da página`
                        : `${novos.length} páginas lidas — ${caracteres.toLocaleString('pt-BR')} caracteres`
                )
                if (novos.some((w) => w.truncated)) {
                    toast.warning('Alguma página era muito longa — indexamos o começo dela.')
                }
            }

            if (repetidos > 0) {
                toast.error(
                    repetidos === 1
                        ? 'Um endereço já estava na lista.'
                        : `${repetidos} endereços já estavam na lista.`
                )
            }

            for (const falha of falhas) toast.error(`Não foi possível ler ${falha}`)

            // O campo só esvazia se **tudo** entrou: com falha, o que a pessoa
            // colou continua lá para ela corrigir o endereço errado em vez de
            // redigitar a lista.
            if (falhas.length === 0) setWebsiteUrl('')
        } finally {
            setIsReadingSite(false)
        }
    }

    /**
     * Remove da tela e, quando a fonte já está indexada, também do cérebro.
     *
     * Um item carregado da base (`persisted`) vive em trechos no banco. Tirá-lo
     * só do estado local faria a lista mentir: o agente continuaria encontrando
     * o texto na próxima pergunta. A rota apaga a fonte inteira — todos os
     * trechos daquele título — e não um pedaço dela.
     */
    const handleRemoveItem = async (
        kind: 'files' | 'websites' | 'videos' | 'faqs',
        id: string
    ) => {
        const persistedSource = findPersistedSource(data, kind, id)

        if (persistedSource && agentId) {
            setRemoving(id)
            try {
                const query = new URLSearchParams({
                    title: persistedSource.title,
                    type: persistedSource.type,
                })
                const res = await fetch(`/api/agents/${agentId}/knowledge?${query}`, {
                    method: 'DELETE',
                })
                if (!res.ok) {
                    toast.error('Não foi possível remover do cérebro do agente.')
                    return
                }
            } catch {
                toast.error('Não foi possível remover do cérebro do agente.')
                return
            } finally {
                setRemoving(null)
            }
        }

        switch (kind) {
            case 'files':
                return onChange({ files: data.files.filter((f) => f.id !== id) })
            case 'websites':
                return onChange({ websites: data.websites.filter((w) => w.id !== id) })
            case 'videos':
                return onChange({ videos: data.videos.filter((v) => v.id !== id) })
            case 'faqs':
                return onChange({ faqs: data.faqs.filter((f) => f.id !== id) })
        }
    }

    return (
        <div className="space-y-6">
            <div>
                <p className="text-[12.5px] text-muted-foreground">
                    Adicione informações que seu agente deve conhecer
                </p>
            </div>

            <div className="space-y-4">
                {/* Arquivos */}
                <ExpandableSection
                    title="Arquivos"
                    description="Adicione informações através de arquivos"
                    icon={<FileText className="h-5 w-5" />}
                    defaultExpanded
                >
                    <div className="space-y-4">
                        {canManage ? (
                        <div className="flex items-center justify-center rounded-lg border-2 border-dashed p-8">
                            <label className="cursor-pointer text-center">
                                <Upload className="mx-auto h-8 w-8 text-muted-foreground" />
                                <p className="mt-2 text-sm font-medium">
                                    Clique para fazer upload
                                </p>
                                <p className="text-xs text-muted-foreground">
                                    PDF, DOCX, TXT, MD ou CSV — até 10 MB
                                </p>
                                <input
                                    type="file"
                                    className="hidden"
                                    multiple
                                    accept=".pdf,.docx,.txt,.md,.markdown,.csv,.json"
                                    onChange={handleFileUpload}
                                    disabled={isUploading}
                                />
                            </label>
                        </div>
                        ) : null}

                        {data.files.length > 0 && (
                            <div className="space-y-2">
                                {data.files.map((file) => (
                                    <div
                                        key={file.id}
                                        className="flex items-center justify-between rounded-md border p-3"
                                    >
                                        <div className="flex min-w-0 items-center gap-2">
                                            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                                            <span className="truncate text-sm">{file.filename}</span>
                                            <span className="num shrink-0 text-xs text-muted-foreground">
                                                {file.chars.toLocaleString('pt-BR')} caracteres
                                                {file.truncated ? ' (cortado)' : ''}
                                            </span>
                                        </div>
                                        {canManage ? (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                disabled={removing === file.id}
                                                onClick={() => void handleRemoveItem('files', file.id)}
                                            >
                                                <X className="h-4 w-4" />
                                            </Button>
                                        ) : null}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </ExpandableSection>

                {/* Websites */}
                <ExpandableSection
                    title="Websites"
                    description="O Agente lê o conteúdo das páginas que você adicionar"
                    icon={<Globe className="h-5 w-5" />}
                >
                    <div className="space-y-4">
                        {canManage ? (
                        <div className="space-y-2">
                            <div className="flex gap-2">
                                <Input
                                    placeholder="https://exemplo.com; https://exemplo.com/precos"
                                    value={websiteUrl}
                                    onChange={(e) => setWebsiteUrl(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            e.preventDefault()
                                            void handleAddWebsite()
                                        }
                                    }}
                                    disabled={isReadingSite}
                                />
                                <Button onClick={() => void handleAddWebsite()} disabled={isReadingSite}>
                                    {isReadingSite ? 'Lendo…' : 'Adicionar'}
                                </Button>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Lemos o texto de cada página informada, sem percorrer o site
                                inteiro. Para várias de uma vez, separe por{' '}
                                <strong className="font-semibold text-foreground">;</strong> — é
                                ponto e vírgula porque endereço costuma ter vírgula no meio.
                            </p>
                        </div>
                        ) : null}

                        {data.websites.length > 0 && (
                            <div className="space-y-2">
                                {data.websites.map((website) => (
                                    <div
                                        key={website.id}
                                        className="flex items-center justify-between rounded-md border p-3"
                                    >
                                        <div className="flex min-w-0 items-center gap-2">
                                            <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />
                                            <span className="truncate text-sm">{website.url}</span>
                                            {website.chars !== undefined && (
                                                <span className="num shrink-0 text-xs text-muted-foreground">
                                                    {website.chars.toLocaleString('pt-BR')} caracteres
                                                    {website.truncated ? ' (cortado)' : ''}
                                                </span>
                                            )}
                                        </div>
                                        {canManage ? (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                disabled={removing === website.id}
                                                onClick={() => void handleRemoveItem('websites', website.id)}
                                            >
                                                <X className="h-4 w-4" />
                                            </Button>
                                        ) : null}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </ExpandableSection>

                {/*
                  * **Youtube e Perguntas & Respostas saíram**, a pedido do
                  * Andre (2026-11-04).
                  *
                  * Youtube nunca funcionou: acrescentar um vídeo guardava a URL
                  * numa linha sem conteúdo e sem vetor, e a seção já estava
                  * reduzida a um aviso de "ainda não disponível". Uma seção que
                  * só sabe dizer que não faz nada ocupa espaço e levanta a
                  * pergunta toda vez que alguém abre o Cérebro.
                  *
                  * Perguntas & Respostas virou redundante: o catálogo de
                  * treinamento tem o documento FAQ, que é o mesmo conteúdo com
                  * rascunho, versão e indexação — duas portas para a mesma
                  * coisa, e só uma delas publica.
                  *
                  * **Nada foi apagado do banco.** `data.videos` e `data.faqs`
                  * continuam no tipo e no que já está indexado; o que saiu foi
                  * a porta de entrada. Remover os trechos é migração própria, e
                  * apagar conhecimento de clínica em nome de limpar uma tela
                  * seria a troca errada.
                  */}
            </div>
        </div>
    )
}
