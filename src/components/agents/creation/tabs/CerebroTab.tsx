'use client'

import { useState } from 'react'
import { ChevronDown, FileText, Globe, Video, HelpCircle, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

import { CerebroData, KnowledgeFile, KnowledgeWebsite, KnowledgeVideo, KnowledgeFAQ } from '@/types/agent-creation'

interface CerebroTabProps {
    data: CerebroData
    onChange: (data: Partial<CerebroData>) => void
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
                        <p className="text-sm text-muted-foreground">{description}</p>
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

export function CerebroTab({ data, onChange }: CerebroTabProps) {
    const [isUploading, setIsUploading] = useState(false)
    const [websiteUrl, setWebsiteUrl] = useState('')
    const [videoUrl, setVideoUrl] = useState('')
    const [newFaq, setNewFaq] = useState({ question: '', answer: '' })

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

    const handleAddWebsite = () => {
        if (!websiteUrl) return
        const newWebsite: KnowledgeWebsite = {
            id: Date.now().toString(),
            url: websiteUrl,
            addedAt: new Date(),
        }
        onChange({ websites: [...data.websites, newWebsite] })
        setWebsiteUrl('')
    }

    const handleAddVideo = () => {
        if (!videoUrl) return
        const newVideo: KnowledgeVideo = {
            id: Date.now().toString(),
            url: videoUrl,
            platform: 'youtube',
            addedAt: new Date(),
        }
        onChange({ videos: [...data.videos, newVideo] })
        setVideoUrl('')
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

    const handleRemoveItem = (type: keyof CerebroData, id: string) => {
        switch (type) {
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
                <h2 className="text-2xl font-bold">Base de Conhecimento</h2>
                <p className="text-sm text-muted-foreground mt-1">
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
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleRemoveItem('files', file.id)}
                                        >
                                            <X className="h-4 w-4" />
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </ExpandableSection>

                {/* Websites */}
                <ExpandableSection
                    title="Websites"
                    description="Adicione informações através de sites"
                    icon={<Globe className="h-5 w-5" />}
                >
                    <div className="space-y-4">
                        <div className="flex gap-2">
                            <Input
                                placeholder="https://exemplo.com"
                                value={websiteUrl}
                                onChange={(e) => setWebsiteUrl(e.target.value)}
                            />
                            <Button onClick={handleAddWebsite}>Adicionar</Button>
                        </div>

                        {data.websites.length > 0 && (
                            <div className="space-y-2">
                                {data.websites.map((website) => (
                                    <div
                                        key={website.id}
                                        className="flex items-center justify-between rounded-md border p-3"
                                    >
                                        <div className="flex items-center gap-2">
                                            <Globe className="h-4 w-4 text-muted-foreground" />
                                            <span className="text-sm">{website.url}</span>
                                        </div>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleRemoveItem('websites', website.id)}
                                        >
                                            <X className="h-4 w-4" />
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </ExpandableSection>

                {/* Youtube [BETA] */}
                <ExpandableSection
                    title="Youtube [BETA]"
                    description="Treine o cérebro transcrevendo vídeos"
                    icon={<Video className="h-5 w-5" />}
                >
                    <div className="space-y-4">
                        <div className="flex gap-2">
                            <Input
                                placeholder="https://youtube.com/watch?v=..."
                                value={videoUrl}
                                onChange={(e) => setVideoUrl(e.target.value)}
                            />
                            <Button onClick={handleAddVideo}>Adicionar</Button>
                        </div>

                        {data.videos.length > 0 && (
                            <div className="space-y-2">
                                {data.videos.map((video) => (
                                    <div
                                        key={video.id}
                                        className="flex items-center justify-between rounded-md border p-3"
                                    >
                                        <div className="flex items-center gap-2">
                                            <Video className="h-4 w-4 text-muted-foreground" />
                                            <span className="text-sm">{video.url}</span>
                                        </div>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleRemoveItem('videos', video.id)}
                                        >
                                            <X className="h-4 w-4" />
                                        </Button>
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

                        {data.faqs.length > 0 && (
                            <div className="space-y-2">
                                {data.faqs.map((faq) => (
                                    <div key={faq.id} className="rounded-md border p-3">
                                        <div className="flex items-start justify-between">
                                            <div className="flex-1">
                                                <p className="font-medium text-sm">{faq.question}</p>
                                                <p className="text-sm text-muted-foreground mt-1">
                                                    {faq.answer}
                                                </p>
                                            </div>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => handleRemoveItem('faqs', faq.id)}
                                            >
                                                <X className="h-4 w-4" />
                                            </Button>
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
