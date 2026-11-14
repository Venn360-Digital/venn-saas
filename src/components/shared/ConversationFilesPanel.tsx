'use client'

import { useEffect, useState } from 'react'
import { FileText, Film, ImageIcon, Loader2, Mic, Paperclip } from 'lucide-react'

import { cn } from '@venn/ui/utils'

interface MediaMessage {
    id: string
    direction: string
    content: string
    contentType: string
    mediaUrl: string
    createdAt: string
}

/** Ícone por tipo, para que uma lista de arquivos se leia de relance. */
function iconFor(contentType: string) {
    if (contentType === 'image') return ImageIcon
    if (contentType === 'audio') return Mic
    if (contentType === 'video') return Film
    return FileText
}

/** O nome do arquivo quando a mensagem não trouxe legenda. */
function nameOf(msg: MediaMessage): string {
    if (msg.content?.trim()) return msg.content.trim()
    try {
        const path = new URL(msg.mediaUrl, 'http://local').pathname
        return decodeURIComponent(path.split('/').pop() || 'Arquivo')
    } catch {
        return 'Arquivo'
    }
}

/**
 * Os arquivos desta conversa, todos, num lugar.
 *
 * O exame que o paciente mandou em março está no fio da conversa — a duzentas
 * mensagens de distância. Encontrá-lo era rolar até achar, e na prática era
 * pedir ao paciente que mandasse de novo. A rota filtra por mídia no banco, de
 * modo que este painel vê a conversa inteira, não as últimas trinta mensagens
 * que a tela carregou.
 */
export function ConversationFilesPanel({ conversationId }: { conversationId: string }) {
    const [files, setFiles] = useState<MediaMessage[] | null>(null)

    useEffect(() => {
        let cancelled = false
        fetch(`/api/conversations/${conversationId}/media`)
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => {
                if (!cancelled) setFiles(data?.files ?? [])
            })
            .catch(() => {
                if (!cancelled) setFiles([])
            })
        return () => {
            cancelled = true
        }
    }, [conversationId])

    if (files === null) {
        return (
            <p className="flex items-center gap-2 px-1 py-4 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                Carregando arquivos…
            </p>
        )
    }

    if (files.length === 0) {
        return (
            <div className="rounded-md border border-dashed border-border px-3 py-6 text-center">
                <Paperclip className="mx-auto mb-2 size-5 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">
                    Nenhum arquivo trocado nesta conversa.
                </p>
            </div>
        )
    }

    return (
        <div className="space-y-1">
            <p className="num px-1 pb-1 text-xs text-muted-foreground">
                {files.length} {files.length === 1 ? 'arquivo' : 'arquivos'}
            </p>
            {files.map((file) => {
                const Icon = iconFor(file.contentType)
                const sent = file.direction === 'outbound'
                return (
                    <a
                        key={file.id}
                        href={file.mediaUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 rounded-md px-1.5 py-1.5 transition-colors hover:bg-muted/60"
                    >
                        {/* A miniatura é a identificação: num painel de exames,
                            doze linhas iguais chamadas "Arquivo" não ajudam. */}
                        {file.contentType === 'image' ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                                src={file.mediaUrl}
                                alt={nameOf(file)}
                                className="size-9 shrink-0 rounded border border-border object-cover"
                                loading="lazy"
                            />
                        ) : (
                            <span className="flex size-9 shrink-0 items-center justify-center rounded border border-border bg-muted">
                                <Icon className="size-4 text-muted-foreground" />
                            </span>
                        )}
                        <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-medium">{nameOf(file)}</span>
                            <span className={cn('num block text-[11px]', sent ? 'text-primary' : 'text-muted-foreground')}>
                                {sent ? 'Enviado' : 'Recebido'} ·{' '}
                                {new Date(file.createdAt).toLocaleDateString('pt-BR', {
                                    day: '2-digit',
                                    month: '2-digit',
                                    year: '2-digit',
                                })}
                            </span>
                        </span>
                    </a>
                )
            })}
        </div>
    )
}
