'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, Eraser, Loader2, Search, Send } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useEdicaoNaoSalva } from '@/components/agents/creation/unsaved'
import { cn } from '@/lib/utils'
import { FOLGA_MINIMA, PISO_PADRAO } from '@/lib/rag/parametros'

/**
 * O console de ensaio — homologação dinâmica, sem passar por canal nenhum.
 *
 * O instrutor pergunta o que quiser e lê a resposta aqui mesmo. **Nada de
 * pergunta programada**, por decisão do André: um conjunto fixo de perguntas
 * prova que o agente responde àquelas perguntas, e o que se quer saber é se ele
 * responde às que as pessoas fazem — que mudam com o cliente, com a campanha e
 * com a época do ano.
 *
 * **Sem título dentro do conteúdo**, por decisão do DESIGN.md (Tela 03): a linha
 * das guias já diz a seção e o índice já diz o assunto.
 *
 * ## As três coisas que esta tela mostra e um chat não mostraria
 *
 * Uma resposta errada tem causas opostas que pedem consertos opostos, e sem ver
 * o meio do caminho o instrutor não sabe qual é:
 *
 *   - **a consulta** — o texto com que se buscou, já expandido com o que foi
 *     dito antes. É aqui que se vê que "e quanto custa?" virou "e quanto
 *     custa?\nortodontia";
 *   - **os trechos** e a similaridade de cada um — se o documento certo nem
 *     apareceu, o problema é de escrita ou de corte, não de instrução;
 *   - **o prompt** inteiro — o artefato que explica a resposta.
 *
 * Com isso, "o agente errou o preço" se separa em duas: o documento está errado,
 * ou o documento está certo e a busca não o encontrou.
 */

/**
 * Quantas perguntas cabem num ensaio.
 *
 * A rota corta em 20 **turnos** (`MAX_TURNOS`), e cada pergunta vira dois: a
 * dela e a resposta. Dito aqui para o contador na tela não divergir do erro que
 * o servidor devolveria.
 */
const MAX_PERGUNTAS = 10

interface Trecho {
    title: string
    content: string
    similarity?: number
}

interface Resposta {
    resposta: string
    trechos: Trecho[]
    consulta: string
    prompt: string
    uso: { promptTokens: number; completionTokens: number; totalTokens: number }
    /** O piso de corte do atendimento, dito pela rota. Ver `lib/rag/parametros`. */
    piso?: number
}

/** Um turno já trocado. O do agente carrega o que explica a resposta dele. */
interface Turno {
    de: 'instrutor' | 'agente'
    texto: string
    detalhe?: Omit<Resposta, 'resposta'>
}

interface EnsaioTabProps {
    /**
     * Sem agente gravado não há o que ensaiar.
     *
     * O ensaio lê os documentos **do banco** — é o que garante que ele exercita
     * o mesmo texto que o atendimento usa. Um agente que ainda não foi salvo não
     * tem documento nenhum lá, e um console que respondesse assim estaria
     * ensaiando um agente vazio.
     */
    agentId?: string | null
    canManage?: boolean
}

function Similaridade({ valor, piso }: { valor?: number; piso: number }) {
    if (typeof valor !== 'number') return null
    /**
     * Perto do piso o trecho entrou raspando, e é isso que o instrutor precisa
     * enxergar: um documento que só é encontrado a 0,36 deixa de ser encontrado
     * com qualquer mudança na pergunta.
     *
     * **O piso vem da rota**, com `FOLGA_MINIMA` por cima — era `0.45` cravado
     * aqui, um terceiro número ao lado dos dois do atendimento e do medidor.
     * Com o piso em 0,35, aquele 0,45 chamava de fraco um trecho com 0,10 de
     * folga, que é justamente o que o medidor considera folga suficiente.
     */
    const fraco = valor < piso + FOLGA_MINIMA
    return (
        <span
            className={cn(
                'shrink-0 rounded px-1.5 py-0.5 font-mono text-[11px]',
                fraco
                    ? 'bg-warning-subtle text-warning-subtle-foreground'
                    : 'bg-muted text-muted-foreground'
            )}
            title={fraco ? 'Entrou perto do piso de similaridade — escrita ou corte podem melhorar' : undefined}
        >
            {valor.toFixed(2)}
        </span>
    )
}

