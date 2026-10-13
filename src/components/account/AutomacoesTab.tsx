'use client'

import { useEffect, useState } from 'react'
import { Loader2, Sparkles, Sun } from 'lucide-react'
import { toast } from 'sonner'

import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { SettingsCard } from '@/components/shared/TabsFrame'
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
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Carregando…
            </p>
        )
    }

    return (
        <SettingsCard
            title="Rotinas automáticas"
            description="O que o sistema faz sozinho todo dia. Grava ao mudar — não há botão Salvar."
            contentClassName="p-0"
            footer={
                <p className="text-xs leading-relaxed text-muted-foreground">
                    Nenhuma destas chaves envia mensagem a paciente. Falar sozinho com quem está em
                    atendimento é decisão de cada fase, em <strong>Negócios → Fases</strong>.
                    {saving ? ' · salvando…' : ''}
                </p>
            }
        >
            <div className="divide-y divide-border">
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
        </SettingsCard>
    )
}

function Line({
    icon: Icon,
    title,
    hint,
    checked,
    onChange,
    extra,
}: {
    icon: typeof Sun
    title: string
    hint: string
    checked: boolean
    onChange: (checked: boolean) => void
    extra?: React.ReactNode
}) {
    const id = `automation-${title.toLowerCase().replace(/\s+/g, '-')}`
    return (
        <div className="flex items-start gap-3 p-4">
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-subtle text-primary-subtle-foreground">
                <Icon className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
                <Label htmlFor={id} className="text-sm font-semibold">{title}</Label>
                <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
            </div>
            {extra}
            <Switch id={id} checked={checked} onCheckedChange={onChange} />
        </div>
    )
}
