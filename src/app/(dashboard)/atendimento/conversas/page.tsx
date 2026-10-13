'use client'

import { useRouter, useSearchParams } from 'next/navigation'

import { formatPhone } from '@/lib/phone'
import { prettyPhone } from '@/lib/masks'
import { useNow } from '@/hooks/useNow'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
    ArrowLeft,
    ArrowRightLeft,
    Bot,
    CalendarPlus,
    Check,
    CheckCheck,
    CheckCircle2,
    ChevronDown,
    Copy,
    FileText,
    Film,
    Hand,
    Image as ImageIcon,
    ListTodo,
    Loader2,
    Mail,
    MessageSquare,
    Mic,
    Music,
    PanelRight,
    Paperclip,
    Phone,
    Plus,
    Reply,
    RotateCcw,
    Route,
    Search,
    Send,
    Sparkles,
    StickyNote,
    Tag,
    Trash2,
    Users,
    UserX,
    X,
    XCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Separator } from '@/components/ui/separator'
import { Toggle } from '@/components/ui/toggle'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { RowActionItem, RowActionsSeparator } from '@/components/shared/RowActions'
import { toast } from 'sonner'
import { EmojiPicker } from '@/components/shared/EmojiPicker'
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { AudioMessage } from '@/components/shared/AudioMessage'
import { ActivityForm } from '@/components/shared/ActivityForm'
import { ActivityList } from '@/components/shared/ActivityList'
import { AiSummaryPanel } from '@/components/shared/AiSummaryPanel'
import { ConversationFilesPanel } from '@/components/shared/ConversationFilesPanel'
import { InternalNotesPanel } from '@/components/shared/InternalNotesPanel'
import { NewAttendanceDialog } from '@/components/shared/NewAttendanceDialog'
import { TagPicker } from '@/components/shared/TagPicker'
import { TagChip } from '@/components/shared/TagChip'
import { PanelField, PanelSection, RecordPanel } from '@/components/shared/RecordPanel'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { QueueMeter, type QueueCounts } from '@/components/shared/QueueMeter'
import {
    DealJourney,
    type JourneyEntry,
    type JourneyStage,
} from '@/components/shared/DealJourney'
import { format, isToday, isYesterday } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { createClient } from '@/lib/supabase/client'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { DEFAULT_ENTITY_COLOR } from '@/lib/palette'


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

interface OpenDeal {
    id: string
    title: string
    /** A etapa atual do funil — que agora é também a fase da jornada. */
    stageId: string
    stageName: string | null
    stageColor: string | null
    /** De onde veio o paciente — "Agência" no banco. */
    originId: string | null
    /** Por onde veio — "Mídia" no banco. */
    channelId: string | null
    /** De quem é o negócio. Quem está com a conversa é outra coisa, e é do chip. */
    ownerId: string | null
    ownerName: string | null
    value: number | null
    status: 'open' | 'won' | 'lost'
    closedAt: string | null
    outcomeReasonName: string | null
    outcomeNotes: string | null
    closedStageName: string | null
    /** As etapas que esta clínica criou, em ordem. São as fases. */
    stages: JourneyStage[]
    /** Uma entrada por passagem em etapa: a data e a nota de cada fase. */
    entries: JourneyEntry[]
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
        openDeal?: OpenDeal | null
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
            return <CheckCheck className="h-3 w-3 inline-block ml-1 text-info-subtle-foreground" />
        case 'failed':
            return <span className="text-destructive-subtle-foreground ml-1 text-[10px]">⚠️</span>
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

/** O aceso dos painéis — a mesma tinta de estado das telas de índice. */
const PANEL_ON = 'bg-primary-subtle text-primary-subtle-foreground hover:bg-primary-subtle hover:text-primary-subtle-foreground'
/**
 * O `data-state` do Toggle não serve aqui: o `TooltipTrigger` que envolve cada
 * um escreve o próprio estado no mesmo atributo, e `data-[state=on]` nunca
 * casava — era por isso que o painel aberto não acendia. A classe vem da mesma
 * condição que o `pressed`.
 */

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
        return <AudioMessage src={msg.mediaUrl} transcript={msg.transcript} className="mb-1" />
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
    const [queue, setQueue] = useState<QueueCounts | null>(null)
    /**
     * Origem e canal só aceitam o que já está cadastrado.
     *
     * Carregadas uma vez: são listas curtas de cadastro, não dado de conversa, e
     * o painel é aberto muitas vezes por sessão.
     */
    /** Quem pode ser dono do negócio — carregado uma vez, para o campo da ficha. */
    const [dealOwners, setDealOwners] = useState<{ userId: string; name: string }[]>([])
    const [origins, setOrigins] = useState<{ id: string; name: string }[]>([])
    const [channels, setChannels] = useState<{ id: string; name: string }[]>([])
    const [slashIndex, setSlashIndex] = useState(0)
    /** `commands` lista os comandos; `replies` é a segunda página, só respostas. */
    const [slashPage, setSlashPage] = useState<'commands' | 'replies'>('commands')
    /**
     * `?conv=<id>` abre direto numa conversa.
     *
     * Serve ao gatilho em Pacientes: lá o atendimento é criado e a pessoa é
     * trazida para cá já na conversa certa. Lido uma vez, no inicializador — a
     * navegação vem de outra rota, então a página monta; derivar do parâmetro a
     * cada render impediria fechar a conversa no celular, que é o que
     * `setSelectedConversation(null)` faz.
     */
    const router = useRouter()
    const convParam = useSearchParams().get('conv')
    const [selectedConversation, setSelectedConversation] = useState<string | null>(convParam)
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
    const [forwardMsg, setForwardMsg] = useState<Message | null>(null)
    const [creatingDeal, setCreatingDeal] = useState(false)
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

    // Contact panel state
    /**
     * O painel direito tem modos, e um só por vez.
     *
     * Antes cada ícone da faixa fazia uma coisa diferente — busca abria barra,
     * agendar abria diálogo, jornada abria painel — e ninguém conseguia prever o
     * que um ícone ia fazer. Agora os painéis se alternam: clicar em outro
     * troca, clicar no mesmo fecha. Dois painéis de 300px não cabem numa janela
     * de 1280, então alternar é mais honesto que empilhar.
     */
    const [intakeOpen, setIntakeOpen] = useState(false)
    const [suggesting, setSuggesting] = useState(false)

    type PanelMode = 'journey' | 'schedule' | 'activities' | 'files' | 'summary' | 'notes'
    const [panel, setPanel] = useState<PanelMode | null>(null)
    const togglePanel = (next: PanelMode) => setPanel((prev) => (prev === next ? null : next))

