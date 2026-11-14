'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, MessageCircle, X } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@venn/ui/button'
import { Checkbox } from '@venn/ui/checkbox'
import { Input } from '@venn/ui/input'
import { Label } from '@venn/ui/label'
import { hostDe, type ConfiguracaoDoWidget } from '@/lib/widget-config'
import { AGENT_WIDGET_DEFAULTS, TINTA_DO_WIDGET } from '@/lib/palette'
import { cn } from '@venn/ui/utils'

/**
 * A configuração do widget do site: aparência, domínios e captura.
 *
 * ## Por que num componente próprio
 *
 * `CanaisTab` tem 1.188 linhas e cuida de seis canais. Este formulário tem
 * quatro faixas e uma pré-visualização; enfiá-lo lá dentro faria a aba do
 * WhatsApp carregar o widget do site junto. Aqui ele é montado só quando a
 * clínica abre a seção.
 *
 * ## A pré-visualização não é enfeite
 *
 * Cor, formato, lado e saudação só existem como escolha quando se vê o
 * resultado. Sem ela, a pessoa escolhe um marinho no seletor, salva, abre o
 * site num navegador anônimo, não gosta, e volta — quatro passos para uma
 * decisão de dois segundos. Ela reproduz o que `widget.js` desenha, com os
 * mesmos cortes de cor.
 *
 * **A foto é a do agente**, de Treinamento → Perfil. Uma segunda foto só do
 * widget daria dois lugares para manter a mesma cara.
 */

/**
 * A mesma conta de luminância do `widget.js`: a cor escolhida decide a tinta
 * que vai por cima dela. As duas tintas vêm de `lib/palette.ts`, que é onde
 * mora todo hex literal do produto — o `widget.js` repete a conta porque roda
 * fora do bundle, mas os valores são os mesmos.
 */
function sobre(cor: string): string {
    let h = cor.replace('#', '')
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
    if (h.length !== 6) return TINTA_DO_WIDGET.sobreClaro
    const c = [0, 2, 4].map((i) => {
        const v = parseInt(h.substring(i, i + 2), 16) / 255
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
    })
    const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
    return l > 0.55 ? TINTA_DO_WIDGET.sobreClaro : TINTA_DO_WIDGET.sobreEscuro
}

interface Props {
    agentId: string
    canManage: boolean
    inicial: ConfiguracaoDoWidget
    onSalvo: (config: ConfiguracaoDoWidget) => void
}

interface Agente {
    nome: string
    empresa: string | null
    avatar: string | null
    saudacao: string | null
}

