'use client'

import { useState } from 'react'
import { ChevronDown, FileText, Globe, Video, HelpCircle, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

import { CerebroData, KnowledgeFile, KnowledgeWebsite, KnowledgeFAQ } from '@/types/agent-creation'

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
    const [newFaq, setNewFaq] = useState({ question: '', answer: '' })
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
    const handleAddWebsite = async () => {
        const url = websiteUrl.trim()
        if (!url || isReadingSite) return

        const withProtocol = /^https?:\/\//i.test(url) ? url : `https://${url}`

        if (data.websites.some((site) => site.url === withProtocol)) {
            toast.error('Esse endereço já está na lista.')
            return
        }

        setIsReadingSite(true)
        try {
            const res = await fetch('/api/agents/knowledge/fetch-url', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: withProtocol }),
            })
            const payload = await res.json().catch(() => null)

            if (!res.ok) {
                toast.error(payload?.error ?? 'Não foi possível ler a página.')
                return
            }

            const newWebsite: KnowledgeWebsite = {
                id: `${Date.now()}-${withProtocol}`,
                url: payload.url,
                title: payload.title,
                addedAt: new Date(),
                content: payload.content,
                chars: payload.chars,
                truncated: payload.truncated,
            }

            onChange({ websites: [...data.websites, newWebsite] })
            setWebsiteUrl('')

            if (payload.truncated) {
                toast.warning('Página muito longa — indexamos o começo dela.')
            } else {
                toast.success(`Lemos ${payload.chars.toLocaleString('pt-BR')} caracteres da página`)
            }
        } catch {
            toast.error('Não foi possível ler a página.')
        } finally {
            setIsReadingSite(false)
        }
    }

    const handleAddFaq = () => {
        if (!newFaq.question || !newFaq.answer) return
        const faq: KnowledgeFAQ = {
            id: Date.now().toString(),
            ...newFaq,
        }
        onChange({ faqs: [...data.faqs, faq] })
        setNewFaq({ question: '', answer: '' })
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
                <h2 className="text-[15px] font-bold">Base de Conhecimento</h2>
                <p className="mt-0.5 text-[12.5px] text-muted-foreground">
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
                                    placeholder="https://exemplo.com"
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
                                Lemos o texto da página informada — uma página por vez, sem
                                percorrer o site inteiro. Para vários endereços, adicione um a um.
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
                  * YouTube: a seção diz o que é, em vez de aceitar e esquecer.
                  *
                  * Antes, acrescentar um vídeo guardava a URL numa linha sem
                  * conteúdo e sem vetor — o vídeo aparecia na lista e o agente
                  * nunca soube nada dele. Transcrever vídeo exige buscar a
                  * legenda do YouTube, que não tem rota pública estável, ou
                  * baixar o áudio e transcrever; é trabalho próprio, não um
                  * campo de texto. Até lá, o campo não finge.
                  *
                  * Um vídeo já cadastrado por uma versão anterior continua
                  * listado, com o aviso, para a clínica poder removê-lo.
                  */}
                <ExpandableSection
                    title="Youtube"
                    description="Em breve: transcrição de vídeos para o cérebro"
                    icon={<Video className="h-5 w-5" />}
                >
                    <div className="space-y-4">
                        <div className="rounded-md border border-dashed p-4">
                            <p className="text-sm font-medium">Ainda não disponível</p>
                            <p className="mt-1 text-sm text-muted-foreground">
                                A transcrição de vídeos do YouTube está em desenvolvimento.
                                Enquanto isso, o jeito de ensinar esse conteúdo ao Agente é
                                colar os pontos principais numa pergunta e resposta, ou
                                enviar um arquivo com o texto.
                            </p>
                        </div>

                        {data.videos.length > 0 && (
                            <div className="space-y-2">
                                <p className="text-xs text-muted-foreground">
                                    Vídeos cadastrados antes desta mudança. Eles não são
                                    consultados pelo Agente.
                                </p>
                                {data.videos.map((video) => (
                                    <div
                                        key={video.id}
                                        className="flex items-center justify-between rounded-md border p-3"
                                    >
                                        <div className="flex min-w-0 items-center gap-2">
                                            <Video className="h-4 w-4 shrink-0 text-muted-foreground" />
                                            <span className="truncate text-sm">{video.url}</span>
                                        </div>
                                        {canManage ? (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                disabled={removing === video.id}
                                                onClick={() => void handleRemoveItem('videos', video.id)}
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

                {/* Perguntas & Respostas */}
                <ExpandableSection
                    title="Perguntas & Respostas"
                    description="Determine perguntas e respostas padronizadas"
                    icon={<HelpCircle className="h-5 w-5" />}
                >
                    <div className="space-y-4">
                        {canManage ? (
                        <div className="space-y-3">
                            <div>
                                <Label htmlFor="question">Pergunta</Label>
                                <Input
                                    id="question"
                                    placeholder="Digite a pergunta..."
                                    value={newFaq.question}
                                    onChange={(e) => setNewFaq({ ...newFaq, question: e.target.value })}
                                />
                            </div>
                            <div>
                                <Label htmlFor="answer">Resposta</Label>
                                <Textarea
                                    id="answer"
                                    placeholder="Digite a resposta..."
                                    value={newFaq.answer}
                                    onChange={(e) => setNewFaq({ ...newFaq, answer: e.target.value })}
                                    className="min-h-[80px]"
                                />
                            </div>
                            <Button onClick={handleAddFaq} className="w-full">
                                Adicionar FAQ
                            </Button>
                        </div>
                        ) : null}

                        {data.faqs.length > 0 && (
                            <div className="space-y-2">
                                {data.faqs.map((faq) => (
                                    <div key={faq.id} className="rounded-md border p-3">
                                        <div className="flex items-start justify-between">
                                            <div className="flex-1">
                                                <p className="font-medium text-sm">{faq.question}</p>
                                                <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                                                    {faq.answer}
                                                </p>
                                            </div>
                                            {canManage ? (
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    disabled={removing === faq.id}
                                                    onClick={() => void handleRemoveItem('faqs', faq.id)}
                                                >
                                                    <X className="h-4 w-4" />
                                                </Button>
                                            ) : null}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </ExpandableSection>
            </div>
        </div>
    )
}