    /** O título do painel aberto, que o cabeçalho e o leitor de tela usam. */
    /**
     * Esc fecha a ficha — o mesmo gesto das outras telas. Dentro de um campo ou
     * de um diálogo o Esc é deles.
     */
    useEffect(() => {
        if (!panel) return
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return
            const el = e.target as HTMLElement | null
            if (el && el.closest('input, textarea, [contenteditable="true"], [role="dialog"], [role="listbox"], [role="menu"]')) return
            setPanel(null)
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [panel])

    /**
     * Há quanto tempo o negócio está na fase atual.
     *
     * Da última entrada de fase, como no funil — e `null` quando não há
     * registro, que é diferente de zero dia.
     */
    const nowMs = useNow()
    const openDealForDays = conversationDetail?.conversation?.openDeal ?? null
    const stageSince = openDealForDays
        ? openDealForDays.entries
              .filter((e) => e.stageId === openDealForDays.stageId && e.enteredAt)
              .map((e) => new Date(e.enteredAt as string).getTime())
              .sort((a, b) => b - a)[0]
        : undefined
    const stageDays = stageSince && nowMs ? Math.max(0, Math.floor((nowMs - stageSince) / 86_400_000)) : null
    const stageDaysLabel =
        stageDays === null
            ? null
            : stageDays === 0
              ? 'entrou nesta fase hoje'
              : `nesta fase há ${stageDays} ${stageDays === 1 ? 'dia' : 'dias'}`

    const PANEL_TITLES: Record<PanelMode, string> = {
        summary: 'Resumo do paciente',
        schedule: 'Agendar atividade',
        activities: 'Atividades do paciente',
        files: 'Arquivos da conversa',
        journey: 'Jornada do paciente',
        notes: 'Notas internas',
    }

    // Tags state
    const [availableTags, setAvailableTags] = useState<TagItem[]>([])
    const [showTagPicker, setShowTagPicker] = useState(false)

    /** Sobe quando o painel marca uma atividade — a lista relê a partir dele. */
    const [activitiesToken, setActivitiesToken] = useState(0)
    const [conversationTags, setConversationTags] = useState<TagItem[]>([])

    // Internal note mode

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
    useEffect(() => {
        let cancelled = false
        Promise.all([
            fetch('/api/agencies').then((r) => (r.ok ? r.json() : [])),
            fetch('/api/medias').then((r) => (r.ok ? r.json() : [])),
            fetch('/api/workspace/members').then((r) => (r.ok ? r.json() : [])),
        ])
            .then(([agencies, medias, members]) => {
                if (cancelled) return
                setOrigins(Array.isArray(agencies) ? agencies : [])
                setChannels(Array.isArray(medias) ? medias : [])
                setDealOwners(
                    Array.isArray(members)
                        ? members.map((m: { userId: string; name: string }) => ({ userId: m.userId, name: m.name }))
                        : []
                )
            })
            .catch(() => {
                // Sem as listas os campos aparecem vazios e não editáveis; a
                // tela de Negócios continua sendo o lugar de cadastrar.
            })
        return () => { cancelled = true }
    }, [])

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
                if (data.counts) setQueue(data.counts)
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

    /**
     * Marcar e desmarcar etiqueta — a tela só muda quando o servidor confirma.
     *
     * Antes o estado local mudava sem olhar a resposta: a etiqueta sumia da
     * tela, o pedido voltava 404, e ao reabrir a conversa ela estava lá de
     * novo. Falhou, diz que falhou.
     */
    const addTagToConversation = async (tag: TagItem) => {
        if (!selectedConversation) return
        if (conversationTags.some(t => t.id === tag.id)) return
        try {
            const res = await fetch(`/api/conversations/${selectedConversation}/tags`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tagId: tag.id }),
            })
            if (!res.ok) throw new Error()
            setConversationTags(prev => [...prev, tag])
            setShowTagPicker(false)
            // A lista da esquerda mostra as mesmas etiquetas.
            void fetchConversations()
        } catch {
            toast.error('Não foi possível aplicar a etiqueta')
        }
    }

    const removeTagFromConversation = async (tagId: string) => {
        if (!selectedConversation) return
        try {
            const res = await fetch(`/api/conversations/${selectedConversation}/tags`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tagId }),
            })
            if (!res.ok) throw new Error()
            setConversationTags(prev => prev.filter(t => t.id !== tagId))
            void fetchConversations()
        } catch {
            toast.error('Não foi possível remover a etiqueta')
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

        // The slash menu opens on a `/` that starts the message or a line, and
        // closes as soon as the token stops looking like a command. The old
        // trigger was `/*`, which nobody discovers and which only reached quick
        // replies.
        const match = /(?:^|\n)\/([^\s\n]*)$/.exec(value)
        if (match) {
            setQuickSearch(match[1].toLowerCase())
            setSlashIndex(0)
            setShowQuickReplies(true)
            return
        }
        setShowQuickReplies(false)
        setSlashPage('commands')
    }

    /** Replaces the `/token` under the caret with `text` (or removes it). */
    const replaceSlashToken = (text: string) => {
        const next = messageInput.replace(/(?:^|\n)\/([^\s\n]*)$/, (whole) => {
            const keepsNewline = whole.startsWith('\n')
            return (keepsNewline ? '\n' : '') + text
        })
        setMessageInput(next)
        setShowQuickReplies(false)
        setSlashPage('commands')
        textareaRef.current?.focus()
    }

    const runScheduling = () => {
        replaceSlashToken('')
        if (!conversationDetail?.conversation?.contact?.id) {
            toast.error('Abra uma conversa para agendar')
            return
        }
        setPanel('schedule')
    }

    const selectQuickReply = (qr: QuickResponse) => {
        replaceSlashToken(fillTemplate(qr.text))
    }

    /**
     * The slash menu, as data.
     *
     * Commands first, quick replies under them, so `/` is one door to both. The
     * second page (`replies`) exists because `/resposta` has to lead somewhere:
     * it narrows the same popover to the clinic's saved answers.
     */
    const SLASH_COMMANDS: { id: string; command: string; label: string; run: () => void }[] = [
        { id: 'resposta', command: '/resposta', label: 'Respostas rápidas da clínica', run: () => { setSlashPage('replies'); setQuickSearch(''); setSlashIndex(0) } },
        { id: 'agendar', command: '/agendar', label: 'Agendar atividade para este paciente', run: runScheduling },
        { id: 'assumir', command: '/assumir', label: 'Assumir esta conversa', run: () => { replaceSlashToken(''); void handleAction('assign') } },
    ]

    const filteredQuickReplies = quickResponses.filter(qr =>
        qr.command.toLowerCase().includes(quickSearch) ||
        qr.text.toLowerCase().includes(quickSearch)
    )

    const matchingCommands = slashPage === 'replies'
        ? []
        : SLASH_COMMANDS.filter(c => c.command.slice(1).startsWith(quickSearch) || c.label.toLowerCase().includes(quickSearch))

    /** One flat list, because the keyboard moves through one list. */
    const slashItems: { key: string; kind: 'command' | 'reply'; command: string; label: string; run: () => void }[] = [
        ...matchingCommands.map(c => ({ key: `c-${c.id}`, kind: 'command' as const, command: c.command, label: c.label, run: c.run })),
        ...filteredQuickReplies.map(qr => ({
            key: `r-${qr.id}`,
            kind: 'reply' as const,
            command: qr.command,
            label: qr.text.length > 80 ? `${qr.text.slice(0, 80)}…` : qr.text,
            run: () => selectQuickReply(qr),
        })),
    ]
    const slashOpen = showQuickReplies && slashItems.length > 0

    /**
     * A IA escreve a próxima mensagem e ela cai no compositor.
     *
     * O texto vai para onde ele é enviado, não para um cartão ao lado: quem
     * pediu a sugestão quer ajustar uma palavra e mandar. Substituir o que já
     * está escrito seria apagar trabalho, então o rascunho existente é
     * preservado e a sugestão entra abaixo dele.
     */
    const suggestFollowUp = async () => {
        if (!selectedConversation || suggesting) return
        setSuggesting(true)
        try {
            const res = await fetch(`/api/conversations/${selectedConversation}/follow-up`, { method: 'POST' })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) {
                toast.error(data.error || 'Não foi possível gerar a sugestão')
                return
            }
            setMessageInput((prev) => (prev.trim() ? `${prev.trim()}\n\n${data.message}` : data.message))
            textareaRef.current?.focus()
            if (data.withoutHistory) {
                toast.info('Sem histórico nesta conversa — o texto é uma primeira retomada.')
            }
        } catch {
            toast.error('Não foi possível gerar a sugestão')
        } finally {
            setSuggesting(false)
        }
    }

    const handleSelectConversation = (convId: string) => {
        setSelectedConversation(convId)
        setMessageInput('')
        setShowQuickReplies(false)
        setContactTyping(false)
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

    const handleReply = (msg: Message) => {
        setReplyingTo(msg)
        textareaRef.current?.focus()
    }

    const REACTIONS = ['👍', '❤️', '😂', '🙏', '✅', '😮']

    /** Reage (ou remove a reação, repetindo o mesmo emoji) a uma mensagem recebida. */
    const handleReact = async (msg: Message, emoji: string) => {
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

    const applyDealJourney = (next: { currentStageId: string; entries: JourneyEntry[] }) => {
        setConversationDetail((prev) => {
            const deal = prev?.conversation.openDeal
            if (!prev || !deal) return prev
            const stage = deal.stages.find((s) => s.id === next.currentStageId)
            return {
                ...prev,
                conversation: {
                    ...prev.conversation,
                    openDeal: {
                        ...deal,
                        stageId: next.currentStageId,
                        stageName: stage?.name ?? deal.stageName,
                        stageColor: stage?.color ?? deal.stageColor,
                        entries: next.entries,
                    },
                },
            }
        })
        // O cartão do Kanban e o selo da lista leem da mesma fonte; a lista é
        // recarregada para o selo acompanhar sem esperar o próximo poll.
        void fetchConversations()
    }

    /** Abre um negócio na primeira etapa do funil para o paciente desta conversa. */
    /** Origem e canal do negócio aberto, pela mesma rota que o funil usa. */
    /** De quem é o negócio. O campo é do negócio, não do atendimento. */
    const setDealOwner = async (userId: string) => {
        const deal = conversationDetail?.conversation?.openDeal
        if (!deal) return
        const id = userId || null
        try {
            const res = await fetch(`/api/deals/${deal.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: id }),
            })
            if (!res.ok) throw new Error()
            setConversationDetail((prev) =>
                prev && prev.conversation.openDeal
                    ? {
                          ...prev,
                          conversation: {
                              ...prev.conversation,
                              openDeal: {
                                  ...prev.conversation.openDeal,
                                  ownerId: id,
                                  ownerName: dealOwners.find((m) => m.userId === id)?.name ?? null,
                              },
                          },
                      }
                    : prev
            )
        } catch {
            toast.error('Não foi possível salvar')
        }
    }

    const setDealLookup = async (field: 'agencyId' | 'mediaId', value: string) => {
        const deal = conversationDetail?.conversation?.openDeal
        if (!deal) return
        const id = value || null
        try {
            const res = await fetch(`/api/deals/${deal.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ [field]: id }),
            })
            if (!res.ok) throw new Error()
            setConversationDetail((prev) =>
                prev && prev.conversation.openDeal
                    ? {
                          ...prev,
                          conversation: {
                              ...prev.conversation,
                              openDeal: {
                                  ...prev.conversation.openDeal,
                                  ...(field === 'agencyId' ? { originId: id } : { channelId: id }),
                              },
                          },
                      }
                    : prev
            )
        } catch {
            toast.error('Não foi possível salvar')
        }
    }

    const createDealForContact = async () => {
        const conv = conversationDetail?.conversation

        if (!conv || !selectedConversation) return
        setCreatingDeal(true)
        try {
            const stagesRes = await fetch('/api/pipelines')
            const stagesData = await stagesRes.json()
            const stages: { id: string; order?: number }[] = Array.isArray(stagesData) ? stagesData : stagesData.stages ?? []
            const first = [...stages].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))[0]
            if (!first) {
                toast.error('O funil ainda não tem etapas. Crie em Vendas → Negócios.')
                return
            }
            const res = await fetch('/api/deals', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: conv.contact.name || conv.contact.phone || 'Novo paciente',
                    stageId: first.id,
                    contactId: conv.contact.id,
                }),
            })
            if (!res.ok) throw new Error()
            toast.success('Negócio criado')
            await fetchMessages(selectedConversation)
        } catch {
            toast.error('Não foi possível criar o negócio')
        } finally {
            setCreatingDeal(false)
        }
    }

    const handleCopyMessage = (msg: Message) => {
        navigator.clipboard.writeText(msg.content)
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
        try {
            const res = await fetch(`/api/conversations/${selectedConversation}`, {
                method: 'DELETE',
            })
            // This was the one delete in the app that said nothing either way:
            // the row vanished on success and nothing at all happened on failure.
            if (!res.ok) {
                toast.error('Não foi possível excluir a conversa')
                return
            }
            setSelectedConversation(null)
            setConversationDetail(null)
            setMessages([])
            fetchConversations()
            toast.success('Conversa excluída')
        } catch (error) {
            console.error('Error deleting conversation:', error)
            toast.error('Não foi possível excluir a conversa')
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
        if (slashOpen) {
            if (e.key === 'Escape') {
                e.preventDefault()
                setShowQuickReplies(false)
                setSlashPage('commands')
                return
            }
            if (e.key === 'ArrowDown') {
                e.preventDefault()
                setSlashIndex(i => (i + 1) % slashItems.length)
                return
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault()
                setSlashIndex(i => (i - 1 + slashItems.length) % slashItems.length)
                return
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault()
                slashItems[Math.min(slashIndex, slashItems.length - 1)].run()
                return
            }
        }
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            handleSendMessage()
        }
    }

    const conv = conversationDetail?.conversation

    /* Quem está com a conversa, em uma linha. Era metadado cinza de 11px ao
       lado do telefone; vira o rótulo do controle que muda esse mesmo estado. */
    const conversationStateLabel = !conv
        ? ''
        : conv.status === 'closed'
          ? 'Finalizada'
          : conv.assignedToName
            ? `Com ${conv.assignedToName.split(' ')[0]}`
            : 'No bot'

    return (
        <>
            <div className="flex h-full min-h-0">
                {/* Left Sidebar — Conversation List */}
                {/* A lista cede o lugar ao painel entre 768 e 1280.
                    Antes o painel sobrepunha o chat nessa faixa, tampando
                    justamente as mensagens que se precisa reler enquanto se
                    agenda ou se escreve a nota. Três colunas não cabem em 1280;
                    duas cabem — e a lista é a que se recupera num clique. */}
                <div className={cn(
                    "w-full border-r bg-card flex-col md:w-[320px] md:shrink-0",
                    selectedConversation ? "hidden" : "flex",
                    panel ? "md:hidden xl:flex" : "md:flex"
                )}>
                    {/* Header */}
                    <div className="p-4 border-b">
                        {/* O + é do cabeçalho da coluna, não da conversa aberta:
                            é a lista que ganha um item. Rótulo com verbo porque um
                            "+" solto aqui seria lido como "nova mensagem". */}
                        <div className="mb-3 flex items-center justify-between gap-2">
                            <h1 className="text-h3">Conversas</h1>
                            <Button size="sm" className="gap-1.5" onClick={() => setIntakeOpen(true)}>
                                <Plus className="size-3.5" />
                                Novo atendimento
                            </Button>
                        </div>
                        {queue ? <QueueMeter counts={queue} className="mb-3" /> : null}
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
                                                phone={formatPhone(conv.contact.phone)}
                                            />

                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center justify-between">
                                                    <span className="font-medium text-sm truncate">
                                                        {conv.contact.name || conv.contact.phone || 'Desconhecido'}
                                                    </span>
                                                    <span className="num ml-2 flex-shrink-0 text-[10px] text-muted-foreground">
                                                        {conv.lastMessage && formatMessageTime(conv.lastMessage.createdAt)}
                                                    </span>
                                                </div>

                                                {/* 2. O que foi dito por último. */}
                                                <div className="mt-0.5 flex items-center justify-between gap-2">
                                                    <p className="truncate text-xs text-muted-foreground">
                                                        {conv.lastMessage?.content}
                                                    </p>
                                                    {conv.unreadCount > 0 && (
                                                        <span className="num flex h-5 min-w-[20px] flex-shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                                                            {conv.unreadCount}
                                                        </span>
                                                    )}
                                                </div>

                                                {/* 3. Por onde chegou, com quem está, e como está
                                                    classificada — tudo na terceira linha. As
                                                    etiquetas quebram para uma quarta e uma quinta
                                                    quando são muitas: antes a quarta virava "+1",
                                                    que é o número de uma informação que a pessoa
                                                    procurava pelo nome. O canal e o atendente não
                                                    quebram no meio. */}
                                                {(conv.agent || conv.assignedToName || (conv.tags && conv.tags.length > 0)) && (
                                                    <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1">
                                                        {(conv.agent || conv.assignedToName) && (
                                                            <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[10px] text-muted-foreground">
                                                                {conv.agent ? <span>{conv.agent.name}</span> : null}
                                                                {conv.agent && conv.assignedToName ? (
                                                                    <span aria-hidden="true" className="text-muted-foreground/40">|</span>
                                                                ) : null}
                                                                {conv.assignedToName ? <span>{conv.assignedToName}</span> : null}
                                                                {conv.tags && conv.tags.length > 0 ? (
                                                                    <span aria-hidden="true" className="text-muted-foreground/40">|</span>
                                                                ) : null}
                                                            </span>
                                                        )}
                                                        {conv.tags?.map(tag => (
                                                            <TagChip key={tag.id} name={tag.name} color={tag.color} size="sm" />
                                                        ))}
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
                                        phone={formatPhone(conv.contact.phone)}
                                    />
                                    <div className="min-w-0">
                                        <h3 className="truncate text-sm font-medium">
                                            {conv.contact.name || conv.contact.phone || 'Desconhecido'}
                                        </h3>
                                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                            {conv.contact.phone && (
                                                <span className="flex items-center gap-1">
                                                    <Phone className="h-3 w-3" />
                                                    {formatPhone(conv.contact.phone)}
                                                </span>
                                            )}
                                            {conv.agent && (
                                                <span className="flex items-center gap-1 truncate">
                                                    <Bot className="h-3 w-3 shrink-0" />
                                                    {conv.agent.name}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* ── Comandos ──────────────────────────────
                                    Duas famílias, separadas: o que muda a
                                    conversa (o chip de estado e a ação óbvia
                                    do momento) e o que muda a sua visão
                                    (busca, agenda, etiquetas, painel). Antes
                                    eram oito controles em fila, com o excluir
                                    permanente encostado no finalizar. */}
                                <div className="flex shrink-0 items-center gap-2">
                                    {/* O chip diz quem está com a conversa e
                                        guarda todas as transições. O estado
                                        era texto cinza de 11px; agora é o
                                        comando. */}
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button
                                                variant="secondary"
                                                size="sm"
                                                className="h-8 gap-2 rounded-full pr-2.5 pl-3 font-semibold"
                                                aria-label={`Estado da conversa: ${conversationStateLabel}. Abrir ações`}
                                            >
                                                <span
                                                    aria-hidden="true"
                                                    className={cn(
                                                        'size-2 rounded-full',
                                                        conv.status === 'closed'
                                                            ? 'bg-muted-foreground'
                                                            : conv.assignedTo
                                                              ? 'bg-primary'
                                                              : 'bg-muted-foreground'
                                                    )}
                                                />
                                                <span className="max-w-[12ch] truncate">
                                                    {conversationStateLabel}
                                                </span>
                                                <ChevronDown className="size-3.5 opacity-70" />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end" className="w-52">
                                            {conv.status === 'active' && !conv.assignedTo && (
                                                <RowActionItem
                                                    icon={Hand}
                                                    onClick={() => handleAction('assign')}
                                                >
                                                    Assumir
                                                </RowActionItem>
                                            )}
                                            {conv.assignedTo && (
                                                <RowActionItem
                                                    icon={UserX}
                                                    onClick={() => handleAction('unassign')}
                                                >
                                                    Devolver ao bot
                                                </RowActionItem>
                                            )}
                                            {conv.assignedTo && canTransfer && (
                                                <RowActionItem
                                                    icon={ArrowRightLeft}
                                                    onClick={() => openTransferModal(conv.id)}
                                                >
                                                    Transferir
                                                </RowActionItem>
                                            )}
                                            {conv.status === 'active' && (
                                                <RowActionItem
                                                    icon={XCircle}
                                                    onClick={() => handleAction('close')}
                                                >
                                                    Finalizar
                                                </RowActionItem>
                                            )}
                                            {conv.status === 'closed' && (
                                                <RowActionItem
                                                    icon={RotateCcw}
                                                    onClick={() => handleAction('reopen')}
                                                >
                                                    Reabrir
                                                </RowActionItem>
                                            )}
                                            {/* O separador é o ponto: apagar a
                                                conversa leva junto mensagens,
                                                áudios e anexos, e encostava no
                                                finalizar, que tem Reabrir. */}
                                            <RowActionsSeparator />
                                            <RowActionItem
                                                icon={Trash2}
                                                destructive
                                                onClick={() => setShowDeleteDialog(true)}
                                            >
                                                Excluir conversa
                                            </RowActionItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>

                                    {/* A única ação óbvia daquele estado, a um
                                        clique. Tudo o mais mora no chip. */}
                                    {conv.status === 'active' && !conv.assignedTo && (
                                        <Button
                                            size="sm"
                                            onClick={() => handleAction('assign')}
                                            className="h-8 gap-1.5"
                                        >
                                            <Hand className="size-3.5" />
                                            Assumir
                                        </Button>
                                    )}
                                    {conv.status === 'active' && conv.assignedTo && (
                                        <Button
                                            size="sm"
                                            onClick={() => handleAction('close')}
                                            className="h-8 gap-1.5"
                                        >
                                            <CheckCircle2 className="size-3.5" />
                                            Finalizar
                                        </Button>
                                    )}
                                    {conv.status === 'closed' && (
                                        <Button
                                            size="sm"
                                            onClick={() => handleAction('reopen')}
                                            className="h-8 gap-1.5"
                                        >
                                            <RotateCcw className="size-3.5" />
                                            Reabrir
                                        </Button>
                                    )}

                                    <Separator
                                        orientation="vertical"
                                        className="mx-0.5 !h-5"
                                    />

                                    {/* Ferramentas de visão. Buscar e o painel
                                        são estados ligado/desligado: viram
                                        Toggle, que anuncia `aria-pressed` —
                                        trocar `variant` não anunciava nada. */}
                                    <div className="flex items-center gap-0.5">
                                        {/* A faixa, na ordem em que se usa: achar,
                                            entender, agir, classificar, acompanhar,
                                            registrar. Busca é barra e etiquetas é
                                            popover; os outros quatro alternam o
                                            painel direito. */}
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <Toggle
                                                    size="sm"
                                                    className={cn(showSearch && PANEL_ON)}
                                                    pressed={showSearch}
                                                    onPressedChange={next => {
                                                        setShowSearch(next)
                                                        if (!next) setConversationSearch('')
                                                    }}
                                                    aria-label="Buscar na conversa"
                                                >
                                                    <Search className="size-3.5" />
                                                </Toggle>
                                            </TooltipTrigger>
                                            <TooltipContent>Buscar na conversa</TooltipContent>
                                        </Tooltip>

                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <Toggle
                                                    size="sm"
                                                    className={cn(panel === 'summary' && PANEL_ON)}
                                                    pressed={panel === 'summary'}
                                                    onPressedChange={() => togglePanel('summary')}
                                                    aria-label="Resumo do paciente"
                                                >
                                                    <Sparkles className="size-3.5" />
                                                </Toggle>
                                            </TooltipTrigger>
                                            <TooltipContent>Resumo do paciente</TooltipContent>
                                        </Tooltip>

                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <Toggle
                                                    size="sm"
                                                    className={cn(panel === 'schedule' && PANEL_ON)}
                                                    pressed={panel === 'schedule'}
                                                    onPressedChange={() => togglePanel('schedule')}
                                                    aria-label="Agendar atividade"
                                                >
                                                    <CalendarPlus className="size-3.5" />
                                                </Toggle>
                                            </TooltipTrigger>
                                            <TooltipContent>Agendar atividade</TooltipContent>
                                        </Tooltip>

                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <Toggle
                                                    size="sm"
                                                    className={cn(panel === 'activities' && PANEL_ON)}
                                                    pressed={panel === 'activities'}
                                                    onPressedChange={() => togglePanel('activities')}
                                                    aria-label="Atividades do paciente"
                                                >
                                                    <ListTodo className="size-3.5" />
                                                </Toggle>
                                            </TooltipTrigger>
                                            <TooltipContent>Atividades do paciente</TooltipContent>
                                        </Tooltip>
                                        {/* Etiquetas — Popover, não div com z-50:
                                            o primitivo trata Esc, clique fora,
                                            foco e aria-expanded. Popover e não
                                            painel porque é escolha de um clique. */}
                                        <Popover open={showTagPicker} onOpenChange={setShowTagPicker}>
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <PopoverTrigger asChild>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon-sm"
                                                            className={cn('relative', showTagPicker && PANEL_ON)}
                                                            aria-label={
                                                                conversationTags.length > 0
                                                                    ? `Etiquetas da conversa: ${conversationTags.map(t => t.name).join(', ')}`
                                                                    : 'Etiquetas da conversa'
                                                            }
                                                        >
                                                            <Tag className="size-3.5" />
                                                            {/* A faixa de etiquetas abaixo do cabeçalho saiu:
                                                                ela mudava a altura do cabeçalho conforme a
                                                                conversa tinha ou não etiqueta, e as mensagens
                                                                pulavam ao trocar de conversa. O que ela dizia
                                                                de longe — "esta conversa está classificada, e
                                                                em quantas" — vive aqui; quais são, e tirar ou
                                                                pôr, é o clique que já existia. */}
                                                            {conversationTags.length > 0 ? (
                                                                <span
                                                                    aria-hidden="true"
                                                                    className="num absolute -right-0.5 -top-0.5 flex size-3.5 items-center justify-center rounded-full bg-primary-subtle-foreground text-[9px] font-bold text-card"
                                                                >
                                                                    {conversationTags.length}
                                                                </span>
                                                            ) : null}
                                                        </Button>
                                                    </PopoverTrigger>
                                                </TooltipTrigger>
                                                <TooltipContent>Etiquetas</TooltipContent>
                                            </Tooltip>
                                            <PopoverContent align="end" className="w-64 p-2">
                                                <TagPicker
                                                    available={availableTags}
                                                    applied={conversationTags}
                                                    onAdd={addTagToConversation}
                                                    onRemove={removeTagFromConversation}
                                                    onCreated={(tag) => {
                                                        setAvailableTags((prev) => [...prev, tag])
                                                        void addTagToConversation(tag)
                                                    }}
                                                />
                                            </PopoverContent>
                                        </Popover>

                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <Toggle
                                                    size="sm"
                                                    className={cn(panel === 'files' && PANEL_ON)}
                                                    pressed={panel === 'files'}
                                                    onPressedChange={() => togglePanel('files')}
                                                    aria-label="Arquivos da conversa"
                                                >
                                                    <Paperclip className="size-3.5" />
                                                </Toggle>
                                            </TooltipTrigger>
                                            <TooltipContent>Arquivos da conversa</TooltipContent>
                                        </Tooltip>

                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <Toggle
                                                    size="sm"
                                                    className={cn(panel === 'journey' && PANEL_ON)}
                                                    pressed={panel === 'journey'}
                                                    onPressedChange={() => togglePanel('journey')}
                                                    aria-label="Jornada do paciente"
                                                >
                                                    {/* `Route` e não `PanelRight`: o ícone
                                                        dizia "abre um painel", não o que o
                                                        painel contém. */}
                                                    <Route className="size-3.5" />
                                                </Toggle>
                                            </TooltipTrigger>
                                            <TooltipContent>Jornada do paciente</TooltipContent>
                                        </Tooltip>

                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <Toggle
                                                    size="sm"
                                                    className={cn(panel === 'notes' && PANEL_ON)}
                                                    pressed={panel === 'notes'}
                                                    onPressedChange={() => togglePanel('notes')}
                                                    aria-label="Notas internas"
                                                >
                                                    <StickyNote className="size-3.5" />
                                                </Toggle>
                                            </TooltipTrigger>
                                            <TooltipContent>Notas internas</TooltipContent>
                                        </Tooltip>
                                    </div>
                                </div>
                            </div>
                            {/* Chat + Contact Panel layout */}
                            {/* `relative` por causa do painel: abaixo de 1280 ele
                                sobrepõe o chat em vez de encolhê-lo, porque uma
                                coluna de 300px ao lado de mensagens num notebook
                                de 1280 deixa as duas ilegíveis. */}
                            <div className="relative flex flex-1 overflow-hidden">
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
                                            // Follow-up que o sistema mandou sozinho. Não se
                                            // esconde: quem abrir a conversa amanhã precisa saber
                                            // que aquela mensagem não saiu de uma pessoa.
                                            const isAuto = msg.sentBy === 'auto'
                                            const isHuman = msg.sentBy && msg.sentBy !== 'agent' && msg.sentBy !== 'user' && msg.sentBy !== 'auto'
                                            const isInternal = msg.isInternal || msg.direction === 'internal'

                                            if (isInternal) {
                                                return (
                                                    <div key={msg.id} className="flex justify-center group">
                                                        <div className="max-w-[70%] bg-warning-subtle border border-dashed border-warning/40 rounded-xl px-4 py-2.5 text-sm text-warning-subtle-foreground">
                                                            <div className="flex items-center gap-1.5 text-[10px] font-medium mb-1 opacity-80">
                                                                <StickyNote className="h-3 w-3" />
                                                                Nota interna · {msg.senderName || 'Atendente'}
                                                            </div>
                                                            <p className="text-foreground/80 whitespace-pre-wrap">{msg.content}</p>
                                                            <div className="text-[10px] opacity-60 mt-1 text-right">
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
                                                  {/* O menu da mensagem é o primitivo: posição, Esc,
                                                      clique fora e navegação por teclado faltavam na
                                                      versão artesanal, e menu sem teclado é
                                                      inacessível por definição. */}
                                                  <ContextMenu>
                                                    <ContextMenuTrigger asChild>
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
                                                    >
                                                        {/* Quem falou. O follow-up automático se
                                                            identifica porque esconder isso é o tipo
                                                            de economia que custa caro quando o
                                                            paciente percebe. */}
                                                        {!isInbound && (
                                                            <div className="text-[10px] opacity-70 mb-1 font-medium uppercase tracking-wide">
                                                                {isAuto
                                                                    ? 'Enviada automaticamente'
                                                                    : isAgent
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
                                                                    {msg.replyTo.direction === 'inbound' ? '👤 Paciente' : '🤖 Agente'}
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
                                                    </ContextMenuTrigger>
                                                    <ContextMenuContent className="min-w-[180px]">
                                                        <ContextMenuItem onSelect={() => handleReply(msg)}>
                                                            <Reply className="text-muted-foreground" />
                                                            Responder
                                                        </ContextMenuItem>
                                                        <ContextMenuItem onSelect={() => handleCopyMessage(msg)}>
                                                            <Copy className="text-muted-foreground" />
                                                            Copiar texto
                                                        </ContextMenuItem>
                                                        {!msg.isInternal && (
                                                            <ContextMenuItem onSelect={() => handleForward(msg)}>
                                                                <Reply className="-scale-x-100 text-muted-foreground" />
                                                                Encaminhar
                                                            </ContextMenuItem>
                                                        )}
                                                        {msg.direction === 'inbound' && (
                                                            <>
                                                                <ContextMenuSeparator />
                                                                <div className="flex items-center gap-0.5 px-1 pb-0.5">
                                                                    {REACTIONS.map((emoji) => (
                                                                        <button
                                                                            key={emoji}
                                                                            onClick={() => handleReact(msg, emoji)}
                                                                            className={cn(
                                                                                'flex h-8 w-8 items-center justify-center rounded-md text-lg hover:bg-muted/60',
                                                                                msg.reaction === emoji && 'bg-primary-subtle'
                                                                            )}
                                                                            aria-label={msg.reaction === emoji ? `Remover reação ${emoji}` : `Reagir com ${emoji}`}
                                                                        >
                                                                            {emoji}
                                                                        </button>
                                                                    ))}
                                                                </div>
                                                            </>
                                                        )}
                                                    </ContextMenuContent>
                                                  </ContextMenu>
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
                                            {/* Slash menu — commands and the
                                                clinic's saved answers behind one
                                                `/`. It is a roled listbox the
                                                textarea drives: cmdk wants to own
                                                its own input, and the typing
                                                surface here is the composer. */}
                                            {slashOpen && (
                                                <div
                                                    role="listbox"
                                                    aria-label="Comandos do compositor"
                                                    className="absolute bottom-full left-3 right-3 z-50 mb-1 max-h-[220px] overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-md"
                                                >
                                                    <div className="flex items-center justify-between px-2 py-1.5">
                                                        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                                                            {slashPage === 'replies' ? 'Respostas rápidas' : 'Comandos'}
                                                        </span>
                                                        <span className="text-[10px] text-muted-foreground">
                                                            ↑↓ navegar · Enter escolher · Esc fechar
                                                        </span>
                                                    </div>
                                                    {slashItems.map((item, i) => (
                                                        <button
                                                            key={item.key}
                                                            type="button"
                                                            role="option"
                                                            aria-selected={i === slashIndex}
                                                            onMouseEnter={() => setSlashIndex(i)}
                                                            onClick={item.run}
                                                            className={cn(
                                                                'w-full rounded-md px-3 py-2 text-left transition-colors',
                                                                i === slashIndex ? 'bg-accent' : 'hover:bg-muted/50'
                                                            )}
                                                        >
                                                            <span className={cn(
                                                                'text-xs font-medium',
                                                                item.kind === 'command' ? 'text-primary-subtle-foreground' : 'font-mono text-primary-subtle-foreground'
                                                            )}>
                                                                {item.command}
                                                            </span>
                                                            <p className="mt-0.5 truncate text-xs text-muted-foreground">{item.label}</p>
                                                        </button>
                                                    ))}
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

                                            {isRecording ? (
                                                <div className="flex items-center gap-3 px-2">
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-10 w-10 rounded-full text-destructive-subtle-foreground hover:text-destructive-subtle-foreground"
                                                        onClick={cancelRecording}
                                                        aria-label="Cancelar gravação"
                                                    >
                                                        <X className="h-5 w-5" />
                                                    </Button>
                                                    <div className="flex-1 flex items-center gap-3">
                                                        <div className="h-2.5 w-2.5 rounded-full bg-destructive animate-pulse" />
                                                        <span className="text-sm font-mono text-destructive-subtle-foreground font-medium">
                                                            {formatRecordingTime(recordingTime)}
                                                        </span>
                                                        <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
                                                            <div className="h-full bg-destructive/60 rounded-full animate-pulse" style={{ width: '100%' }} />
                                                        </div>
                                                    </div>
                                                    <Button
                                                        size="icon"
                                                        onClick={stopRecording}
                                                        className="h-10 w-10 rounded-full bg-primary"
                                                        aria-label="Enviar áudio"
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
                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-10 w-10 flex-shrink-0 rounded-lg text-muted-foreground hover:text-foreground"
                                                                onClick={() => fileInputRef.current?.click()}
                                                                aria-label="Enviar arquivo"
                                                            >
                                                                <Paperclip className="h-4 w-4" />
                                                            </Button>
                                                        </TooltipTrigger>
                                                        <TooltipContent>Enviar arquivo — imagem, PDF ou documento</TooltipContent>
                                                    </Tooltip>

                                                    {/* Sugerir a próxima mensagem. Fica no
                                                        compositor porque é dali que ela sai —
                                                        no funil o mesmo texto não tinha destino. */}
                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-10 w-10 flex-shrink-0 rounded-lg text-muted-foreground hover:text-foreground"
                                                                onClick={() => void suggestFollowUp()}
                                                                disabled={suggesting || sending}
                                                                aria-label="Sugerir mensagem com IA"
                                                            >
                                                                {suggesting
                                                                    ? <Loader2 className="h-4 w-4 animate-spin" />
                                                                    : <Sparkles className="h-4 w-4" />}
                                                            </Button>
                                                        </TooltipTrigger>
                                                        <TooltipContent>
                                                            Sugerir mensagem — lê a conversa e consome créditos
                                                        </TooltipContent>
                                                    </Tooltip>

                                                    {/* O campo e, dentro dele, o emoji: ele serve
                                                        ao texto que está sendo escrito, e no lado
                                                        de fora disputava lugar com o que age sobre
                                                        a conversa. */}
                                                    <div className="relative flex-1">
                                                        <textarea
                                                            ref={textareaRef}
                                                            value={messageInput}
                                                            onChange={handleInputChange}
                                                            onKeyDown={handleKeyDown}
                                                            onPaste={handlePaste}
                                                            placeholder={
                                                                attachment
                                                                    ? 'Legenda (opcional)…'
                                                                    : 'Digite sua mensagem… ( / para comandos )'
                                                            }
                                                            rows={1}
                                                            className="max-h-[120px] min-h-[40px] w-full resize-none rounded-lg bg-muted/50 py-2.5 pl-4 pr-11 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                                                            style={{ height: 'auto' }}
                                                        />
                                                        <EmojiPicker
                                                            onSelect={insertAtCursor}
                                                            disabled={sending}
                                                            className="absolute bottom-0.5 right-1 size-9 text-muted-foreground hover:text-foreground"
                                                        />
                                                    </div>

                                                    {/* Mic button — visible only when no text and no attachment */}
                                                    {!messageInput.trim() && !attachment ? (
                                                        <Tooltip>
                                                            <TooltipTrigger asChild>
                                                                <Button
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    onClick={startRecording}
                                                                    className="h-10 w-10 flex-shrink-0 rounded-lg text-muted-foreground hover:text-primary"
                                                                    aria-label="Gravar áudio"
                                                                >
                                                                    <Mic className="h-4 w-4" />
                                                                </Button>
                                                            </TooltipTrigger>
                                                            <TooltipContent>Gravar e enviar um áudio</TooltipContent>
                                                        </Tooltip>
                                                    ) : (
                                                        <Tooltip>
                                                            <TooltipTrigger asChild>
                                                                <Button
                                                                    size="icon"
                                                                    onClick={handleSendMessage}
                                                                    disabled={(!messageInput.trim() && !attachment) || sending}
                                                                    className="h-10 w-10 flex-shrink-0 rounded-lg"
                                                                    aria-label="Enviar mensagem"
                                                                >
                                                                    <Send className="h-4 w-4" />
                                                                </Button>
                                                            </TooltipTrigger>
                                                            <TooltipContent>Enviar — Enter envia, Shift+Enter quebra a linha</TooltipContent>
                                                        </Tooltip>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                </div>  {/* end messages+input column */}

                                {/* O painel direito, num modo por vez.
                                    O cabeçalho com título e X existe porque, com
                                    cinco conteúdos possíveis no mesmo lugar, o
                                    painel tem de dizer qual deles está aberto. */}
                                {panel && conv && (
                                    <RecordPanel
                                        label={PANEL_TITLES[panel]}
                                        heading={PANEL_TITLES[panel]}
                                        onClose={() => setPanel(null)}
                                        onEditFull={conv.contact?.id ? () => router.push(`/vendas/pacientes?open=${conv.contact.id}`) : undefined}
                                        editLabel="Abrir a ficha do paciente"
                                        hint="Esc fecha"
                                        /* No celular o painel toma a tela, que é o padrão da
                                           própria conversa ali. De 768 para cima ele é coluna,
                                           porque a lista saiu de cena. */
                                        className="md:static md:z-auto md:w-[380px] md:shrink-0 md:border-l md:border-border"
                                    >
                                            {panel === 'summary' ? <AiSummaryPanel key={conv.id} conversationId={conv.id} /> : null}

                                            {panel === 'files' ? <ConversationFilesPanel key={conv.id} conversationId={conv.id} /> : null}

                                            {panel === 'notes' ? (
                                                <InternalNotesPanel
                                                    key={conv.id}
                                                    conversationId={conv.id}
                                                    refreshToken={messages.filter((m) => m.isInternal).length}
                                                    onCreated={() => void fetchMessages(conv.id)}
                                                />
                                            ) : null}

                                            {panel === 'schedule' && conv.contact?.id ? (
                                                <ActivityForm
                                                    key={conv.id}
                                                    contactId={conv.contact.id}
                                                    contactName={conv.contact.name || conv.contact.phone || 'paciente'}
                                                    dealId={conv.openDeal?.id ?? null}
                                                    dealTitle={conv.openDeal?.title ?? null}
                                                    onScheduled={({ date, time }) => {
                                                        // O texto entra no compositor em vez de ser
                                                        // enviado: quem confirma o horário com o
                                                        // paciente é a pessoa, não a tela.
                                                        const [y, m, d] = date.split('-')
                                                        setMessageInput(
                                                            `Agendado para ${d}/${m}/${y} às ${time}. Qualquer coisa, me avise por aqui.`
                                                        )
                                                        textareaRef.current?.focus()
                                                        setActivitiesToken((n) => n + 1)
                                                        // O que foi marcado aparece no painel ao lado,
                                                        // que é o lugar dele — aqui só se agenda.
                                                        setPanel('activities')
                                                    }}
                                                />
                                            ) : null}

                                            {/* O que já está marcado para este paciente, com o
                                                círculo que conclui — o mesmo painel do negócio.
                                                Quem está na conversa é quem acabou de confirmar
                                                por escrito que o retorno aconteceu. */}
                                            {panel === 'activities' && conv.contact?.id ? (
                                                <ActivityList
                                                    key={`list-${conv.id}`}
                                                    contactId={conv.contact.id}
                                                    refreshToken={activitiesToken}
                                                    onChanged={() => setActivitiesToken((n) => n + 1)}
                                                />
                                            ) : null}

                                            {panel === 'journey' ? (
                                                <>
                                                    {/* Quem é — nome, telefone e por onde a conversa chegou. */}
                                                    <div className="flex items-center gap-3">
                                                        <ContactAvatar
                                                            avatar={conv.contact.avatar}
                                                            name={conv.contact.name}
                                                            phone={formatPhone(conv.contact.phone)}
                                                        />
                                                        <div className="min-w-0">
                                                            <h3 className="truncate text-[15px] font-bold">{conv.contact.name || 'Desconhecido'}</h3>
                                                            <p className="num truncate text-[11px] text-muted-foreground">
                                                                {conv.contact.phone ? prettyPhone(conv.contact.phone) : 'Sem telefone'}
                                                                {conv.agent ? ` · ${conv.agent.name}` : ''}
                                                            </p>
                                                            {conv.contact.email ? (
                                                                <p className="truncate text-[11px] text-muted-foreground">{conv.contact.email}</p>
                                                            ) : null}
                                                        </div>
                                                    </div>

                                                    {conv.openDeal ? (
                                                        <>
                                                            <PanelSection
                                                                title="Negócio aberto"
                                                                aside={
                                                                    stageDaysLabel ? (
                                                                        <span className="text-[10px] text-muted-foreground">{stageDaysLabel}</span>
                                                                    ) : null
                                                                }
                                                            >
                                                                <div className="flex items-center justify-between gap-2">
                                                                    <span className="truncate text-[13px] font-semibold" title={conv.openDeal.title}>
                                                                        {conv.openDeal.title}
                                                                    </span>
                                                                    {conv.openDeal.status === 'won' ? (
                                                                        <span className="shrink-0 rounded-full bg-success-subtle px-2 py-0.5 text-[10px] font-semibold text-success-subtle-foreground">Ganho</span>
                                                                    ) : conv.openDeal.status === 'lost' ? (
                                                                        <span className="shrink-0 rounded-full bg-destructive-subtle px-2 py-0.5 text-[10px] font-semibold text-destructive-subtle-foreground">Perdido</span>
                                                                    ) : conv.openDeal.stageName ? (
                                                                        <TagChip size="sm" name={conv.openDeal.stageName} color={conv.openDeal.stageColor ?? DEFAULT_ENTITY_COLOR} />
                                                                    ) : null}
                                                                </div>
                                                            </PanelSection>

                                                            <PanelSection title="Jornada">
                                                                <DealJourney
                                                                    dealId={conv.openDeal.id}
                                                                    dealTitle={conv.openDeal.title}
                                                                    dealValue={conv.openDeal.value}
                                                                    stages={conv.openDeal.stages}
                                                                    currentStageId={conv.openDeal.stageId}
                                                                    entries={conv.openDeal.entries}
                                                                    status={conv.openDeal.status}
                                                                    outcomeReasonName={conv.openDeal.outcomeReasonName}
                                                                    outcomeNotes={conv.openDeal.outcomeNotes}
                                                                    closedAt={conv.openDeal.closedAt}
                                                                    closedStageName={conv.openDeal.closedStageName}
                                                                    // O tempo na fase já está ao lado de "Negócio aberto".
                                                                    showAge={false}
                                                                    onOutcome={() => {
                                                                        // Relê o negócio e a lista: o desfecho muda o
                                                                        // selo aqui e o cartão no funil.
                                                                        void fetchMessages(conv.id)
                                                                        void fetchConversations()
                                                                    }}
                                                                    onChange={applyDealJourney}
                                                                />
                                                            </PanelSection>

                                                            {/* Os três campos do negócio que esta tela responde:
                                                                de onde veio, por onde, e de quem é. */}
                                                            <PanelSection
                                                                title="Dados"
                                                                aside={<span className="text-[10px] text-muted-foreground">grava ao escolher</span>}
                                                            >
                                                                <PanelField label="Origem">
                                                                    <Select
                                                                        value={conv.openDeal.originId ?? 'none'}
                                                                        onValueChange={(v) => void setDealLookup('agencyId', v === 'none' ? '' : v)}
                                                                    >
                                                                        <SelectTrigger size="sm" className="w-full" aria-label="Origem"><SelectValue placeholder="—" /></SelectTrigger>
                                                                        <SelectContent>
                                                                            <SelectItem value="none">—</SelectItem>
                                                                            {origins.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                                                                        </SelectContent>
                                                                    </Select>
                                                                </PanelField>
                                                                <PanelField label="Canal">
                                                                    <Select
                                                                        value={conv.openDeal.channelId ?? 'none'}
                                                                        onValueChange={(v) => void setDealLookup('mediaId', v === 'none' ? '' : v)}
                                                                    >
                                                                        <SelectTrigger size="sm" className="w-full" aria-label="Canal"><SelectValue placeholder="—" /></SelectTrigger>
                                                                        <SelectContent>
                                                                            <SelectItem value="none">—</SelectItem>
                                                                            {channels.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                                                                        </SelectContent>
                                                                    </Select>
                                                                </PanelField>
                                                                <PanelField label="Responsável">
                                                                    <Select
                                                                        value={conv.openDeal.ownerId ?? 'none'}
                                                                        onValueChange={(v) => void setDealOwner(v === 'none' ? '' : v)}
                                                                    >
                                                                        <SelectTrigger size="sm" className="w-full" aria-label="Responsável pelo negócio"><SelectValue placeholder="—" /></SelectTrigger>
                                                                        <SelectContent>
                                                                            <SelectItem value="none">—</SelectItem>
                                                                            {dealOwners.map((m) => <SelectItem key={m.userId} value={m.userId}>{m.name}</SelectItem>)}
                                                                        </SelectContent>
                                                                    </Select>
                                                                </PanelField>
                                                            </PanelSection>
                                                        </>
                                                    ) : (
                                                        <div className="rounded-md border border-dashed border-border px-3 py-3 text-center">
                                                            <p className="text-xs text-muted-foreground">Nenhum negócio aberto para este paciente.</p>
                                                            <Button size="sm" variant="outline" className="mt-2 text-xs" onClick={createDealForContact} disabled={creatingDeal}>
                                                                {creatingDeal ? 'Criando…' : 'Abrir negócio'}
                                                            </Button>
                                                        </div>
                                                    )}
                                                </>
                                            ) : null}
                                    </RecordPanel>
                                )}
                            </div> {/* end Chat + Contact Panel layout */}

                        </>
                    )}
                </div>
            </div >

            {/* O atendimento que a clínica começa — ativo ou por ligação. */}
            <NewAttendanceDialog
                open={intakeOpen}
                onOpenChange={setIntakeOpen}
                onDone={(result) => {
                    // A lista primeiro: a conversa nova precisa existir nela
                    // antes de ser selecionada, senão a seleção não encontra o
                    // item e o painel abre vazio.
                    void fetchConversations()
                    handleSelectConversation(result.conversationId)
                    // Ligação não tem mensagem para escrever: o que falta é
                    // marcar a fase, então a Jornada abre junto.
                    setPanel(result.mode === 'call' ? 'journey' : null)
                    if (result.mode === 'active') {
                        setTimeout(() => textareaRef.current?.focus(), 80)
                    }
                }}
            />

            {/* Encaminhar — Dialog, não dois divs fixos: o primitivo trata foco
                preso, Esc, rolagem da página e o rótulo do título para leitor de
                tela. A lista é um Command, então dá para filtrar digitando. */}
            <Dialog open={Boolean(forwardMsg)} onOpenChange={(open) => { if (!open && !forwarding) setForwardMsg(null) }}>
                <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-[440px]">
                    <DialogHeader className="border-b border-border px-4 py-3 text-left">
                        <DialogTitle className="text-sm">Encaminhar para</DialogTitle>
                        <DialogDescription className="truncate text-xs">
                            {forwardMsg?.content || 'Mensagem'}
                        </DialogDescription>
                    </DialogHeader>
                    <Command>
                        <CommandInput placeholder="Buscar conversa…" />
                        <CommandList className="max-h-[50vh]">
                            <CommandEmpty>Nenhuma conversa encontrada.</CommandEmpty>
                            <CommandGroup>
                                {conversations
                                    .filter((c) => c.id !== selectedConversation)
                                    .map((c) => (
                                        <CommandItem
                                            key={c.id}
                                            value={`${c.contact.name ?? ''} ${c.contact.phone ?? ''}`}
                                            disabled={forwarding}
                                            onSelect={() => confirmForward(c.id)}
                                        >
                                            <span className="flex-1 truncate">{c.contact.name || c.contact.phone || 'Sem nome'}</span>
                                            <span className="num text-xs text-muted-foreground">{formatPhone(c.contact.phone)}</span>
                                        </CommandItem>
                                    ))}
                            </CommandGroup>
                        </CommandList>
                    </Command>
                </DialogContent>
            </Dialog>

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
            <ConfirmDialog
                open={showDeleteDialog}
                onOpenChange={setShowDeleteDialog}
                title="Excluir conversa"
                description="Todas as mensagens, áudios, imagens e anexos desta conversa saem do sistema. O paciente permanece."
                confirmLabel="Excluir"
                destructive
                onConfirm={handleDeleteConversation}
            />
        </>
    )
}