/**
 * Guardar este caso: a resposta vira critério de aprovação do agente.
 *
 * É a **única** fonte do conjunto dourado neste produto. A segunda fonte da
 * literatura — o atendente editar uma resposta sugerida antes de enviar — não
 * existe aqui, porque o agente envia direto.
 *
 * Os trechos vão junto, e não são buscados na hora de avaliar: sem isso, a
 * clínica reescreve Serviços e um caso que o instrutor aprovou passa a reprovar
 * sem que a resposta tenha mudado.
 */
function GuardarCaso({
    agentId,
    pergunta,
    resposta,
    trechos,
}: {
    agentId: string
    pergunta: string
    resposta: string
    trechos: Trecho[]
}) {
    const [estado, setEstado] = useState<'parado' | 'enviando' | 'guardado'>('parado')

    if (estado === 'guardado') {
        return <span className="text-[11px] text-success">caso guardado</span>
    }

    const guardar = async () => {
        setEstado('enviando')
        try {
            const res = await fetch(`/api/agents/${agentId}/casos`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    pergunta,
                    referencia: resposta,
                    // O título junto do texto: é o caminho do cabeçalho que o
                    // corte já cola, e é o que o juiz lê como fonte.
                    trechos: trechos.map((t) => `${t.title}\n${t.content}`),
                    tipo: 'aprovado',
                }),
            })
            if (!res.ok) {
                const corpo = await res.json().catch(() => null)
                throw new Error(corpo?.error ?? String(res.status))
            }
            const corpo = await res.json()
            setEstado('guardado')
            toast.success(
                corpo.holdout
                    ? 'Caso guardado — ficou no conjunto congelado de conferência.'
                    : 'Caso guardado no conjunto de avaliação.'
            )
        } catch {
            setEstado('parado')
            toast.error('Não foi possível guardar o caso.')
        }
    }

    return (
        <button
            type="button"
            onClick={guardar}
            disabled={estado === 'enviando'}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-muted disabled:opacity-60"
        >
            <Check className="size-3" aria-hidden="true" />
            {estado === 'enviando' ? 'guardando…' : 'guardar este caso'}
        </button>
    )
}

function DetalheDaResposta({
    detalhe,
    agentId,
    pergunta,
    resposta,
}: {
    detalhe: Omit<Resposta, 'resposta'>
    agentId: string
    /** A fala do instrutor que gerou esta resposta. Vazia no primeiro turno órfão. */
    pergunta: string
    resposta: string
}) {
    const [aberto, setAberto] = useState<'nada' | 'busca' | 'prompt'>('nada')

    return (
        <div className="mt-2 border-t border-border pt-2">
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                <button
                    type="button"
                    onClick={() => setAberto(aberto === 'busca' ? 'nada' : 'busca')}
                    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-muted"
                >
                    <Search className="size-3" aria-hidden="true" />
                    {detalhe.trechos.length === 0
                        ? 'nenhum trecho recuperado'
                        : `${detalhe.trechos.length} trecho${detalhe.trechos.length > 1 ? 's' : ''}`}
                </button>
                <button
                    type="button"
                    onClick={() => setAberto(aberto === 'prompt' ? 'nada' : 'prompt')}
                    className="rounded px-1.5 py-0.5 hover:bg-muted"
                >
                    prompt de {detalhe.prompt.length.toLocaleString('pt-BR')} caracteres
                </button>
                <span className="font-mono">
                    {detalhe.uso.promptTokens.toLocaleString('pt-BR')} +{' '}
                    {detalhe.uso.completionTokens.toLocaleString('pt-BR')} tokens
                </span>
                {pergunta && resposta ? (
                    <GuardarCaso
                        agentId={agentId}
                        pergunta={pergunta}
                        resposta={resposta}
                        trechos={detalhe.trechos}
                    />
                ) : null}
            </div>

            {aberto === 'busca' ? (
                <div className="mt-2 space-y-2">
                    <p className="text-[11px] text-muted-foreground">
                        Buscado por:{' '}
                        <span className="font-mono text-foreground">
                            {detalhe.consulta || '(nada — a pergunta não tinha texto buscável)'}
                        </span>
                    </p>
                    {detalhe.trechos.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                            Nada no Cérebro passou do piso de similaridade. A resposta veio só das
                            instruções e dos documentos de comportamento.
                        </p>
                    ) : (
                        detalhe.trechos.map((t, i) => (
                            <div key={i} className="rounded-lg border border-border bg-background p-2">
                                <div className="flex items-start gap-2">
                                    <span className="min-w-0 flex-1 truncate text-xs font-semibold">
                                        {t.title}
                                    </span>
                                    <Similaridade
                                        valor={t.similarity}
                                        piso={detalhe.piso ?? PISO_PADRAO}
                                    />
                                </div>
                                <p className="mt-1 whitespace-pre-wrap break-words text-xs text-muted-foreground">
                                    {t.content}
                                </p>
                            </div>
                        ))
                    )}
                </div>
            ) : null}

            {aberto === 'prompt' ? (
                <pre className="mt-2 max-h-80 overflow-auto rounded-lg border border-border bg-background p-2 text-[11px] leading-relaxed whitespace-pre-wrap break-words">
                    {detalhe.prompt}
                </pre>
            ) : null}
        </div>
    )
}

