'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
    ArrowLeft,
    Search,
    Bot,
    MessageSquare,
    Send,
    UserCheck,
    UserX,
    XCircle,
    RotateCcw,
    Phone,
    ArrowRightLeft,
    Image as ImageIcon,
    FileText,
    Music,
    Film,
    X,
    Users,
    Paperclip,
    Reply,
    Mic,
    Copy,
    Tag,
    StickyNote,
    Mail,
    PanelRight,
    Check,
    CheckCheck,
    Loader2,
    Trash2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { EmojiPicker } from '@/components/shared/EmojiPicker'
import { format, isToday, isYesterday } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { createClient } from '@/lib/supabase/client'
import {

    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog'


/**
 * O recorte de `messages` que os handlers de realtime leem.
 *
 * O Supabase entrega `payload.new` como um registro sem forma — ele não conhece
 * o schema. Declarar os campos usados mantém o resto do handler verificado, e
 * um `status` renomeado no banco vira erro de compilação aqui.
 */
interface RealtimeMessageRow {
    id?: string
    conversationId?: string
    status?: string
    direction?: string
}

/** Corpo do POST de mensagem; os dois últimos campos são condicionais. */
interface SendMessageBody {
    content: string
    replyToId?: string
    isInternal?: boolean
}

type Tab = 'waiting' | 'active' | 'closed'

interface TagItem {
    id: string
    name: string
    color: string
}

interface ConversationListItem {
    id: string
    channel: string
    status: string
    assignedTo: string | null
    assignedToName: string | null
    assignedToAvatar: string | null
    contact: {
        id: string
        name: string | null
        phone: string | null
        avatar: string | null
    }
    agent: {
        id: string
        name: string
    } | null
    lastMessage: {
        id: string
        content: string
        direction: string
        sentBy: string | null
        createdAt: string
    } | null
    unreadCount: number
    tags: TagItem[]
    lastMessageAt: string | null
    createdAt: string
}

interface ReplyToMessage {
    id: string
    content: string
    direction: string
    contentType: string
    sentBy: string | null
}

interface Message {
    id: string
    content: string
    direction: string
    contentType: string
    mediaUrl: string | null
    sentBy: string | null
    senderName: string | null
    status: string
    createdAt: string
    replyToId: string | null
    replyTo: ReplyToMessage | null
    isInternal: boolean
    transcript?: string | null
    reaction?: string | null
}

interface ConversationDetail {
    conversation: {
        id: string
        channel: string
        status: string
        assignedTo: string | null
        assignedToName: string | null
        contact: {
            id: string
            name: string | null
            phone: string | null
            email: string | null
            avatar: string | null
            notes: string | null
            source: string | null
        }
        agent: {
            id: string
            name: string
            avatar: string | null
        } | null
        tags: TagItem[]
    }
    messages: Message[]
    hasMore?: boolean
    nextCursor?: string | null
}

// Delivery status checkmarks component
function MessageStatus({ status, direction }: { status: string; direction: string }) {
    if (direction === 'inbound') return null
    switch (status) {
        case 'sent':
            return <Check className="h-3 w-3 inline-block ml-1 opacity-60" />
        case 'delivered':
            return <CheckCheck className="h-3 w-3 inline-block ml-1 opacity-60" />
        case 'read':
            return <CheckCheck className="h-3 w-3 inline-block ml-1 text-blue-400" />
        case 'failed':
            return <span className="text-red-400 ml-1 text-[10px]">⚠️</span>
        default:
            return <Check className="h-3 w-3 inline-block ml-1 opacity-40" />
    }
}

interface QuickResponse {
    id: string
    command: string
    text: string
    isActive: boolean
}

function formatMessageTime(dateStr: string) {
    const date = new Date(dateStr)
    if (isToday(date)) {
        return format(date, 'HH:mm')
    }
    if (isYesterday(date)) {
        return 'Ontem'
    }
    return format(date, 'dd/MM', { locale: ptBR })
}

function getContactInitials(name: string | null, phone: string | null) {
    if (name) {
        return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()
    }
    if (phone) return phone.slice(-2)
    return '?'
}

function getSentByLabel(sentBy: string | null) {
    if (!sentBy) return ''
    if (sentBy === 'agent') return '🤖'
    if (sentBy === 'user') return ''
    return '👤'
}

function ContactAvatar({ avatar, name, phone, size = 'md' }: {
    avatar: string | null
    name: string | null
    phone: string | null
    size?: 'sm' | 'md'
}) {
    const sizeClasses = size === 'sm' ? 'w-8 h-8 text-xs' : 'w-10 h-10 text-sm'

    if (avatar) {
        return (
            <img
                src={avatar}
                alt={name || 'Contact'}
                className={cn('rounded-full object-cover flex-shrink-0', sizeClasses)}
                onError={(e) => {
                    // Fallback to initials on image load error
                    const target = e.target as HTMLImageElement
                    target.style.display = 'none'
                    const fallback = target.nextElementSibling as HTMLElement
                    if (fallback) fallback.style.display = 'flex'
                }}
            />
        )
    }

    return (
        <div className={cn(
            'rounded-full bg-primary/20 flex items-center justify-center font-medium text-primary flex-shrink-0',
            sizeClasses
        )}>
            {getContactInitials(name, phone)}
        </div>
    )
}

function MediaContent({ msg }: { msg: Message }) {
    if (msg.contentType === 'image' && msg.mediaUrl) {
        return (
            <div className="mb-1.5">
                <img
                    src={msg.mediaUrl}
                    alt="Imagem"
                    className="rounded-lg max-w-[240px] max-h-[200px] object-cover cursor-pointer"
                    onClick={() => window.open(msg.mediaUrl!, '_blank')}
                />
                {msg.content && msg.content !== '📷 Imagem' && (
                    <p className="whitespace-pre-wrap break-words mt-1">{msg.content}</p>
                )}
            </div>
        )
    }

    if (msg.contentType === 'audio' && msg.mediaUrl) {
        return (
            <div className="mb-1">
                <audio controls className="max-w-[240px]">
                    <source src={msg.mediaUrl} />
                </audio>
                {msg.transcript && (
                    <p className="mt-1.5 max-w-[240px] whitespace-pre-wrap break-words text-xs italic opacity-80">
                        {msg.transcript}
                    </p>
                )}
            </div>
        )
    }

    if (msg.contentType === 'video' && msg.mediaUrl) {
        return (
            <div className="mb-1.5">
                <video controls className="rounded-lg max-w-[240px] max-h-[200px]">
                    <source src={msg.mediaUrl} />
                </video>
                {msg.content && msg.content !== '🎬 Vídeo' && (
                    <p className="whitespace-pre-wrap break-words mt-1">{msg.content}</p>
                )}
            </div>
        )
    }

    if (msg.contentType === 'file' && msg.mediaUrl) {
        return (
            <div className="mb-1">
                <a
                    href={msg.mediaUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 bg-foreground/10 rounded-lg px-3 py-2 hover:bg-foreground/20 transition-colors"
                >
                    <FileText className="h-4 w-4" />
                    <span className="text-sm underline">{msg.content}</span>
                </a>
            </div>
        )
    }

    // Default text
    return <p className="whitespace-pre-wrap break-words">{msg.content}</p>
}

function mediaIcon(contentType: string) {
    switch (contentType) {
        case 'image': return <ImageIcon className="h-3 w-3 inline mr-0.5" />
        case 'audio': return <Music className="h-3 w-3 inline mr-0.5" />
        case 'video': return <Film className="h-3 w-3 inline mr-0.5" />
        case 'file': return <FileText className="h-3 w-3 inline mr-0.5" />
        default: return null
    }
}

export default function ConversasPage() {
    const [activeTab, setActiveTab] = useState<Tab>('waiting')
    const [searchQuery, setSearchQuery] = useState('')
    const [conversations, setConversations] = useState<ConversationListItem[]>([])
    const [selectedConversation, setSelectedConversation] = useState<string | null>(null)
    const [conversationDetail, setConversationDetail] = useState<ConversationDetail | null>(null)
    const [messages, setMessages] = useState<Message[]>([])
    const [messageInput, setMessageInput] = useState('')
    const [sending, setSending] = useState(false)
    const [loading, setLoading] = useState(true)
    const [canTransfer, setCanTransfer] = useState(false)
    const [onlyMine, setOnlyMine] = useState(false)
    const messagesEndRef = useRef<HTMLDivElement>(null)
    const messagesContainerRef = useRef<HTMLDivElement>(null)
    // Incrementa para derrubar e recriar o canal do Realtime depois de um erro.
    const [realtimeGeneration, setRealtimeGeneration] = useState(0)
    // Última mensagem conhecida da conversa aberta, para o polling detectar
    // atividade nova sem depender do evento.
    const trackedConversationRef = useRef<string | null>(null)
    const lastSeenMessageIdRef = useRef<string | null>(null)
    const pollRef = useRef<NodeJS.Timeout | null>(null)
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const prevTotalUnreadRef = useRef<number>(0)
    const soundEnabledRef = useRef<boolean>(true)
    const fileInputRef = useRef<HTMLInputElement>(null)

    // Typing indicator state
    const [contactTyping, setContactTyping] = useState(false)
    const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null)
    const operatorTypingRef = useRef(false)
    const operatorTypingTimeoutRef = useRef<NodeJS.Timeout | null>(null)

    // Pagination state
    const [hasMoreMessages, setHasMoreMessages] = useState(false)
    const [nextCursor, setNextCursor] = useState<string | null>(null)
    const [loadingMore, setLoadingMore] = useState(false)

    // Supabase realtime client
    const supabase = useMemo(() => createClient(), [])

    // Attachment state
    const [attachment, setAttachment] = useState<File | null>(null)
    const [attachmentPreview, setAttachmentPreview] = useState<string | null>(null)

    // Context menu state
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; msg: Message } | null>(null)
    const [forwardMsg, setForwardMsg] = useState<Message | null>(null)
    const [forwarding, setForwarding] = useState(false)
    const [showSearch, setShowSearch] = useState(false)
    const [conversationSearch, setConversationSearch] = useState('')
    const [dragOver, setDragOver] = useState(false)

    // Reply state
    const [replyingTo, setReplyingTo] = useState<Message | null>(null)

    // Audio recording state
    const [isRecording, setIsRecording] = useState(false)
    const [recordingTime, setRecordingTime] = useState(0)
    const mediaRecorderRef = useRef<MediaRecorder | null>(null)
    const audioChunksRef = useRef<Blob[]>([])
    const recordingIntervalRef = useRef<NodeJS.Timeout | null>(null)

    // Quick replies state
    const [quickResponses, setQuickResponses] = useState<QuickResponse[]>([])
    const [showQuickReplies, setShowQuickReplies] = useState(false)
    const [quickSearch, setQuickSearch] = useState('')
    const [quickRepliesLoaded, setQuickRepliesLoaded] = useState(false)

    // Transfer modal state
    const [showTransferModal, setShowTransferModal] = useState(false)
    const [transferUsers, setTransferUsers] = useState<{ userId: string; name: string | null; lastName: string | null; avatar: string | null; role: string }[]>([])
    const [transferLoading, setTransferLoading] = useState(false)
    const [transferSearch, setTransferSearch] = useState('')
    const [transferConvId, setTransferConvId] = useState<string | null>(null)

    // Delete dialog state
    const [showDeleteDialog, setShowDeleteDialog] = useState(false)
    const [deleting, setDeleting] = useState(false)

    // Contact panel state
    const [showContactPanel, setShowContactPanel] = useState(false)
    const [contactNotes, setContactNotes] = useState('')
    const [savingNotes, setSavingNotes] = useState(false)
    const notesDirtyRef = useRef(false)

    // Tags state
    const [availableTags, setAvailableTags] = useState<TagItem[]>([])
    const [showTagPicker, setShowTagPicker] = useState(false)
    const [conversationTags, setConversationTags] = useState<TagItem[]>([])

    // Internal note mode
    const [isNoteMode, setIsNoteMode] = useState(false)

    const tabs = [
        { id: 'waiting' as Tab, label: 'Em espera' },
        { id: 'active' as Tab, label: 'Ativas' },
        { id: 'closed' as Tab, label: 'Finalizadas' },
    ]

    // Load quick responses once
    useEffect(() => {
        if (quickRepliesLoaded) return
        fetch('/api/quick-responses')
            .then(res => res.json())
            .then(data => {
                if (Array.isArray(data)) {
                    setQuickResponses(data.filter((qr: QuickResponse) => qr.isActive))
                }
                setQuickRepliesLoaded(true)
            })
            .catch(() => setQuickRepliesLoaded(true))
    }, [quickRepliesLoaded])

    const audioContextRef = useRef<AudioContext | null>(null)

    // Sound preference listener
    useEffect(() => {
        const stored = localStorage.getItem('odontobox360-sound-enabled')
        if (stored !== null) soundEnabledRef.current = stored === 'true'

        const handler = (e: Event) => {
            soundEnabledRef.current = (e as CustomEvent).detail
        }
        window.addEventListener('odontobox360-sound-change', handler)
        return () => window.removeEventListener('odontobox360-sound-change', handler)
    }, [])

    /**
     * Aviso sonoro de mensagem nova.
     *
     * O contexto de áudio é reaproveitado. A versão anterior criava um
     * `new AudioContext()` a cada toque e nunca o fechava — o Chrome limita a
     * seis por página, então o som funcionava algumas vezes e depois passava a
     * lançar silenciosamente dentro do `catch`. Um aviso que para de tocar sem
     * avisar é pior que não ter aviso.
     */
    const playNotificationSound = useCallback(() => {
        try {
            const AudioCtor =
                window.AudioContext ??
                (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
            if (!AudioCtor) return

            const ctx = audioContextRef.current ?? new AudioCtor()
            audioContextRef.current = ctx
            // A aba em segundo plano suspende o contexto; sem retomar, o aviso
            // some justamente quando a atendente não está olhando a tela.
            if (ctx.state === 'suspended') void ctx.resume()

            const osc = ctx.createOscillator()
            const gain = ctx.createGain()
            osc.connect(gain)
            gain.connect(ctx.destination)
            osc.type = 'sine'
            gain.gain.setValueAtTime(0.3, ctx.currentTime)

            // Two-tone WhatsApp-like "ding ding"
            osc.frequency.setValueAtTime(830, ctx.currentTime)
            osc.frequency.setValueAtTime(990, ctx.currentTime + 0.12)
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3)

            osc.start(ctx.currentTime)
            osc.stop(ctx.currentTime + 0.3)
        } catch {
            // Audio context not available
        }
    }, [])

    // Fetch conversations list
    const fetchConversations = useCallback(async () => {
        try {
            const params = new URLSearchParams({ tab: activeTab })
            if (searchQuery) params.set('search', searchQuery)
            if (onlyMine) params.set('onlyMine', 'true')
            const res = await fetch(`/api/conversations?${params}`)
            const data = await res.json()
            if (data.conversations && Array.isArray(data.conversations)) {
                // Check for new unread messages to play sound
                const newTotalUnread = data.conversations.reduce((sum: number, c: ConversationListItem) => sum + c.unreadCount, 0)
                if (newTotalUnread > prevTotalUnreadRef.current && prevTotalUnreadRef.current >= 0 && soundEnabledRef.current) {
                    playNotificationSound()
                }
                prevTotalUnreadRef.current = newTotalUnread

                setConversations(data.conversations)
                if (data.currentUser) {
                    setCanTransfer(data.currentUser.canTransfer)
                }
            } else if (Array.isArray(data)) {
                setConversations(data)
            }
        } catch (error) {
            console.error('Error fetching conversations:', error)
        } finally {
            setLoading(false)
        }
    }, [activeTab, searchQuery, onlyMine, playNotificationSound])

    // Fetch conversation messages (initial load, limited to 30)
    const fetchMessages = useCallback(async (convId: string) => {
        try {
            const res = await fetch(`/api/conversations/${convId}?limit=30`)
            const data = await res.json()
            console.warn('[REALTIME] fetchMessages', convId, {
                status: res.status,
                total: data.messages?.length,
                ultima: data.messages?.at(-1)?.content?.slice(0, 24),
            })
            if (data.conversation) {
                setConversationDetail(data)
                setMessages(data.messages || [])
                setHasMoreMessages(data.hasMore || false)
                setNextCursor(data.nextCursor || null)
                setConversationTags(data.conversation.tags || [])
                // Only update notes if the user hasn't edited them (not dirty)
                if (!notesDirtyRef.current) {
                    setContactNotes(data.conversation.contact.notes || '')
                }
            }
        } catch (error) {
            console.error('Error fetching messages:', error)
        }
    }, [])

    // Load more messages (scroll up pagination)
    const loadMoreMessages = useCallback(async () => {
        if (!selectedConversation || !nextCursor || loadingMore) return
        setLoadingMore(true)
        try {
            const res = await fetch(`/api/conversations/${selectedConversation}?limit=30&cursor=${encodeURIComponent(nextCursor)}`)
            const data = await res.json()
            if (data.messages) {
                // Preserve scroll position
                const container = messagesContainerRef.current
                const prevScrollHeight = container?.scrollHeight || 0

                setMessages(prev => [...(data.messages || []), ...prev])
                setHasMoreMessages(data.hasMore || false)
                setNextCursor(data.nextCursor || null)

                // Restore scroll position after new messages are rendered
                requestAnimationFrame(() => {
                    if (container) {
                        const newScrollHeight = container.scrollHeight
                        container.scrollTop = newScrollHeight - prevScrollHeight
                    }
                })
            }
        } catch (error) {
            console.error('Error loading more messages:', error)
        } finally {
            setLoadingMore(false)
        }
    }, [selectedConversation, nextCursor, loadingMore])

    // Mark conversation as read
    const markAsRead = useCallback(async (convId: string) => {
        try {
            await fetch(`/api/conversations/${convId}/read`, { method: 'POST' })
            // Update local state immediately
            setConversations(prev => prev.map(c => c.id === convId ? { ...c, unreadCount: 0 } : c))
        } catch (error) {
            console.error('Error marking as read:', error)
        }
    }, [])

    // Send operator typing indicator (debounced)
    const sendTypingIndicator = useCallback((convId: string) => {
        if (operatorTypingRef.current) return
        operatorTypingRef.current = true

        fetch(`/api/conversations/${convId}/typing`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isTyping: true }),
        }).catch(() => { })

        // Auto-reset after 3 seconds
        if (operatorTypingTimeoutRef.current) clearTimeout(operatorTypingTimeoutRef.current)
        operatorTypingTimeoutRef.current = setTimeout(() => {
            operatorTypingRef.current = false
            fetch(`/api/conversations/${convId}/typing`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ isTyping: false }),
            }).catch(() => { })
        }, 3000)
    }, [])

    // Load available tags
    useEffect(() => {
        fetch('/api/tags?limit=100')
            .then(res => res.json())
            .then(data => {
                if (data.data && Array.isArray(data.data)) {
                    setAvailableTags(data.data)
                }
            })
            .catch(() => { })
    }, [])

    // Add tag to conversation
    const addTagToConversation = async (tag: TagItem) => {
        if (!selectedConversation) return
        if (conversationTags.some(t => t.id === tag.id)) return
        try {
            await fetch(`/api/conversations/${selectedConversation}/tags`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tagId: tag.id }),
            })
            setConversationTags(prev => [...prev, tag])
            setShowTagPicker(false)
        } catch { }
    }

    // Remove tag from conversation
    const removeTagFromConversation = async (tagId: string) => {
        if (!selectedConversation) return
        try {
            await fetch(`/api/conversations/${selectedConversation}/tags`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tagId }),
            })
            setConversationTags(prev => prev.filter(t => t.id !== tagId))
        } catch { }
    }

    // Save contact notes
    const saveContactNotes = async () => {
        if (!conversationDetail) return
        setSavingNotes(true)
        try {
            await fetch(`/api/contacts/${conversationDetail.conversation.contact.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ notes: contactNotes }),
            })
            // Clear dirty flag after successful save
            notesDirtyRef.current = false
        } catch {
            console.error('Error saving notes')
        } finally {
            setSavingNotes(false)
        }
    }

    // Stable refs for callbacks used in realtime subscription (avoids re-subscribing)
    const fetchMessagesRef = useRef(fetchMessages)
    const markAsReadRef = useRef(markAsRead)
    const playNotificationSoundRef = useRef(playNotificationSound)
    useEffect(() => { fetchMessagesRef.current = fetchMessages }, [fetchMessages])
    useEffect(() => { markAsReadRef.current = markAsRead }, [markAsRead])
    useEffect(() => { playNotificationSoundRef.current = playNotificationSound }, [playNotificationSound])

    /**
     * O socket do Realtime autentica separado do resto do cliente.
     *
     * Sem isto ele conecta como `anon`, e a política RLS de `messages` concede
     * SELECT apenas a `authenticated` — então o Postgres filtrava todos os
     * eventos e nenhum chegava ao navegador. A lista de conversas parecia viva
     * porque o polling de 15 s a atualizava; o chat aberto, que depende só do
     * evento, nunca se mexia. Era preciso recarregar a página para ver uma
     * mensagem que já estava no banco.
     */
    useEffect(() => {
        let cancelled = false

        void supabase.auth.getSession().then(({ data }) => {
            if (!cancelled && data.session) {
                supabase.realtime.setAuth(data.session.access_token)
            }
        })

        // O token expira; sem re-autenticar, o Realtime volta a emudecer depois
        // de uma hora de turno.
        const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
            if (session) supabase.realtime.setAuth(session.access_token)
        })

        return () => {
            cancelled = true
            listener.subscription.unsubscribe()
        }
    }, [supabase])

    // Initial fetch + Supabase Realtime subscription for conversations
    useEffect(() => {
        fetchConversations()
        let disposed = false
        let retryTimer: ReturnType<typeof setTimeout> | null = null

        // Subscribe to conversations table changes for realtime updates
        const channel = supabase
            .channel('conversations-realtime')
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'conversations',
            }, (payload) => {
                console.warn('[REALTIME] conversations', payload.eventType, {
                    id: (payload.new as { id?: string } | null)?.id,
                    selected: selectedConversationRef.current,
                })
                // Refetch conversations list when any conversation changes
                fetchConversations()
                // Also refetch messages for the currently open conversation
                // This is the RELIABLE event — fires when webhook updates conversation.lastMessageAt
                if (selectedConversationRef.current) {
                    fetchMessagesRef.current(selectedConversationRef.current)
                    markAsReadRef.current(selectedConversationRef.current)
                }
            })
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'messages',
            }, (payload) => {
                // Refetch conversations when new messages arrive (updates lastMessage + unreadCount)
                fetchConversations()
                // Also refetch messages if the new message belongs to the currently open conversation
                const newMsg = payload.new as RealtimeMessageRow
                console.warn('[REALTIME] messages INSERT', {
                    conversationId: newMsg?.conversationId,
                    selected: selectedConversationRef.current,
                    direction: newMsg?.direction,
                    willRefetch: Boolean(newMsg?.conversationId) && selectedConversationRef.current === newMsg?.conversationId,
                })

                // Só mensagem recebida avisa: o eco da que a própria atendente
                // acabou de enviar tocaria o aviso no ouvido de quem a digitou.
                // O gatilho antigo era o contador de não lidas subir — e ele
                // não sobe quando a conversa está aberta, porque `markAsRead`
                // zera na hora. Ou seja: o aviso nunca tocava exatamente no
                // caso mais comum, com a atendente olhando o chat. O evento de
                // mensagem recebida é o gatilho correto.
                if (newMsg?.direction === 'inbound' && soundEnabledRef.current) {
                    playNotificationSoundRef.current()
                }

                if (newMsg?.conversationId && selectedConversationRef.current === newMsg.conversationId) {
                    fetchMessagesRef.current(newMsg.conversationId)
                    markAsReadRef.current(newMsg.conversationId)
                }
            })
            .on('postgres_changes', {
                event: 'UPDATE',
                schema: 'public',
                table: 'messages',
            }, (payload) => {
                // Update message status in real-time (e.g. sent → delivered → read)
                const updated = payload.new as RealtimeMessageRow
                if (updated?.conversationId && selectedConversationRef.current === updated.conversationId) {
                    setMessages(prev => prev.map(m =>
                        // `?? m.status`: um payload de UPDATE que não traga o
                        // campo apagaria o selo de entrega da mensagem. Com
                        // `any` isso gravava undefined sem reclamar.
                        m.id === updated.id ? { ...m, status: updated.status ?? m.status } : m
                    ))
                }
            })
            .subscribe((status, error) => {
                // Sem este callback um CHANNEL_ERROR é silencioso, e foi assim
                // que o Realtime ficou meses mudo sem ninguém notar: o polling
                // disfarçava o sintoma na lista e o chat simplesmente não
                // atualizava.
                const failed = status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || (status === 'CLOSED' && !disposed)
                if (failed) {
                    console.error('[REALTIME] canal de conversas:', status, error)
                    // Um canal em erro não refaz o join sozinho. Recriar o canal
                    // é o que devolve o chat ao vivo numa aba aberta há horas,
                    // depois de o token do socket expirar ou a rede oscilar.
                    if (!disposed && !retryTimer) {
                        retryTimer = setTimeout(() => setRealtimeGeneration((g) => g + 1), 3000)
                    }
                } else {
                    console.warn('[REALTIME] canal de conversas:', status)
                }
            })

        // Fallback polling every 15s in case realtime misses something
        pollRef.current = setInterval(fetchConversations, 15000)

        return () => {
            disposed = true
            if (retryTimer) clearTimeout(retryTimer)
            supabase.removeChannel(channel)
            if (pollRef.current) clearInterval(pollRef.current)
        }
    }, [fetchConversations, supabase, realtimeGeneration])

    // Ref to track the current selected conversation for realtime callbacks
    const selectedConversationRef = useRef<string | null>(null)
    useEffect(() => {
        selectedConversationRef.current = selectedConversation
    }, [selectedConversation])

    // Fetch messages + mark as read when selecting a conversation
    useEffect(() => {
        if (!selectedConversation) return

        fetchMessages(selectedConversation)
        markAsRead(selectedConversation)
    }, [selectedConversation, fetchMessages, markAsRead])

    /**
     * O chat aberto se atualiza por qualquer caminho que atualize a lista.
     *
     * A lista de conversas chegava nova por dois caminhos — evento do Realtime
     * e polling de 15 s — e o chat, por um só: o evento. Bastava o evento
     * falhar (token do socket expirado numa aba aberta há horas, canal em
     * erro) para o card mostrar a mensagem nova e o chat continuar parado, até
     * alguém recarregar a página. Era exatamente o sintoma relatado.
     *
     * Agora, sempre que a lista muda e a conversa aberta tem uma última
     * mensagem diferente da que o chat conhece, as mensagens são recarregadas.
     * Custa um GET a cada mensagem nova, e só quando há mensagem nova.
     */
    useEffect(() => {
        if (!selectedConversation) {
            trackedConversationRef.current = null
            lastSeenMessageIdRef.current = null
            return
        }
        const current = conversations.find((c) => c.id === selectedConversation)
        const latestId = current?.lastMessage?.id ?? null

        if (trackedConversationRef.current !== selectedConversation) {
            // Conversa recém-aberta: o efeito acima já carregou as mensagens.
            trackedConversationRef.current = selectedConversation
            lastSeenMessageIdRef.current = latestId
            return
        }
        if (latestId && latestId !== lastSeenMessageIdRef.current) {
            lastSeenMessageIdRef.current = latestId
            console.warn('[REALTIME] fallback: lista mudou, recarregando o chat', latestId)
            fetchMessages(selectedConversation)
            markAsRead(selectedConversation)
        }
    }, [conversations, selectedConversation, fetchMessages, markAsRead])

    // Typing indicators subscription
    useEffect(() => {
        if (!selectedConversation) return

        // Subscribe to typing indicators
        const typingChannel = supabase
            .channel(`typing:${selectedConversation}`)
            .on('broadcast', { event: 'typing' }, (payload) => {
                const { isTyping, source } = payload.payload || {}
                if (source === 'contact') {
                    setContactTyping(isTyping)
                    // Auto-clear typing after 4 seconds
                    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
                    if (isTyping) {
                        typingTimeoutRef.current = setTimeout(() => setContactTyping(false), 4000)
                    }
                }
            })
            .subscribe()

        return () => {
            supabase.removeChannel(typingChannel)
            setContactTyping(false)
        }
    }, [selectedConversation, supabase])

    const visibleMessages = conversationSearch.trim()
        ? messages.filter((m) => {
              const q = conversationSearch.trim().toLowerCase()
              return m.content.toLowerCase().includes(q) || (m.transcript ?? '').toLowerCase().includes(q)
          })
        : messages

    // Scroll to bottom on new messages (only when near bottom)
    useEffect(() => {
        const container = messagesContainerRef.current
        if (!container) {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
            return
        }
        // Only auto-scroll if user is near the bottom (within 150px)
        const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 150
        if (isNearBottom) {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
        }
    }, [messages])

    // Handle quick replies trigger /*
    const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const value = e.target.value
        setMessageInput(value)

        // Send typing indicator to contact
        if (selectedConversation && value.trim()) {
            sendTypingIndicator(selectedConversation)
        }

        // Check for /* trigger
        const lastSlashStar = value.lastIndexOf('/*')
        if (lastSlashStar !== -1) {
            const afterTrigger = value.substring(lastSlashStar + 2)
            // Only show if there's no space before the trigger or it's at the beginning
            if (!afterTrigger.includes('\n')) {
                setQuickSearch(afterTrigger.toLowerCase())
                setShowQuickReplies(true)
                return
            }
        }
        setShowQuickReplies(false)
    }

    const selectQuickReply = (qr: QuickResponse) => {
        // Replace the /* trigger with the quick response text
        const triggerIndex = messageInput.lastIndexOf('/*')
        const text = fillTemplate(qr.text)
        if (triggerIndex !== -1) {
            setMessageInput(messageInput.substring(0, triggerIndex) + text)
        } else {
            setMessageInput(text)
        }
        setShowQuickReplies(false)
        textareaRef.current?.focus()
    }

    const filteredQuickReplies = quickResponses.filter(qr =>
        qr.command.toLowerCase().includes(quickSearch) ||
        qr.text.toLowerCase().includes(quickSearch)
    )

    const handleSelectConversation = (convId: string) => {
        setSelectedConversation(convId)
        setMessageInput('')
        setShowQuickReplies(false)
        setContactTyping(false)
        // Reset notes dirty flag when switching conversations
        notesDirtyRef.current = false
    }

    const handleSendMessage = async () => {
        const hasText = messageInput.trim().length > 0
        const hasFile = !!attachment
        if ((!hasText && !hasFile) || !selectedConversation || sending) return

        setSending(true)
        try {
            let res: Response
            if (hasFile) {
                const formData = new FormData()
                formData.append('file', attachment!)
                if (hasText) formData.append('caption', messageInput.trim())
                if (replyingTo) formData.append('replyToId', replyingTo.id)
                res = await fetch(`/api/conversations/${selectedConversation}/messages`, {
                    method: 'POST',
                    body: formData,
                })
            } else {
                const body: SendMessageBody = { content: messageInput }
                if (replyingTo) body.replyToId = replyingTo.id
                if (isNoteMode) body.isInternal = true
                res = await fetch(`/api/conversations/${selectedConversation}/messages`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                })
            }
            if (res.ok) {
                const newMsg = await res.json()
                setMessages(prev => [...prev, newMsg])
                setMessageInput('')
                setAttachment(null)
                setAttachmentPreview(null)
                setReplyingTo(null)
                setShowQuickReplies(false)
                setIsNoteMode(false)
                fetchConversations()
            }
        } catch (error) {
            console.error('Error sending message:', error)
        } finally {
            setSending(false)
        }
    }

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return
        setAttachment(file)
        if (file.type.startsWith('image/')) {
            const reader = new FileReader()
            reader.onload = (ev) => setAttachmentPreview(ev.target?.result as string)
            reader.readAsDataURL(file)
        } else {
            setAttachmentPreview(null)
        }
    }

    const clearAttachment = () => {
        setAttachment(null)
        setAttachmentPreview(null)
        if (fileInputRef.current) fileInputRef.current.value = ''
    }

    const handleContextMenu = (e: React.MouseEvent, msg: Message) => {
        e.preventDefault()
        setContextMenu({ x: e.clientX, y: e.clientY, msg })
    }

    const handleReply = (msg: Message) => {
        setReplyingTo(msg)
        setContextMenu(null)
        textareaRef.current?.focus()
    }

    const REACTIONS = ['👍', '❤️', '😂', '🙏', '✅', '😮']

    /** Reage (ou remove a reação, repetindo o mesmo emoji) a uma mensagem recebida. */
    const handleReact = async (msg: Message, emoji: string) => {
        setContextMenu(null)
        if (!selectedConversation) return
        const next = msg.reaction === emoji ? '' : emoji
        try {
            const res = await fetch(`/api/conversations/${selectedConversation}/messages/${msg.id}/react`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ emoji: next }),
            })
            if (!res.ok) {
                const data = await res.json().catch(() => ({}))
                toast.error(data.error || 'Não foi possível reagir')
                return
            }
            setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, reaction: next || null } : m)))
        } catch {
            toast.error('Não foi possível reagir')
        }
    }

    const handleForward = (msg: Message) => {
        setContextMenu(null)
        setForwardMsg(msg)
    }

    const confirmForward = async (targetConversationId: string) => {
        if (!forwardMsg) return
        setForwarding(true)
        try {
            const res = await fetch(`/api/conversations/${targetConversationId}/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ forwardFrom: forwardMsg.id }),
            })
            if (!res.ok) {
                const data = await res.json().catch(() => ({}))
                toast.error(data.error || 'Não foi possível encaminhar')
                return
            }
            toast.success('Mensagem encaminhada')
            setForwardMsg(null)
            fetchConversations()
        } catch {
            toast.error('Não foi possível encaminhar')
        } finally {
            setForwarding(false)
        }
    }

    /** Anexa um arquivo vindo do clipe, do Ctrl+V ou de arrastar e soltar. */
    const attachFile = (file: File) => {
        setAttachment(file)
        setAttachmentPreview(file.type.startsWith('image/') ? URL.createObjectURL(file) : null)
    }

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault()
        setDragOver(false)
        const file = e.dataTransfer?.files?.[0]
        if (file && !attachment) attachFile(file)
    }

    /**
     * Variáveis das respostas rápidas, resolvidas na inserção. Só o que a tela
     * já conhece: nome e telefone do paciente, data e hora. Um nome de clínica
     * entra aqui quando o workspace passar a carregá-lo na resposta da API.
     */
    const fillTemplate = (text: string) => {
        const contact = conversationDetail?.conversation.contact
        const nome = contact?.name?.trim() || ''
        const now = new Date()
        return text
            .replace(/\{\{\s*nome\s*\}\}/gi, nome)
            .replace(/\{\{\s*primeiro_nome\s*\}\}/gi, nome.split(' ')[0] || '')
            .replace(/\{\{\s*telefone\s*\}\}/gi, contact?.phone || '')
            .replace(/\{\{\s*data\s*\}\}/gi, format(now, 'dd/MM/yyyy'))
            .replace(/\{\{\s*hora\s*\}\}/gi, format(now, 'HH:mm'))
    }

    const handleCopyMessage = (msg: Message) => {
        navigator.clipboard.writeText(msg.content)
        setContextMenu(null)
    }

    // Audio recording
    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
            const mimeType = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm'].find(
                (t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)
            )
            const mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
            audioChunksRef.current = []
            mediaRecorderRef.current = mediaRecorder

            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) audioChunksRef.current.push(e.data)
            }

            mediaRecorder.onstop = async () => {
                stream.getTracks().forEach(t => t.stop())
                const blob = new Blob(audioChunksRef.current, {
                    type: (mediaRecorder.mimeType || 'audio/webm').split(';')[0],
                })
                if (blob.size > 0) {
                    await sendRecording(blob)
                }
            }

            mediaRecorder.start()
            setIsRecording(true)
            setRecordingTime(0)
            recordingIntervalRef.current = setInterval(() => {
                setRecordingTime(prev => prev + 1)
            }, 1000)
        } catch (err) {
            console.error('Microphone access denied:', err)
        }
    }

    /** Insere no ponto do cursor e devolve o foco, sem perder a seleção. */
    const insertAtCursor = (text: string) => {
        const el = textareaRef.current
        if (!el) {
            setMessageInput((prev) => prev + text)
            return
        }
        const start = el.selectionStart ?? messageInput.length
        const end = el.selectionEnd ?? start
        const next = messageInput.slice(0, start) + text + messageInput.slice(end)
        setMessageInput(next)
        requestAnimationFrame(() => {
            el.focus()
            const caret = start + text.length
            el.setSelectionRange(caret, caret)
        })
    }

    /**
     * Ctrl+V com uma imagem na área de transferência vira anexo — print de tela
     * de um orçamento, foto de um exame. É o gesto que todo mundo tenta antes
     * de procurar o clipe.
     */
    const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
        const file = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith('image/'))
        if (!file || attachment) return
        e.preventDefault()
        const named = new File([file], `colado-${Date.now()}.${file.type.split('/')[1] || 'png'}`, { type: file.type })
        attachFile(named)
    }

    const stopRecording = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop()
        }
        setIsRecording(false)
        if (recordingIntervalRef.current) {
            clearInterval(recordingIntervalRef.current)
            recordingIntervalRef.current = null
        }
    }

    const cancelRecording = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.ondataavailable = null
            mediaRecorderRef.current.onstop = () => {
                mediaRecorderRef.current!.stream.getTracks().forEach(t => t.stop())
            }
            mediaRecorderRef.current.stop()
        }
        setIsRecording(false)
        setRecordingTime(0)
        audioChunksRef.current = []
        if (recordingIntervalRef.current) {
            clearInterval(recordingIntervalRef.current)
            recordingIntervalRef.current = null
        }
    }

    const sendRecording = async (blob: Blob) => {
        if (!selectedConversation) return
        setSending(true)
        try {
            const formData = new FormData()
            // A extensão segue o formato gravado: a rota deriva o tipo dela e o
            // Evolution usa o nome no envio. Um .webm com conteúdo OGG confunde os dois.
            const ext = blob.type.includes('ogg') ? 'ogg' : blob.type.includes('mp4') ? 'm4a' : 'webm'
            formData.append('file', blob, `audio_${Date.now()}.${ext}`)
            const res = await fetch(`/api/conversations/${selectedConversation}/messages`, {
                method: 'POST',
                body: formData,
            })
            if (res.ok) {
                const newMsg = await res.json()
                setMessages(prev => [...prev, newMsg])
                fetchConversations()
            }
        } catch (error) {
            console.error('Error sending recording:', error)
        } finally {
            setSending(false)
            setRecordingTime(0)
        }
    }

    const formatRecordingTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60)
        const secs = seconds % 60
        return `${mins}:${secs.toString().padStart(2, '0')}`
    }

    // Close context menu on Escape
    useEffect(() => {
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setContextMenu(null)
        }
        window.addEventListener('keydown', handleEsc)
        return () => window.removeEventListener('keydown', handleEsc)
    }, [])

    const handleAction = async (action: 'assign' | 'unassign' | 'close' | 'reopen') => {
        if (!selectedConversation) return
        try {
            await fetch(`/api/conversations/${selectedConversation}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action }),
            })
            fetchConversations()
            fetchMessages(selectedConversation)
        } catch (error) {
            console.error('Error:', error)
        }
    }

    const handleDeleteConversation = async () => {
        if (!selectedConversation) return
        setDeleting(true)
        try {
            const res = await fetch(`/api/conversations/${selectedConversation}`, {
                method: 'DELETE',
            })
            if (res.ok) {
                setSelectedConversation(null)
                setConversationDetail(null)
                setMessages([])
                setShowDeleteDialog(false)
                fetchConversations()
            }
        } catch (error) {
            console.error('Error deleting conversation:', error)
        } finally {
            setDeleting(false)
        }
    }

    // Transfer modal handlers
    const openTransferModal = async (convId: string) => {
        setTransferConvId(convId)
        setShowTransferModal(true)
        setTransferLoading(true)
        setTransferSearch('')
        try {
            const res = await fetch('/api/conversations/users')
            const data = await res.json()
            if (Array.isArray(data)) {
                setTransferUsers(data)
            }
        } catch (error) {
            console.error('Error fetching transfer users:', error)
        } finally {
            setTransferLoading(false)
        }
    }

    const handleTransfer = async (targetUserId: string) => {
        if (!transferConvId) return
        try {
            await fetch(`/api/conversations/${transferConvId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'transfer', targetUserId }),
            })
            setShowTransferModal(false)
            setTransferConvId(null)
            // Clear right panel so the transferred conversation disappears
            setSelectedConversation(null)
            setConversationDetail(null)
            setMessages([])
            fetchConversations()
        } catch (error) {
            console.error('Error transferring:', error)
        }
    }

    const filteredTransferUsers = transferUsers.filter(u => {
        if (!transferSearch) return true
        const fullName = `${u.name || ''} ${u.lastName || ''}`.toLowerCase()
        return fullName.includes(transferSearch.toLowerCase())
    })

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (showQuickReplies && e.key === 'Escape') {
            e.preventDefault()
            setShowQuickReplies(false)
            return
        }
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            if (showQuickReplies && filteredQuickReplies.length > 0) {
                selectQuickReply(filteredQuickReplies[0])
            } else {
                handleSendMessage()
            }
        }
    }

    const conv = conversationDetail?.conversation

    return (
        <>
            <div className="flex h-full min-h-0">
                {/* Left Sidebar — Conversation List */}
                <div className={cn(
                    "w-full border-r bg-card flex-col md:flex md:w-[320px] md:shrink-0",
                    selectedConversation ? "hidden" : "flex"
                )}>
                    {/* Header */}
                    <div className="p-4 border-b">
                        <h1 className="text-xl font-bold mb-3">Conversas</h1>
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Buscar por nome, telefone ou mensagem..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-9 bg-muted/50 h-9"
                            />
                        </div>
                    </div>

                    {/* Tabs */}
                    <div className="flex px-3 py-2 gap-1 border-b">
                        {tabs.map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => {
                                    setActiveTab(tab.id)
                                    setLoading(true)
                                }}
                                className={cn(
                                    'flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
                                    activeTab === tab.id
                                        ? 'bg-primary text-primary-foreground'
                                        : 'text-muted-foreground hover:bg-muted/50'
                                )}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>

                    {/* Filter toggle: Todas / Só minhas */}
                    <div className="flex items-center gap-2 px-3 py-2 border-b">
                        <span className="text-[11px] text-muted-foreground">Ver:</span>
                        <button
                            onClick={() => { setOnlyMine(false); setLoading(true) }}
                            className={cn(
                                'px-2.5 py-1 text-[11px] rounded-md font-medium transition-colors',
                                !onlyMine
                                    ? 'bg-muted text-foreground'
                                    : 'text-muted-foreground hover:bg-muted/50'
                            )}
                        >
                            Todas
                        </button>
                        <button
                            onClick={() => { setOnlyMine(true); setLoading(true) }}
                            className={cn(
                                'px-2.5 py-1 text-[11px] rounded-md font-medium transition-colors',
                                onlyMine
                                    ? 'bg-muted text-foreground'
                                    : 'text-muted-foreground hover:bg-muted/50'
                            )}
                        >
                            Só minhas
                        </button>
                    </div>

                    {/* Conversations List */}
                    <div className="flex-1 overflow-y-auto">
                        {loading ? (
                            <div className="flex items-center justify-center py-12">
                                <div className="animate-pulse text-muted-foreground text-sm">Carregando...</div>
                            </div>
                        ) : conversations.length === 0 ? (
                            <div className="text-center py-12 px-4">
                                <MessageSquare className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                                <p className="text-muted-foreground text-sm">
                                    Nenhuma conversa encontrada.
                                </p>
                            </div>
                        ) : (
                            <div>
                                {conversations.map((conv) => (
                                    <button
                                        key={conv.id}
                                        onClick={() => handleSelectConversation(conv.id)}
                                        className={cn(
                                            'w-full text-left p-3 border-b border-border/50 hover:bg-muted/50 transition-colors',
                                            selectedConversation === conv.id && 'bg-muted'
                                        )}
                                    >
                                        <div className="flex items-start gap-3">
                                            {/* Avatar with profile photo */}
                                            <ContactAvatar
                                                avatar={conv.contact.avatar}
                                                name={conv.contact.name}
                                                phone={conv.contact.phone}
                                            />

                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center justify-between">
                                                    <span className="font-medium text-sm truncate">
                                                        {conv.contact.name || conv.contact.phone || 'Desconhecido'}
                                                    </span>
                                                    <span className="text-[10px] text-muted-foreground flex-shrink-0 ml-2">
                                                        {conv.lastMessage && formatMessageTime(conv.lastMessage.createdAt)}
                                                    </span>
                                                </div>

                                                <div className="flex items-center justify-between mt-0.5">
                                                    <p className="text-xs text-muted-foreground truncate pr-2">
                                                        {conv.lastMessage && (
                                                            <>
                                                                {getSentByLabel(conv.lastMessage.sentBy)}{' '}
                                                                {conv.lastMessage.content}
                                                            </>
                                                        )}
                                                    </p>
                                                    {conv.unreadCount > 0 && (
                                                        <span className="flex-shrink-0 bg-green-500 text-foreground text-[10px] font-bold rounded-full h-5 min-w-[20px] flex items-center justify-center px-1">
                                                            {conv.unreadCount}
                                                        </span>
                                                    )}
                                                </div>

                                                {/* Agent + Atendente badge */}
                                                {(conv.agent || conv.assignedToName) && (
                                                    <div className="flex items-center gap-1 mt-1">
                                                        {conv.agent && (
                                                            <>
                                                                <Bot className="h-3 w-3 text-muted-foreground" />
                                                                <span className="text-[10px] text-muted-foreground">{conv.agent.name}</span>
                                                            </>
                                                        )}
                                                        {conv.agent && conv.assignedToName && (
                                                            <span className="text-[10px] text-muted-foreground/50 mx-0.5">|</span>
                                                        )}
                                                        {conv.assignedToName && (
                                                            <>
                                                                {conv.assignedToAvatar ? (
                                                                    <img
                                                                        src={conv.assignedToAvatar}
                                                                        alt={conv.assignedToName}
                                                                        className="h-3.5 w-3.5 rounded-full object-cover"
                                                                    />
                                                                ) : (
                                                                    <UserCheck className="h-3 w-3 text-muted-foreground" />
                                                                )}
                                                                <span className="text-[10px] text-muted-foreground">{conv.assignedToName}</span>
                                                            </>
                                                        )}
                                                    </div>
                                                )}

                                                {/* Tags */}
                                                {conv.tags && conv.tags.length > 0 && (
                                                    <div className="flex flex-wrap gap-1 mt-1">
                                                        {conv.tags.slice(0, 3).map(tag => (
                                                            <span
                                                                key={tag.id}
                                                                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium"
                                                                style={{
                                                                    backgroundColor: tag.color + '20',
                                                                    color: tag.color,
                                                                }}
                                                            >
                                                                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: tag.color }} />
                                                                {tag.name}
                                                            </span>
                                                        ))}
                                                        {conv.tags.length > 3 && (
                                                            <span className="text-[9px] text-muted-foreground">+{conv.tags.length - 3}</span>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Right Panel — Chat View */}
                <div className={cn(
                    "min-w-0 flex-1 flex-col bg-background md:flex",
                    selectedConversation ? "flex" : "hidden"
                )}>
                    {!selectedConversation || !conv ? (
                        /* Empty state */
                        <div className="flex-1 flex items-center justify-center">
                            <div className="text-center max-w-sm px-8">
                                <div className="mb-6 flex justify-center">
                                    <div className="relative w-48 h-48">
                                        <div className="absolute inset-0 bg-gradient-to-br from-primary/20 to-primary/5 rounded-full" />
                                        <div className="absolute inset-4 flex items-center justify-center">
                                            <Bot className="w-20 h-20 text-primary/60" />
                                        </div>
                                    </div>
                                </div>
                                <h2 className="text-xl font-bold mb-3">
                                    Moderação de atendimentos
                                </h2>
                                <p className="text-muted-foreground text-sm">
                                    Monitore as respostas dos seus agentes, assuma a conversa se necessário,
                                    ou aguarde um agente solicitar sua ajuda.
                                </p>
                            </div>
                        </div>
                    ) : (
                        <>
                            {/* Chat Header */}
                            <div className="flex items-center justify-between px-4 py-3 border-b bg-card">
                                <div className="flex min-w-0 items-center gap-3">
                                    {/* Without this the list is unreachable on a
                                        phone once a conversation is open. */}
                                    <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        className="-ml-1 shrink-0 md:hidden"
                                        aria-label="Voltar para a lista"
                                        onClick={() => setSelectedConversation(null)}
                                    >
                                        <ArrowLeft />
                                    </Button>
                                    <ContactAvatar
                                        avatar={conv.contact.avatar}
                                        name={conv.contact.name}
                                        phone={conv.contact.phone}
                                    />
                                    <div>
                                        <h3 className="font-medium text-sm">
                                            {conv.contact.name || conv.contact.phone || 'Desconhecido'}
                                        </h3>
                                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                            {conv.contact.phone && (
                                                <span className="flex items-center gap-1">
                                                    <Phone className="h-3 w-3" />
                                                    {conv.contact.phone}
                                                </span>
                                            )}
                                            {conv.agent && (
                                                <span className="flex items-center gap-1">
                                                    <Bot className="h-3 w-3" />
                                                    {conv.agent.name}
                                                </span>
                                            )}
                                            {conv.assignedToName && (
                                                <span className="flex items-center gap-1">
                                                    <UserCheck className="h-3 w-3" />
                                                    {conv.assignedToName}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Action buttons */}
                                <div className="flex items-center gap-1">
                                    {conv.status === 'active' && !conv.assignedTo && (
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => handleAction('assign')}
                                            className="text-xs gap-1"
                                        >
                                            <UserCheck className="h-3.5 w-3.5" />
                                            Assumir
                                        </Button>
                                    )}
                                    {conv.assignedTo && (
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => handleAction('unassign')}
                                            className="text-xs gap-1"
                                        >
                                            <UserX className="h-3.5 w-3.5" />
                                            Devolver ao bot
                                        </Button>
                                    )}
                                    {/* Transfer button — only show if user has canTransfer permission */}
                                    {conv.assignedTo && canTransfer && (
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => openTransferModal(conv.id)}
                                            className="text-xs gap-1"
                                        >
                                            <ArrowRightLeft className="h-3.5 w-3.5" />
                                            Transferir
                                        </Button>
                                    )}
                                    {conv.status === 'active' && (
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => handleAction('close')}
                                            className="text-xs gap-1 text-destructive hover:text-destructive"
                                        >
                                            <XCircle className="h-3.5 w-3.5" />
                                            Finalizar
                                        </Button>
                                    )}
                                    {conv.status === 'closed' && (
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => handleAction('reopen')}
                                            className="text-xs gap-1"
                                        >
                                            <RotateCcw className="h-3.5 w-3.5" />
                                            Reabrir
                                        </Button>
                                    )}
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => setShowDeleteDialog(true)}
                                        className="text-xs gap-1 text-destructive hover:text-destructive hover:bg-destructive/10"
                                        title="Excluir conversa permanentemente"
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </Button>

                                    <Button
                                        size="sm"
                                        variant={showSearch ? 'secondary' : 'ghost'}
                                        onClick={() => { setShowSearch(!showSearch); if (showSearch) setConversationSearch('') }}
                                        className="text-xs gap-1 h-8 w-8 p-0"
                                        title="Buscar na conversa"
                                    >
                                        <Search className="h-3.5 w-3.5" />
                                    </Button>

                                    {/* Tag & Contact Panel buttons */}
                                    <div className="relative">
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            onClick={() => setShowTagPicker(!showTagPicker)}
                                            className="text-xs gap-1 h-8 w-8 p-0"
                                            title="Etiquetas"
                                        >
                                            <Tag className="h-3.5 w-3.5" />
                                        </Button>

                                        {/* Tag picker dropdown */}
                                        {showTagPicker && (
                                            <>
                                                <div className="fixed inset-0 z-40" onClick={() => setShowTagPicker(false)} />
                                                <div className="absolute right-0 top-full mt-1 z-50 bg-popover border border-border rounded-lg shadow-xl py-1 min-w-[180px] max-h-[240px] overflow-y-auto">
                                                    {availableTags.length === 0 ? (
                                                        <p className="text-xs text-muted-foreground px-3 py-2">
                                                            Nenhuma etiqueta cadastrada. Crie em Atendimento &amp; IA → Etiquetas.
                                                        </p>
                                                    ) : (
                                                        availableTags.map(tag => {
                                                            const isAdded = conversationTags.some(t => t.id === tag.id)
                                                            return (
                                                                <button
                                                                    key={tag.id}
                                                                    onClick={() => isAdded ? removeTagFromConversation(tag.id) : addTagToConversation(tag)}
                                                                    className="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-muted/60 transition-colors"
                                                                >
                                                                    <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: tag.color }} />
                                                                    <span className="flex-1 text-left truncate">{tag.name}</span>
                                                                    {isAdded && <Check className="h-3.5 w-3.5 text-primary" />}
                                                                </button>
                                                            )
                                                        })
                                                    )}
                                                </div>
                                            </>
                                        )}
                                    </div>

                                    <Button
                                        size="sm"
                                        variant={showContactPanel ? 'secondary' : 'ghost'}
                                        onClick={() => setShowContactPanel(!showContactPanel)}
                                        className="text-xs gap-1 h-8 w-8 p-0"
                                        title="Dados do contato"
                                    >
                                        <PanelRight className="h-3.5 w-3.5" />
                                    </Button>
                                </div>
                            </div>

                            {/* Tags ribbon */}
                            {conversationTags.length > 0 && (
                                <div className="flex items-center gap-1.5 px-4 py-1.5 border-b bg-muted/30">
                                    <Tag className="h-3 w-3 text-muted-foreground" />
                                    {conversationTags.map(tag => (
                                        <span
                                            key={tag.id}
                                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium group/tag"
                                            style={{ backgroundColor: tag.color + '20', color: tag.color }}
                                        >
                                            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: tag.color }} />
                                            {tag.name}
                                            <button
                                                onClick={() => removeTagFromConversation(tag.id)}
                                                className="opacity-0 group-hover/tag:opacity-100 transition-opacity ml-0.5"
                                            >
                                                <X className="h-2.5 w-2.5" />
                                            </button>
                                        </span>
                                    ))}
                                </div>
                            )}

                            {/* Chat + Contact Panel layout */}
                            <div className="flex-1 flex overflow-hidden">
                                {/* Messages + Input column */}
                                <div className="flex-1 flex flex-col overflow-hidden">
                                    {/* Messages */}
                                    {showSearch && (
                                        <div className="border-b border-border bg-card px-4 py-2">
                                            <div className="flex items-center gap-2">
                                                <Search className="h-3.5 w-3.5 text-muted-foreground" />
                                                <input
                                                    autoFocus
                                                    value={conversationSearch}
                                                    onChange={(e) => setConversationSearch(e.target.value)}
                                                    placeholder="Buscar nesta conversa…"
                                                    className="flex-1 bg-transparent text-sm focus:outline-none"
                                                />
                                                <span className="text-xs text-muted-foreground num">
                                                    {conversationSearch ? `${visibleMessages.length} de ${messages.length}` : `${messages.length}`}
                                                    {hasMoreMessages && ' · há mais acima'}
                                                </span>
                                                <button onClick={() => { setShowSearch(false); setConversationSearch('') }} className="text-muted-foreground hover:text-foreground" aria-label="Fechar busca">
                                                    <X className="h-3.5 w-3.5" />
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                    <div
                                        ref={messagesContainerRef}
                                        className={cn('flex-1 overflow-y-auto p-4 space-y-3', dragOver && 'ring-2 ring-inset ring-primary/60')}
                                        onDragOver={(e) => { e.preventDefault(); if (!dragOver) setDragOver(true) }}
                                        onDragLeave={() => setDragOver(false)}
                                        onDrop={handleDrop}
                                    >
                                        {/* Load more messages button */}
                                        {hasMoreMessages && (
                                            <div className="flex justify-center">
                                                <button
                                                    onClick={loadMoreMessages}
                                                    disabled={loadingMore}
                                                    className="text-xs text-primary hover:text-primary/80 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/5 hover:bg-primary/10 transition-colors"
                                                >
                                                    {loadingMore ? (
                                                        <><Loader2 className="h-3 w-3 animate-spin" /> Carregando...</>
                                                    ) : (
                                                        <><RotateCcw className="h-3 w-3" /> Carregar mensagens anteriores</>
                                                    )}
                                                </button>
                                            </div>
                                        )}
                                        {visibleMessages.map((msg) => {
                                            const isInbound = msg.direction === 'inbound'
                                            const isAgent = msg.sentBy === 'agent'
                                            const isHuman = msg.sentBy && msg.sentBy !== 'agent' && msg.sentBy !== 'user'
                                            const isInternal = msg.isInternal || msg.direction === 'internal'

                                            if (isInternal) {
                                                return (
                                                    <div key={msg.id} className="flex justify-center group">
                                                        <div className="max-w-[70%] bg-amber-500/10 border border-dashed border-amber-500/30 rounded-xl px-4 py-2.5 text-sm">
                                                            <div className="flex items-center gap-1.5 text-[10px] text-amber-600 dark:text-amber-400 font-medium mb-1">
                                                                <StickyNote className="h-3 w-3" />
                                                                Nota interna · {msg.senderName || 'Atendente'}
                                                            </div>
                                                            <p className="text-foreground/80 whitespace-pre-wrap">{msg.content}</p>
                                                            <div className="text-[10px] text-amber-600/60 mt-1 text-right">
                                                                {format(new Date(msg.createdAt), 'HH:mm', { locale: ptBR })}
                                                            </div>
                                                        </div>
                                                    </div>
                                                )
                                            }

                                            return (
                                                <div
                                                    key={msg.id}
                                                    className={cn(
                                                        'flex group',
                                                        isInbound ? 'justify-start' : 'justify-end'
                                                    )}
                                                >
                                                    <div
                                                        className={cn(
                                                            'max-w-[70%] rounded-2xl px-4 py-2.5 text-sm relative',
                                                            // Incoming was bg-muted with no edge, which on the
                                                            // page surface is all but invisible — the worst
                                                            // light-mode defect in the app. Outgoing used
                                                            // bg-primary/80, which lightens over white, and the
                                                            // human variant paired a blue fill with navy type.
                                                            // Tokens próprios do chat (globals.css): no escuro os
                                                            // três são claros com texto navy — recebida em gelo,
                                                            // agente em teal clareado, atendente em céu.
                                                            isInbound
                                                                ? 'bg-bubble-in border border-bubble-in-border text-bubble-in-foreground rounded-bl-md'
                                                                : isAgent
                                                                    ? 'bg-bubble-out text-bubble-out-foreground rounded-br-md'
                                                                    : 'bg-bubble-human text-bubble-human-foreground rounded-br-md'
                                                        )}
                                                        onContextMenu={(e) => handleContextMenu(e, msg)}
                                                    >
                                                        {/* Sender label */}
                                                        {!isInbound && (
                                                            <div className="text-[10px] opacity-70 mb-1 font-medium">
                                                                {isAgent
                                                                    ? `🤖 ${msg.senderName || 'Agente'}`
                                                                    : isHuman
                                                                        ? `👤 ${msg.senderName || 'Atendente'}`
                                                                        : ''
                                                                }
                                                            </div>
                                                        )}

                                                        {/* Quoted message */}
                                                        {msg.replyTo && (
                                                            <div className={cn(
                                                                'rounded-lg px-3 py-1.5 mb-1.5 border-l-2 cursor-pointer text-[11px]',
                                                                // Sobreposição navy translúcida: lê sobre qualquer um
                                                                // dos três balões, nos dois temas.
                                                                'bg-bubble-quote border-bubble-quote-border'
                                                            )}>
                                                                <span className={cn(
                                                                    'font-semibold block text-[10px]',
                                                                    isInbound ? 'text-primary' : 'opacity-80'
                                                                )}>
                                                                    {msg.replyTo.direction === 'inbound' ? '👤 Contato' : '🤖 Agente'}
                                                                </span>
                                                                <p className="truncate opacity-80">{msg.replyTo.content}</p>
                                                            </div>
                                                        )}

                                                        <MediaContent msg={msg} />
                                                        <div className={cn(
                                                            'text-[10px] mt-1 flex items-center gap-0.5 opacity-70'
                                                        )}>
                                                            {format(new Date(msg.createdAt), 'HH:mm')}
                                                            <MessageStatus status={msg.status} direction={msg.direction} />
                                                        </div>
                                                        {msg.reaction && (
                                                            <span
                                                                className="absolute -bottom-2.5 right-2 rounded-full border border-border bg-card px-1.5 text-xs shadow-sm"
                                                                title="Sua reação"
                                                            >
                                                                {msg.reaction}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            )
                                        })}

                                        {/* Typing indicator */}
                                        {contactTyping && (
                                            <div className="flex justify-start">
                                                <div className="bg-card border border-border rounded-2xl rounded-bl-md px-4 py-3">
                                                    <div className="flex items-center gap-1">
                                                        <span className="h-2 w-2 rounded-full bg-muted-foreground/60 animate-bounce" style={{ animationDelay: '0ms' }} />
                                                        <span className="h-2 w-2 rounded-full bg-muted-foreground/60 animate-bounce" style={{ animationDelay: '150ms' }} />
                                                        <span className="h-2 w-2 rounded-full bg-muted-foreground/60 animate-bounce" style={{ animationDelay: '300ms' }} />
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        <div ref={messagesEndRef} />
                                    </div>

                                    {/* Message Input */}
                                    {conv.status !== 'closed' && (
                                        <div className="border-t bg-card p-3 relative">
                                            {/* Quick Replies Popup */}
                                            {showQuickReplies && filteredQuickReplies.length > 0 && (
                                                <div className="absolute bottom-full left-3 right-3 mb-1 bg-popover border rounded-lg shadow-lg max-h-[200px] overflow-y-auto z-50">
                                                    <div className="p-1">
                                                        <div className="px-2 py-1.5 text-[10px] text-muted-foreground font-medium uppercase tracking-wider">
                                                            Respostas rápidas
                                                        </div>
                                                        {filteredQuickReplies.map((qr) => (
                                                            <button
                                                                key={qr.id}
                                                                onClick={() => selectQuickReply(qr)}
                                                                className="w-full text-left px-3 py-2 hover:bg-muted/50 rounded-md transition-colors"
                                                            >
                                                                <div className="flex items-center gap-2">
                                                                    <span className="text-xs font-mono text-primary font-medium">{qr.command}</span>
                                                                </div>
                                                                <p className="text-xs text-muted-foreground truncate mt-0.5">
                                                                    {qr.text.substring(0, 80)}{qr.text.length > 80 ? '...' : ''}
                                                                </p>
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Reply preview bar */}
                                            {replyingTo && (
                                                <div className="flex items-center gap-2 mb-2 px-3 py-2 bg-muted/60 rounded-lg border-l-2 border-primary">
                                                    <Reply className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                                                    <div className="flex-1 min-w-0">
                                                        <span className="text-[10px] text-primary font-medium">
                                                            {replyingTo.direction === 'inbound' ? 'Responder' : replyingTo.senderName || 'Você'}
                                                        </span>
                                                        <p className="text-xs text-muted-foreground truncate">{replyingTo.content}</p>
                                                    </div>
                                                    <button onClick={() => setReplyingTo(null)} className="text-muted-foreground hover:text-foreground">
                                                        <X className="h-3.5 w-3.5" />
                                                    </button>
                                                </div>
                                            )}

                                            {/* Attachment preview */}
                                            {attachment && (
                                                <div className="flex items-center gap-2 mb-2 px-3 py-2 bg-muted/60 rounded-lg">
                                                    {attachmentPreview ? (
                                                        <img src={attachmentPreview} alt="Preview" className="h-24 w-24 rounded-md border border-border object-cover" />
                                                    ) : (
                                                        <div className="h-12 w-12 rounded-md bg-muted flex items-center justify-center">
                                                            {attachment.type.startsWith('audio/') ? <Music className="h-5 w-5 text-muted-foreground" /> :
                                                                attachment.type.startsWith('video/') ? <Film className="h-5 w-5 text-muted-foreground" /> :
                                                                    <FileText className="h-5 w-5 text-muted-foreground" />}
                                                        </div>
                                                    )}
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-xs font-medium truncate">{attachment.name}</p>
                                                        <p className="text-[10px] text-muted-foreground">
                                                            {(attachment.size / 1024).toFixed(0)} KB
                                                        </p>
                                                    </div>
                                                    <button onClick={clearAttachment} className="text-muted-foreground hover:text-foreground">
                                                        <X className="h-4 w-4" />
                                                    </button>
                                                </div>
                                            )}

                                            {/* Note mode indicator */}
                                            {isNoteMode && (
                                                <div className="flex items-center gap-2 mb-2 px-3 py-1.5 bg-amber-500/10 rounded-lg border border-dashed border-amber-500/30">
                                                    <StickyNote className="h-3.5 w-3.5 text-amber-600 flex-shrink-0" />
                                                    <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                                                        Modo nota interna — não será enviada ao cliente
                                                    </span>
                                                    <button onClick={() => setIsNoteMode(false)} className="ml-auto text-amber-600/60 hover:text-amber-600">
                                                        <X className="h-3.5 w-3.5" />
                                                    </button>
                                                </div>
                                            )}

                                            {isRecording ? (
                                                <div className="flex items-center gap-3 px-2">
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="rounded-full h-10 w-10 text-destructive hover:text-destructive"
                                                        onClick={cancelRecording}
                                                        title="Cancelar"
                                                    >
                                                        <X className="h-5 w-5" />
                                                    </Button>
                                                    <div className="flex-1 flex items-center gap-3">
                                                        <div className="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse" />
                                                        <span className="text-sm font-mono text-destructive font-medium">
                                                            {formatRecordingTime(recordingTime)}
                                                        </span>
                                                        <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
                                                            <div className="h-full bg-red-500/60 rounded-full animate-pulse" style={{ width: '100%' }} />
                                                        </div>
                                                    </div>
                                                    <Button
                                                        size="icon"
                                                        onClick={stopRecording}
                                                        className="rounded-full h-10 w-10 bg-primary"
                                                        title="Enviar áudio"
                                                    >
                                                        <Send className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            ) : (
                                                <div className="flex items-end gap-2">
                                                    {/* Attachment button */}
                                                    <input
                                                        ref={fileInputRef}
                                                        type="file"
                                                        className="hidden"
                                                        accept="image/*,audio/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip"
                                                        onChange={handleFileSelect}
                                                    />
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="rounded-lg h-10 w-10 flex-shrink-0 text-muted-foreground hover:text-foreground"
                                                        onClick={() => fileInputRef.current?.click()}
                                                        title="Enviar arquivo"
                                                    >
                                                        <Paperclip className="h-4 w-4" />
                                                    </Button>

                                                    {/* Internal note toggle */}
                                                    <Button
                                                        variant={isNoteMode ? 'secondary' : 'ghost'}
                                                        size="icon"
                                                        className={cn(
                                                            'rounded-lg h-10 w-10 flex-shrink-0',
                                                            isNoteMode
                                                                ? 'text-amber-600 bg-amber-500/10 hover:bg-amber-500/20'
                                                                : 'text-muted-foreground hover:text-foreground'
                                                        )}
                                                        onClick={() => setIsNoteMode(!isNoteMode)}
                                                        title={isNoteMode ? 'Voltar para mensagem normal' : 'Nota interna (visível só para atendentes)'}
                                                    >
                                                        <StickyNote className="h-4 w-4" />
                                                    </Button>

                                                    <EmojiPicker onSelect={insertAtCursor} disabled={sending} />

                                                    <textarea
                                                        ref={textareaRef}
                                                        value={messageInput}
                                                        onChange={handleInputChange}
                                                        onKeyDown={handleKeyDown}
                                                        onPaste={handlePaste}
                                                        placeholder={
                                                            isNoteMode
                                                                ? '📝 Nota interna (não será enviada ao cliente)...'
                                                                : attachment
                                                                    ? 'Legenda (opcional)...'
                                                                    : 'Digite sua mensagem... (/* para respostas rápidas)'
                                                        }
                                                        rows={1}
                                                        className={cn(
                                                            'flex-1 bg-muted/50 rounded-lg px-4 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 min-h-[40px] max-h-[120px]',
                                                            isNoteMode
                                                                ? 'focus:ring-amber-500/50 border border-amber-500/30'
                                                                : 'focus:ring-primary/50'
                                                        )}
                                                        style={{ height: 'auto' }}
                                                    />

                                                    {/* Mic button — visible only when no text and no attachment */}
                                                    {!messageInput.trim() && !attachment ? (
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            onClick={startRecording}
                                                            className="rounded-lg h-10 w-10 flex-shrink-0 text-muted-foreground hover:text-primary"
                                                            title="Gravar áudio"
                                                        >
                                                            <Mic className="h-4 w-4" />
                                                        </Button>
                                                    ) : (
                                                        <Button
                                                            size="icon"
                                                            onClick={handleSendMessage}
                                                            disabled={(!messageInput.trim() && !attachment) || sending}
                                                            className="rounded-lg h-10 w-10 flex-shrink-0"
                                                        >
                                                            <Send className="h-4 w-4" />
                                                        </Button>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                </div>  {/* end messages+input column */}

                                {/* Contact Side Panel */}
                                {showContactPanel && conv && (
                                    <div className="hidden w-[280px] shrink-0 overflow-y-auto border-l bg-card xl:block">
                                        <div className="p-4 space-y-4">
                                            {/* Contact header */}
                                            <div className="text-center">
                                                <ContactAvatar
                                                    avatar={conv.contact.avatar}
                                                    name={conv.contact.name}
                                                    phone={conv.contact.phone}
                                                />
                                                <h3 className="font-semibold text-sm mt-2">
                                                    {conv.contact.name || 'Desconhecido'}
                                                </h3>
                                                {conv.contact.source && (
                                                    <span className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                                                        {conv.contact.source}
                                                    </span>
                                                )}
                                            </div>

                                            {/* Contact info */}
                                            <div className="space-y-2">
                                                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Informações</h4>
                                                {conv.contact.phone && (
                                                    <div className="flex items-center gap-2 text-sm">
                                                        <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                                                        <span>{conv.contact.phone}</span>
                                                    </div>
                                                )}
                                                {conv.contact.email && (
                                                    <div className="flex items-center gap-2 text-sm">
                                                        <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                                                        <span className="truncate">{conv.contact.email}</span>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Notes */}
                                            <div className="space-y-2">
                                                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Notas</h4>
                                                <textarea
                                                    value={contactNotes}
                                                    onChange={(e) => {
                                                        setContactNotes(e.target.value)
                                                        notesDirtyRef.current = true
                                                    }}
                                                    placeholder="Adicionar observações sobre este contato..."
                                                    className="w-full h-24 bg-muted/50 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/50"
                                                />
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={saveContactNotes}
                                                    disabled={savingNotes}
                                                    className="w-full text-xs"
                                                >
                                                    {savingNotes ? 'Salvando...' : 'Salvar notas'}
                                                </Button>
                                            </div>

                                            {/* Tags */}
                                            <div className="space-y-2">
                                                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Etiquetas</h4>
                                                <div className="flex flex-wrap gap-1">
                                                    {conversationTags.map(tag => (
                                                        <span
                                                            key={tag.id}
                                                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium"
                                                            style={{ backgroundColor: tag.color + '20', color: tag.color }}
                                                        >
                                                            {tag.name}
                                                            <button onClick={() => removeTagFromConversation(tag.id)}>
                                                                <X className="h-2.5 w-2.5" />
                                                            </button>
                                                        </span>
                                                    ))}
                                                    {conversationTags.length === 0 && (
                                                        <span className="text-xs text-muted-foreground">Nenhuma etiqueta</span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div> {/* end Chat + Contact Panel layout */}

                            {/* Context Menu */}
                            {contextMenu && (
                                <>
                                    <div className="fixed inset-0 z-50" onClick={() => setContextMenu(null)} />
                                    <div
                                        className="fixed z-50 bg-popover border border-border rounded-xl shadow-xl py-1.5 min-w-[160px] animate-in fade-in zoom-in-95 duration-100"
                                        style={{ top: contextMenu.y, left: contextMenu.x }}
                                    >
                                        <button
                                            onClick={() => handleReply(contextMenu.msg)}
                                            className="flex items-center gap-2.5 w-full px-3.5 py-2 text-sm hover:bg-muted/60 transition-colors"
                                        >
                                            <Reply className="h-4 w-4 text-muted-foreground" />
                                            Responder
                                        </button>
                                        <button
                                            onClick={() => handleCopyMessage(contextMenu.msg)}
                                            className="flex items-center gap-2.5 w-full px-3.5 py-2 text-sm hover:bg-muted/60 transition-colors"
                                        >
                                            <Copy className="h-4 w-4 text-muted-foreground" />
                                            Copiar texto
                                        </button>
                                        {!contextMenu.msg.isInternal && (
                                            <button
                                                onClick={() => handleForward(contextMenu.msg)}
                                                className="flex items-center gap-2.5 w-full px-3.5 py-2 text-sm hover:bg-muted/60 transition-colors"
                                            >
                                                <Reply className="h-4 w-4 text-muted-foreground -scale-x-100" />
                                                Encaminhar
                                            </button>
                                        )}
                                        {contextMenu.msg.direction === 'inbound' && (
                                            <div className="mt-1 flex items-center gap-0.5 border-t border-border px-2 pt-1.5">
                                                {REACTIONS.map((emoji) => (
                                                    <button
                                                        key={emoji}
                                                        onClick={() => handleReact(contextMenu.msg, emoji)}
                                                        className={cn(
                                                            'flex h-8 w-8 items-center justify-center rounded-md text-lg hover:bg-muted/60',
                                                            contextMenu.msg.reaction === emoji && 'bg-primary-subtle'
                                                        )}
                                                        title={contextMenu.msg.reaction === emoji ? 'Remover reação' : 'Reagir'}
                                                    >
                                                        {emoji}
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </>
                            )}
                        </>
                    )}
                </div>
            </div >

            {/* Encaminhar */}
            {forwardMsg && (
                <>
                    <div className="fixed inset-0 z-50 bg-black/40" onClick={() => !forwarding && setForwardMsg(null)} />
                    <div className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,420px)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-popover shadow-xl">
                        <div className="flex items-center justify-between border-b border-border px-4 py-3">
                            <div>
                                <p className="text-sm font-semibold">Encaminhar para</p>
                                <p className="truncate text-xs text-muted-foreground">{forwardMsg.content}</p>
                            </div>
                            <button onClick={() => setForwardMsg(null)} className="text-muted-foreground hover:text-foreground" aria-label="Fechar">
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                        <div className="max-h-[50vh] overflow-y-auto py-1">
                            {conversations.filter((c) => c.id !== selectedConversation).length === 0 && (
                                <p className="px-4 py-3 text-sm text-muted-foreground">Nenhuma outra conversa nesta aba.</p>
                            )}
                            {conversations.filter((c) => c.id !== selectedConversation).map((c) => (
                                <button
                                    key={c.id}
                                    disabled={forwarding}
                                    onClick={() => confirmForward(c.id)}
                                    className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-muted/60 disabled:opacity-50"
                                >
                                    <span className="flex-1 truncate">{c.contact.name || c.contact.phone || 'Sem nome'}</span>
                                    <span className="text-xs text-muted-foreground num">{c.contact.phone}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                </>
            )}

            {/* Transfer Modal */}
            {
                showTransferModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
                        <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl">
                            {/* Header */}
                            <div className="mb-4 flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Users className="h-5 w-5 text-primary" />
                                    <h3 className="text-lg font-semibold">Transferir conversa</h3>
                                </div>
                                <button
                                    onClick={() => { setShowTransferModal(false); setTransferConvId(null) }}
                                    className="rounded-lg p-1.5 hover:bg-muted transition-colors"
                                >
                                    <X className="h-4 w-4" />
                                </button>
                            </div>

                            {/* Search */}
                            <div className="mb-4">
                                <Input
                                    placeholder="Buscar usuário..."
                                    value={transferSearch}
                                    onChange={(e) => setTransferSearch(e.target.value)}
                                    className="h-9"
                                />
                            </div>

                            {/* Users List */}
                            <div className="max-h-64 overflow-y-auto space-y-1">
                                {transferLoading ? (
                                    <p className="text-center text-sm text-muted-foreground py-8">Carregando...</p>
                                ) : filteredTransferUsers.length === 0 ? (
                                    <p className="text-center text-sm text-muted-foreground py-8">Nenhum usuário encontrado</p>
                                ) : (
                                    filteredTransferUsers.map(u => (
                                        <button
                                            key={u.userId}
                                            onClick={() => handleTransfer(u.userId)}
                                            className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-muted transition-colors"
                                        >
                                            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium text-primary flex-shrink-0">
                                                {(u.name || '?')[0].toUpperCase()}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium truncate">
                                                    {u.name} {u.lastName || ''}
                                                </p>
                                                <p className="text-xs text-muted-foreground">
                                                    {u.role === 'ADMIN' ? 'Administrador' : u.role === 'GESTOR' ? 'Gestor' : 'Atendente'}
                                                </p>
                                            </div>
                                            <ArrowRightLeft className="h-3.5 w-3.5 text-muted-foreground" />
                                        </button>
                                    ))
                                )}
                            </div>

                            {/* Footer */}
                            <div className="mt-4 flex justify-end">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => { setShowTransferModal(false); setTransferConvId(null) }}
                                >
                                    Cancelar
                                </Button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Delete conversation confirmation dialog */}
            <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Excluir conversa permanentemente?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Esta ação não pode ser desfeita. Todas as mensagens, áudios, imagens e anexos desta conversa serão excluídos permanentemente do sistema.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleDeleteConversation}
                            disabled={deleting}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            {deleting ? (
                                <><Loader2 className="h-4 w-4 animate-spin mr-2" />Excluindo...</>
                            ) : (
                                'Excluir permanentemente'
                            )}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    )
}