export function WidgetDoSite({ agentId, canManage, inicial, onSalvo }: Props) {
    const [config, setConfig] = useState<ConfiguracaoDoWidget>(inicial)
    const [dominioNovo, setDominioNovo] = useState('')
    const [salvando, setSalvando] = useState(false)

    /**
     * O agente é buscado **aqui**, e só quando esta seção abre.
     *
     * A prévia precisa do nome, da foto e da mensagem inicial para mostrar o
     * que de fato vai ao ar quando os campos estão em branco — em branco eles
     * significam "use o do agente", e uma prévia que mostrasse os campos vazios
     * mentiria sobre o resultado. Buscar na aba Canais faria toda visita a ela
     * carregar o agente para desenhar o WhatsApp.
     */
    const [agente, setAgente] = useState<Agente>({
        nome: 'Atendimento',
        empresa: null,
        avatar: null,
        saudacao: null,
    })

    const carregarAgente = useCallback(async () => {
        try {
            const res = await fetch(`/api/agents/${agentId}`)
            if (!res.ok) return
            const a = await res.json()
            setAgente({
                nome: a.name ?? 'Atendimento',
                empresa: a.companyName ?? null,
                avatar: a.avatar ?? null,
                saudacao: a.initialMessage?.trim() || null,
            })
        } catch {
            // Sem o agente a prévia usa os genéricos; o formulário grava igual.
        }
    }, [agentId])

    useEffect(() => {
        // Busca ao montar, que é quando a seção abre. A regra é do compilador e
        // não acompanha função assíncrona — mesma situação do `Topbar`.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void carregarAgente()
    }, [carregarAgente])

    const muda = (patch: Partial<ConfiguracaoDoWidget>) =>
        setConfig((atual) => ({ ...atual, ...patch }))

    const corEfetiva = config.cor || AGENT_WIDGET_DEFAULTS.primaryColor
    const nomeEfetivo = config.nomeExibido || agente.nome
    const saudacaoEfetiva = config.saudacao || agente.saudacao || `Olá! Sou ${nomeEfetivo}. Como posso ajudar?`

    const acrescentarDominio = () => {
        const host = hostDe(dominioNovo)
        if (!host) {
            toast.error('Endereço inválido. Use o domínio, como clinicasorriso.com.br')
            return
        }
        if (config.dominios.includes(host)) {
            toast.error('Esse domínio já está na lista.')
            return
        }
        muda({ dominios: [...config.dominios, host] })
        setDominioNovo('')
    }

    const salvar = async () => {
        setSalvando(true)
        try {
            const res = await fetch(`/api/agents/${agentId}/integrations/site`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(config),
            })
            const corpo = await res.json().catch(() => ({}))
            if (!res.ok) {
                toast.error(corpo.error ?? 'Não foi possível salvar a configuração')
                return
            }
            // O servidor saneia: o que volta é o que vale, e a tela passa a
            // mostrar isso em vez do que foi digitado.
            setConfig(corpo.config ?? config)
            onSalvo(corpo.config ?? config)
            toast.success('Configuração do widget salva')
        } finally {
            setSalvando(false)
        }
    }

    const campos = [
        { chave: 'nome' as const, rotulo: 'Nome' },
        { chave: 'whatsapp' as const, rotulo: 'WhatsApp' },
        { chave: 'email' as const, rotulo: 'E-mail' },
    ]
    const pedeAlgo = campos.some((c) => config.captura[c.chave])

    return (
        <div className="mt-3 grid gap-4 rounded-lg border border-border bg-muted/20 p-4 lg:grid-cols-[minmax(0,1fr)_260px]">
            <fieldset disabled={!canManage} className="min-w-0 space-y-4">
                {/* APARÊNCIA */}
                <Faixa titulo="Aparência" descricao="Formato, cor e lado da tela do visitante.">
                    <div className="grid gap-3 sm:grid-cols-3">
                        <div className="space-y-1.5">
                            <Label className="text-xs">Formato</Label>
                            <ParDeBotoes
                                valor={config.formato}
                                opcoes={[
                                    { v: 'bolha', r: 'Bolha' },
                                    { v: 'balao', r: 'Balão' },
                                ]}
                                onChange={(formato) => muda({ formato })}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-xs">Posição</Label>
                            <ParDeBotoes
                                valor={config.posicao}
                                opcoes={[
                                    { v: 'esquerda', r: 'Esquerda' },
                                    { v: 'direita', r: 'Direita' },
                                ]}
                                onChange={(posicao) => muda({ posicao })}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="widget-cor" className="text-xs">
                                Cor principal
                            </Label>
                            <div className="flex h-9 items-center gap-2 rounded-md border border-border bg-card px-2">
                                {/* `type=color` e não uma paleta nossa: é o seletor
                                    do sistema operacional, que a pessoa já sabe usar,
                                    e ele devolve `#rrggbb` — o formato que o saneador
                                    aceita, sem conversão no meio. */}
                                <input
                                    id="widget-cor"
                                    type="color"
                                    value={corEfetiva}
                                    onChange={(e) => muda({ cor: e.target.value })}
                                    className="size-5 cursor-pointer rounded border-0 bg-transparent p-0"
                                    aria-label="Cor principal do widget"
                                />
                                <span className="num text-[12.5px] uppercase">{corEfetiva}</span>
                                {config.cor ? (
                                    <button
                                        type="button"
                                        onClick={() => muda({ cor: null })}
                                        className="ml-auto text-[11px] text-muted-foreground hover:text-foreground"
                                    >
                                        usar a do agente
                                    </button>
                                ) : null}
                            </div>
                        </div>
                    </div>
                </Faixa>

                {/* QUEM ATENDE */}
                <Faixa
                    titulo="Quem atende"
                    descricao="Como o visitante vê quem fala com ele. A foto é a do agente, em Treinamento → Perfil."
                >
                    <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                            <Label htmlFor="widget-nome" className="text-xs">
                                Nome exibido
                            </Label>
                            <Input
                                id="widget-nome"
                                value={config.nomeExibido ?? ''}
                                onChange={(e) => muda({ nomeExibido: e.target.value || null })}
                                placeholder={agente.nome}
                                maxLength={60}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="widget-saudacao" className="text-xs">
                                Saudação inicial
                            </Label>
                            <Input
                                id="widget-saudacao"
                                value={config.saudacao ?? ''}
                                onChange={(e) => muda({ saudacao: e.target.value || null })}
                                placeholder={agente.saudacao ?? 'Olá! Como posso ajudar?'}
                                maxLength={300}
                            />
                        </div>
                    </div>
                </Faixa>

                {/* DOMÍNIOS */}
                <Faixa
                    titulo="Domínios autorizados"
                    descricao={
                        config.dominios.length === 0
                            ? 'A lista está vazia: o widget abre em qualquer página onde o código for colado, inclusive numa cópia dele.'
                            : 'Fora desta lista o widget não abre. Subdomínios do que está listado valem.'
                    }
                >
                    <div className="flex gap-2">
                        <Input
                            value={dominioNovo}
                            onChange={(e) => setDominioNovo(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault()
                                    acrescentarDominio()
                                }
                            }}
                            placeholder="clinicasorriso.com.br"
                            aria-label="Domínio autorizado"
                        />
                        <Button type="button" variant="outline" onClick={acrescentarDominio}>
                            Adicionar
                        </Button>
                    </div>
                    {config.dominios.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                            {config.dominios.map((d) => (
                                <span
                                    key={d}
                                    className="inline-flex h-7 items-center gap-1.5 rounded-full bg-muted pl-3 pr-1.5 text-xs"
                                >
                                    {d}
                                    <button
                                        type="button"
                                        aria-label={`Remover ${d}`}
                                        onClick={() =>
                                            muda({ dominios: config.dominios.filter((x) => x !== d) })
                                        }
                                        className="flex size-4 items-center justify-center rounded-full bg-border text-foreground hover:bg-border-strong"
                                    >
                                        <X className="size-2.5" aria-hidden="true" />
                                    </button>
                                </span>
                            ))}
                        </div>
                    ) : null}
                </Faixa>

                {/* CAPTURA */}
                <Faixa
                    titulo="Captura de contato"
                    descricao="O que pedir antes da conversa. Cada campo a mais derruba a taxa de início — peça o mínimo que permita retomar depois."
                >
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5">
                        {campos.map(({ chave, rotulo }) => (
                            <Label key={chave} className="flex items-center gap-2 text-[12.5px] font-normal">
                                <Checkbox
                                    checked={config.captura[chave]}
                                    onCheckedChange={(v) =>
                                        muda({ captura: { ...config.captura, [chave]: v === true } })
                                    }
                                />
                                {rotulo}
                            </Label>
                        ))}
                        <span aria-hidden="true" className="h-4 w-px bg-border" />
                        <Label
                            className={cn(
                                'flex items-center gap-2 text-[12.5px] font-normal',
                                !pedeAlgo && 'opacity-50'
                            )}
                        >
                            <Checkbox
                                checked={config.captura.obrigatorio}
                                // Sem campo não há o que exigir, e exigir o nada
                                // travaria a conversa atrás de um formulário vazio.
                                disabled={!pedeAlgo}
                                onCheckedChange={(v) =>
                                    muda({ captura: { ...config.captura, obrigatorio: v === true } })
                                }
                            />
                            Obrigatório para iniciar
                        </Label>
                    </div>
                </Faixa>
            </fieldset>

            <div className="space-y-2">
                <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    Como o visitante vê
                </p>
                <Previa
                    formato={config.formato}
                    posicao={config.posicao}
                    cor={corEfetiva}
                    nome={nomeEfetivo}
                    empresa={agente.empresa}
                    avatar={agente.avatar}
                    saudacao={saudacaoEfetiva}
                    captura={config.captura}
                />
                {canManage ? (
                    <Button
                        type="button"
                        className="w-full"
                        onClick={() => void salvar()}
                        disabled={salvando}
                    >
                        {salvando ? <Loader2 className="size-4 animate-spin" /> : null}
                        Salvar configuração
                    </Button>
                ) : null}
            </div>
        </div>
    )
}

