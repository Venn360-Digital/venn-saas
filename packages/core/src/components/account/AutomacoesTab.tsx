'use client'

import { useEffect, useState } from 'react'
import { Loader2, Shuffle, Sparkles, Sun, UserCheck } from 'lucide-react'
import { toast } from 'sonner'

import { Label } from '@venn/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@venn/ui/select'
import { Switch } from '@venn/ui/switch'
import { BandLayout, SettingsBand } from '../shared/TabsFrame'
import { DEFAULT_AUTOMATIONS, type Automations } from '../../lib/automations'
import { useVocab } from '../../hooks/useVocab'
import { comArtigo } from '../../lib/concordancia'

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
    const v = useVocab()

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
                    Nenhuma destas chaves envia mensagem a {v.pessoa}. Falar sozinho com quem está em
                    atendimento é decisão de cada fase, em <strong>Negócios → Fases</strong>.
                    {saving ? ' · salvando…' : ''}
                </p>
            }
        >
            {/* ─── Distribuição ────────────────────────────────────────
                Vem antes das rotinas porque muda **quem trabalha**, e não o
                que o sistema faz sozinho. É o ajuste que a clínica mexe na
                primeira semana. ──────────────────────────────────────────── */}
            {/* A legenda sem a segunda metade — pedido do Andre em
                2026-11-09. A frase cortada explicava o que ser responsável
                significa ("quem responde por ela quando uma pessoa precisar
                entrar"); isso é vocabulário do produto, dito em toda a tela de
                Conversas, e aqui só alongava a legenda de um seletor de três
                opções.

                **O título mudou de "Atribuir conversas" para o nome que o
                Andre deu à regra em 20/11/2026**: "a regra é da distribuição
                de conversas, que agora chama Regra de distribuição de
                conversas e e-mails". Não é só rótulo — o lead de formulário
                que chega só com e-mail passou a ganhar responsável por aqui
                (`proximoResponsavel`), e a seção "Depois do envio" do editor de
                formulários aponta para esta faixa por este nome. Nome diferente
                do link seria mandar a pessoa procurar o que não existe. O campo
                abaixo continua dizendo "Como atribuir", que foi a escolha dele
                em 2026-11-09 e segue valendo para o verbo. */}
            <SettingsBand
                title="Regra de distribuição de conversas e e-mails"
                description="Quem fica responsável por cada conversa nova e por cada lead de formulário. O agente continua atendendo."
            >
                <div className="divide-y divide-border rounded-lg border border-border">
                    <div className="flex items-start gap-3 p-4">
                        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-subtle text-primary-subtle-foreground">
                            <Shuffle className="size-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                            {/* "Como atribuir", não "Como distribuir" — pedido
                                do Andre em 2026-11-09. A faixa já se chama
                                "Atribuir conversas"; o campo tinha de falar o
                                mesmo verbo. */}
                            <Label htmlFor="estrategia" className="text-sm font-semibold">
                                Como atribuir
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

                    {/* **"Marcar como ausente sozinho" saiu daqui** — decisão
                        do Andre em 2026-11-09: fica **um** controle só, o da
                        pessoa (campo Ausência, na ficha do usuário em
                        Conta → Usuários).

                        O mesmo número existia em dois lugares, e a tela
                        anterior tentou resolver dizendo qual sobrepunha qual —
                        "padrão da conta" no rótulo, com a legenda apontando
                        para a ficha. Explicar a precedência de dois campos é
                        pior que ter um: quem abre Automações para mudar a
                        queda muda a da conta e não vê efeito em quem tem a
                        própria preenchida.

                        A queda de quem não preenche a ficha virou constante do
                        sistema, `MINUTOS_PARA_AUSENTE_PADRAO` (60 min). Medido
                        no banco de produção antes de tirar: as duas contas
                        tinham exatamente 60 gravado e nenhum usuário tinha
                        valor próprio — a remoção não mudou o comportamento de
                        ninguém. */}
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
                        hint={`Todo dia de manhã, ${v.pessoas} parados sem retorno marcado viram tarefa para o responsável. Usa o prazo de cada fase, definido em Negócios → Fases.`}
                        checked={config.followUpTasks}
                        onChange={(v) => void save({ followUpTasks: v })}
                    />

                    <Line
                        icon={Sun}
                        title="Boletim da manhã"
                        hint={`Três números e os nomes de quem ligar primeiro, para quem abre ${comArtigo(v, 'organizacao')}.`}
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