export function EnsaioTab({ agentId, canManage = true }: EnsaioTabProps) {
    const [turnos, setTurnos] = useState<Turno[]>([])
    const [pergunta, setPergunta] = useState('')
    const [enviando, setEnviando] = useState(false)
    const haEdicao = useEdicaoNaoSalva()
    const fim = useRef<HTMLDivElement>(null)

    // Rola o que estiver rolando — a faixa do agente, não este componente, é
    // quem tem a barra (Tela 03: só o formulário rola).
    useEffect(() => {
        fim.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }, [turnos, enviando])

    const enviar = async () => {
        const texto = pergunta.trim()
        if (!texto || enviando || !agentId) return
        // Barra aqui em vez de deixar o 400 do servidor: o instrutor perderia a
        // pergunta digitada para descobrir um limite que a tela já conhece.
        if (turnos.filter((t) => t.de === 'instrutor').length >= MAX_PERGUNTAS) {
            toast.error(`Um ensaio cabe em ${MAX_PERGUNTAS} perguntas. Limpe para começar outro.`)
            return
        }

        const comPergunta: Turno[] = [...turnos, { de: 'instrutor', texto }]
        setTurnos(comPergunta)
        setPergunta('')
        setEnviando(true)

        try {
            const resposta = await fetch(`/api/agents/${agentId}/ensaio`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    turnos: comPergunta.map((t) => ({ de: t.de, texto: t.texto })),
                }),
            })

            const corpo = (await resposta.json().catch(() => ({}))) as Partial<Resposta> & {
                error?: string
            }

            if (!resposta.ok) {
                // A pergunta volta para a caixa: perder o que foi digitado por
                // causa de um erro de rede é o pior jeito de falhar.
                setTurnos(turnos)
                setPergunta(texto)
                toast.error(corpo.error ?? 'Não foi possível ensaiar agora.')
                return
            }

            setTurnos([
                ...comPergunta,
                {
                    de: 'agente',
                    texto: corpo.resposta ?? '',
                    detalhe: {
                        trechos: corpo.trechos ?? [],
                        consulta: corpo.consulta ?? '',
                        prompt: corpo.prompt ?? '',
                        uso: corpo.uso ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
                        /**
                         * **O piso da rota não chegava aqui.**
                         *
                         * `Resposta.piso` existia no tipo e a rota o devolvia, mas
                         * `enviar()` não o copiava para o detalhe — então a régua
                         * de "trecho fraco" caía sempre no `PISO_PADRAO`
                         * compilado, e mudar `AI_RAG_MIN_SIMILARITY` não mudava
                         * nada na tela. Era o mesmo defeito que o passo 1
                         * consertou nos outros dois lugares, sobrando num
                         * terceiro.
                         */
                        piso: typeof corpo.piso === 'number' ? corpo.piso : undefined,
                    },
                },
            ])
        } catch {
            setTurnos(turnos)
            setPergunta(texto)
            toast.error('Não foi possível ensaiar agora.')
        } finally {
            setEnviando(false)
        }
    }

    if (!agentId) {
        return (
            <p className="text-sm text-muted-foreground">
                Salve o agente para poder ensaiar. O ensaio conversa com os documentos{' '}
                <strong className="font-semibold text-foreground">gravados</strong>, e é por isso
                que ele vale como homologação: é o mesmo texto que o agente usa no atendimento.
            </p>
        )
    }

    if (!canManage) {
        return (
            <p className="text-sm text-muted-foreground">
                Ensaiar o agente é do dono ou do administrador da clínica — a conversa de teste
                consome crédito de IA da conta.
            </p>
        )
    }

    return (
        <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
                Pergunte o que um cliente perguntaria e leia a resposta aqui. Nada é enviado por
                WhatsApp e nada fica gravado na conversa de ninguém. Cada resposta consome{' '}
                <strong className="font-semibold text-foreground">1 crédito de IA</strong>, como um
                atendimento.
            </p>

            {haEdicao ? (
                <div className="flex items-start gap-2 rounded-lg border border-warning bg-warning-subtle px-4 py-3 text-xs text-warning-subtle-foreground">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                    <p>
                        Você tem alterações não salvas. O ensaio usa o que está{' '}
                        <strong className="font-semibold">gravado</strong> — salve antes, ou vai
                        testar a versão anterior dos documentos.
                    </p>
                </div>
            ) : null}

            {turnos.length > 0 ? (
                <div className="space-y-3">
                    {turnos.map((turno, i) => (
                        <div
                            key={i}
                            className={cn(
                                'rounded-lg border px-3 py-2 text-sm',
                                turno.de === 'instrutor'
                                    ? 'ml-auto max-w-[85%] border-border bg-muted/50'
                                    : 'mr-auto max-w-[95%] border-border bg-background'
                            )}
                        >
                            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                {turno.de === 'instrutor' ? 'Você' : 'Agente'}
                            </p>
                            <p className="whitespace-pre-wrap break-words">{turno.texto}</p>
                            {turno.detalhe && agentId ? (
                                <DetalheDaResposta
                                    detalhe={turno.detalhe}
                                    agentId={agentId}
                                    // O turno anterior é a pergunta que gerou
                                    // esta resposta. Vazio no histórico que
                                    // começa com o agente, e aí o botão não
                                    // aparece: caso sem pergunta não é caso.
                                    pergunta={turnos[i - 1]?.de === 'instrutor' ? turnos[i - 1].texto : ''}
                                    resposta={turno.texto}
                                />
                            ) : null}
                        </div>
                    ))}
                </div>
            ) : null}

            {enviando ? (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                    O agente está pensando…
                </p>
            ) : null}

            <div ref={fim} className="space-y-2">
                <Textarea
                    value={pergunta}
                    onChange={(e) => setPergunta(e.target.value)}
                    onKeyDown={(e) => {
                        // Enter envia, Shift+Enter quebra linha — é o que a mão
                        // já espera de uma caixa de conversa.
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault()
                            void enviar()
                        }
                    }}
                    /* Pergunta de endereço, e não de preço, a pedido do Andre
                       em 2026-11-05. Serve melhor como primeiro teste: a
                       resposta sai de Informações sobre a empresa, que é
                       documento de prompt e vale em qualquer conta — preço
                       depende de Serviços estar preenchido, e num agente novo
                       o ensaio começaria por um "não sei informar". */
                    placeholder="Qual é o endereço de vocês?"
                    rows={3}
                    disabled={enviando}
                    className="resize-y"
                />
                <div className="flex items-center gap-2">
                    <Button type="button" onClick={() => void enviar()} disabled={enviando || !pergunta.trim()}>
                        {enviando ? (
                            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                        ) : (
                            <Send className="size-4" aria-hidden="true" />
                        )}
                        Perguntar
                    </Button>
                    {turnos.length > 0 ? (
                        <Button
                            type="button"
                            variant="ghost"
                            onClick={() => setTurnos([])}
                            disabled={enviando}
                        >
                            <Eraser className="size-4" aria-hidden="true" />
                            Limpar ensaio
                        </Button>
                    ) : null}
                    <span className="ml-auto text-[11px] text-muted-foreground">
                        {turnos.filter((t) => t.de === 'instrutor').length}/{MAX_PERGUNTAS}{' '}
                        perguntas
                    </span>
                </div>
            </div>
        </div>
    )
}