function Faixa({
    titulo,
    descricao,
    children,
}: {
    titulo: string
    descricao: string
    children: React.ReactNode
}) {
    return (
        <section className="border-t border-border pt-3.5 first:border-t-0 first:pt-0">
            <h3 className="text-[13px] font-semibold">{titulo}</h3>
            <p className="mb-2.5 mt-0.5 text-xs leading-snug text-muted-foreground">{descricao}</p>
            {children}
        </section>
    )
}

function ParDeBotoes<T extends string>({
    valor,
    opcoes,
    onChange,
}: {
    valor: T
    opcoes: { v: T; r: string }[]
    onChange: (v: T) => void
}) {
    return (
        <div className="flex gap-1.5">
            {opcoes.map(({ v, r }) => (
                <button
                    key={v}
                    type="button"
                    aria-pressed={valor === v}
                    onClick={() => onChange(v)}
                    className={cn(
                        'h-9 flex-1 rounded-md border text-xs transition-colors',
                        valor === v
                            ? 'border-primary bg-primary-subtle font-semibold text-primary-subtle-foreground'
                            : 'border-border bg-card text-muted-foreground hover:text-foreground'
                    )}
                >
                    {r}
                </button>
            ))}
        </div>
    )
}

/** O que `widget.js` desenha, reproduzido aqui — mesma cor, mesmo corte. */
function Previa({
    formato,
    posicao,
    cor,
    nome,
    empresa,
    avatar,
    saudacao,
    captura,
}: {
    formato: 'bolha' | 'balao'
    posicao: 'esquerda' | 'direita'
    cor: string
    nome: string
    empresa: string | null
    avatar: string | null
    saudacao: string
    captura: ConfiguracaoDoWidget['captura']
}) {
    const tinta = sobre(cor)
    const pedidos = [
        captura.nome ? 'Seu nome' : null,
        captura.whatsapp ? 'Seu WhatsApp' : null,
        captura.email ? 'Seu e-mail' : null,
    ].filter(Boolean) as string[]

    const retrato = avatar ? (
        // Origem variável (Storage), fora do alcance do next/image sem
        // configurar remotePatterns.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatar} alt="" className="size-7 shrink-0 rounded-full object-cover" />
    ) : (
        <span
            className="flex size-7 shrink-0 items-center justify-center rounded-full bg-black/15 text-[11px] font-bold"
            aria-hidden="true"
        >
            {nome.trim().charAt(0).toUpperCase()}
        </span>
    )

    return (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="flex h-7 items-center gap-1.5 border-b border-border bg-muted px-2.5">
                <span className="size-1.5 rounded-full bg-border-strong" />
                <span className="size-1.5 rounded-full bg-border-strong" />
                <span className="num ml-1 text-[9.5px] text-muted-foreground">seusite.com.br</span>
            </div>

            <div className="space-y-1.5 px-2.5 py-2.5">
                <span className="block h-2 w-3/5 rounded bg-muted" />
                <span className="block h-1.5 w-full rounded bg-muted/70" />
                <span className="block h-1.5 w-4/5 rounded bg-muted/70" />
            </div>

            {/* O painel aberto, com a saudação e a ficha quando há captura. */}
            <div className="px-2.5 pb-1">
                <div className="overflow-hidden rounded-lg border border-border">
                    <div
                        className="flex items-center gap-2 px-2.5 py-2"
                        style={{ background: cor, color: tinta }}
                    >
                        {retrato}
                        <div className="min-w-0">
                            <p className="truncate text-[11px] font-semibold">{nome}</p>
                            {empresa ? (
                                <p className="truncate text-[9.5px] opacity-75">{empresa}</p>
                            ) : null}
                        </div>
                    </div>
                    <div className="space-y-1.5 bg-background p-2">
                        <p className="max-w-[88%] rounded-lg rounded-bl-sm border border-border bg-card px-2 py-1.5 text-[10.5px] leading-snug">
                            {saudacao}
                        </p>
                        {pedidos.length > 0 ? (
                            <div className="space-y-1 rounded-md border border-border bg-card p-2">
                                <p className="text-[9.5px] text-muted-foreground">
                                    {captura.obrigatorio ? 'Para começar, me diga:' : 'Deixe seu contato:'}
                                </p>
                                {pedidos.map((p) => (
                                    <span
                                        key={p}
                                        className="block rounded border border-border px-1.5 py-1 text-[9.5px] text-muted-foreground"
                                    >
                                        {p}
                                    </span>
                                ))}
                            </div>
                        ) : null}
                    </div>
                </div>
            </div>

            {/* A bolha ou o balão, no lado escolhido. */}
            <div
                className={cn(
                    'flex px-2.5 pb-2.5 pt-1',
                    posicao === 'direita' ? 'justify-end' : 'justify-start'
                )}
            >
                {formato === 'balao' ? (
                    <span
                        className="flex max-w-full items-center gap-1.5 rounded-full py-1 pl-1 pr-3"
                        style={{ background: cor, color: tinta }}
                    >
                        {retrato}
                        <span className="truncate text-[10.5px] font-semibold">{saudacao}</span>
                    </span>
                ) : (
                    <span
                        className="flex size-9 items-center justify-center rounded-full"
                        style={{ background: cor, color: tinta }}
                    >
                        {avatar ? retrato : <MessageCircle className="size-4" aria-hidden="true" />}
                    </span>
                )}
            </div>
        </div>
    )
}
