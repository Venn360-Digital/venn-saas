'use client'

import { useEffect, useState } from 'react'
import { Loader2, Shuffle, Sparkles, Sun, UserCheck } from 'lucide-react'
import { toast } from 'sonner'

import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { BandLayout, SettingsBand } from '@/components/shared/TabsFrame'
import { DEFAULT_AUTOMATIONS, type Automations } from '@/lib/automations'

/**
 * O que a clínica deixa o sistema fazer sozinho.
 *
 * Tudo aqui acontece **para dentro**: cria tarefa, avisa quem atende, resume a
 * manhã. Nenhuma destas chaves manda mensagem para paciente — essa é a chave da
 * fase, em Negócios, e fica lá de propósito: a decisão de falar com o paciente
 * pertence ao lugar onde a jornada é desenhada, não a um painel de ajustes.
 *
 * Grava ao mudar, como o painel do negócio: a tela não tem botão Salvar porque
 * não tem modo de edição.
 */
export function AutomacoesTab() {
    const [config, setConfig] = useState<Automations | null>(null)
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        let cancelled = false
        fetch('/api/workspace/automations')
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => {
                if (!cancelled) setConfig(data ?? DEFAULT_AUTOMATIONS)
            })
            .catch(() => {
                if (!cancelled) setConfig(DEFAULT_AUTOMATIONS)
            })
        return () => { cancelled = true }
    }, [])

    const save = async (patch: Partial<Automations>) => {
        setConfig((prev) => (prev ? { ...prev, ...patch } : prev))
        setSaving(true)
        try {
            const res = await fetch('/api/workspace/automations', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(patch),
            })
            if (!res.ok) {
                const err = await res.json().catch(() => ({}))
                toast.error(err.error || 'Não foi possível salvar')
            }
        } finally {
            setSaving(false)
        }
    }

    if (!config) {
        return (
            <p className="flex items-center gap-2 p-5 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Carregando…
            </p>
        )
    }

    return (
        <BandLayout
            footer={
                <p className="mr-auto text-xs leading-relaxed text-muted-foreground">
                    Nenhuma destas chaves envia mensagem a paciente. Falar sozinho com quem está em
                    atendimento é decisão de cada fase, em <strong>Negócios → Fases</strong>.
                    {saving ? ' · salvando…' : ''}
                </p>
            }
        >
            {/* ─── Distribuição ────────────────────────────────────────
                Vem antes das rotinas porque muda **quem trabalha**, e não o
                que o sistema faz sozinho. É o ajuste que a clínica mexe na
                primeira semana. ──────────────────────────────────────────── */}
            {/* "Atribuir conversas", e a legenda sem a segunda metade —
                pedido do Andre em 2026-11-09. A frase cortada explicava o que
                ser responsável significa ("quem responde por ela quando uma
                pessoa precisar entrar"); isso é vocabulário do produto, dito
                em toda a tela de Conversas, e aqui só alongava a legenda de um
                seletor de três opções. */}
            <SettingsBand
                title="Atribuir conversas"
                description="Quem fica responsável por cada conversa nova. O agente continua atendendo."
            >
                <div className="divide-y divide-border rounded-lg border border-border">
                    <div className="flex items-start gap-3 p-4">
                        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-subtle text-primary-subtle-foreground">
                            <Shuffle className="size-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                            <Label htmlFor="estrategia" className="text-sm font-semibold">
                                Como distribuir
                            </Label>
                            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                                {config.distribuicao.estrategia === 'rodizio'
                                    ? 'Cada conversa vai para quem recebeu há mais tempo. É igual em quantidade: foi sua vez.'
                                    : config.distribuicao.estrategia === 'balanceado'
                                      ? 'Cada conversa vai para quem tem menos conversas abertas. É igual em carga, não em quantidade.'
                                      : 'Ninguém fica responsável automaticamente. As conversas ficam na fila geral, como hoje.'}
                            </p>
                        </div>
                        <Select
                            value={config.distribuicao.estrategia}
                            onValueChange={(v) =>
                                void save({
                                    distribuicao: {
                                        ...config.distribuicao,
                                        estrategia: v as Automations['distribuicao']['estrategia'],
                                    },
                                })
                            }
                        >
                            <SelectTrigger size="sm" className="w-[150px]" id="estrategia">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="nenhuma">Não distribuir</SelectItem>
                                <SelectItem value="rodizio">Rodízio</SelectItem>
                                <SelectItem value="balanceado">Balanceado</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Desabilitado em vez de escondido quando não há
                        distribuição: esconder faz a pessoa concluir que a
                        opção não existe, e procurar por ela em outro lugar. */}
                    <Line
                        icon={UserCheck}
                        title="Atribuir conversas para status disponível"
                        hint={
                            config.distribuicao.estrategia === 'nenhuma'
                                ? 'Escolha uma forma de distribuir para usar esta opção.'
                                : 'Ligue se a empresa tem turnos: só quem está marcado como disponível recebe. Desligado, a conversa que chega de madrugada ganha responsável assim mesmo, e quem começa o expediente já tem o que fazer.'
                        }
                        checked={config.distribuicao.soDisponiveis}
                        disabled={config.distribuicao.estrategia === 'nenhuma'}
                        onChange={(v) =>
                            void save({ distribuicao: { ...config.distribuicao, soDisponiveis: v } })
                        }
                    />

                    {/* Vale mesmo sem distribuição: o status também decide para
                        quem vai a entrega quando o agente passa o atendimento. */}
                    <div className="flex items-start gap-3 p-4">
                        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-subtle text-primary-subtle-foreground">
                            <Sun className="size-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                            <Label htmlFor="ausente" className="text-sm font-semibold">
                                Marcar como ausente sozinho — padrão da conta
                            </Label>
                            {/* **Este é o padrão; a ficha de cada pessoa
                                sobrepõe.** Os dois campos existem e os dois
                                valem — a pergunta do Andre em 2026-11-09. O
                                valor efetivo é `wu.minutosParaAusente ?? este`
                                (ver `src/app/api/equipe/route.ts`): quem tem o
                                campo Ausência preenchido na ficha usa o dele,
                                quem não tem herda daqui. Sem dizer "padrão da
                                conta" no rótulo, os dois pareciam concorrer. */}
                            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                                Depois deste tempo sem usar o sistema, quem está disponível fica
                                amarelo — e depois de 8 horas, cinza. Volta a verde sozinho ao
                                mexer. Quem se marcou como ocupado ou ausente fica como se pôs.
                                Vale para quem não tem <strong>Ausência</strong> preenchida na
                                própria ficha, em Usuários.
                            </p>
                        </div>
                        <Select
                            value={String(config.minutosParaAusente)}
                            onValueChange={(v) => void save({ minutosParaAusente: Number(v) })}
                        >
                            <SelectTrigger size="sm" className="w-[120px]" id="ausente">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="0">Nunca</SelectItem>
                                {[15, 30, 60, 120, 240].map((m) => (
                                    <SelectItem key={m} value={String(m)} className="num">
                                        {m < 60 ? `${m} minutos` : m === 60 ? '1 hora' : `${m / 60} horas`}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>
            </SettingsBand>

            <SettingsBand
                title="Rotinas automáticas"
                description="O que o sistema faz sozinho todo dia. Grava ao mudar — não há botão Salvar."
                last
            >
                <div className="divide-y divide-border rounded-lg border border-border">
                    <Line
                        icon={Sparkles}
                        title="Criar tarefa de retomada"
                        hint="Todo dia de manhã, pacientes parados sem retorno marcado viram tarefa para o responsável. Usa o prazo de cada fase, definido em Negócios → Fases."
                        checked={config.followUpTasks}
                        onChange={(v) => void save({ followUpTasks: v })}
                    />

                    <Line
                        icon={Sun}
                        title="Boletim da manhã"
                        hint="Três números e os nomes de quem ligar primeiro, para quem abre a clínica."
                        checked={config.briefing}
                        onChange={(v) => void save({ briefing: v })}
                        extra={
                            <Select
                                value={String(config.briefingHour)}
                                onValueChange={(v) => void save({ briefingHour: Number(v) })}
                            >
                                <SelectTrigger size="sm" className="w-[86px]" aria-label="Hora do boletim">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {Array.from({ length: 24 }, (_, h) => (
                                        <SelectItem key={h} value={String(h)} className="num">
                                            {String(h).padStart(2, '0')}:00
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        }
                    />
                </div>
            </SettingsBand>
        </BandLayout>
    )
}

function Line({
    icon: Icon,
    title,
    hint,
    checked,
    onChange,
    extra,
    disabled,
}: {
    icon: typeof Sun
    title: string
    hint: string
    checked: boolean
    onChange: (checked: boolean) => void
    extra?: React.ReactNode
    disabled?: boolean
}) {
    const id = `automation-${title.toLowerCase().replace(/\s+/g, '-')}`
    return (
        <div className={`flex items-start gap-3 p-4${disabled ? ' opacity-60' : ''}`}>
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-subtle text-primary-subtle-foreground">
                <Icon className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
                <Label htmlFor={id} className="text-sm font-semibold">{title}</Label>
                <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
            </div>
            {extra}
            <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
        </div>
    )
}
