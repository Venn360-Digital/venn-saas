'use client'

import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'

interface PreferenciasData {
    showTypingIndicator: boolean
    responseSpeed: number // 0-10 segundos
    keepContext: boolean
    useEmojis: boolean
    allowManualTakeover: boolean
    restrictTopics: boolean
    interactionLimit: number // 10, 25, 50, 100
}

interface PreferenciasTabProps {
    data: PreferenciasData
    onChange: (data: Partial<PreferenciasData>) => void
}

const INTERACTION_LIMITS = [
    { value: 10, label: '10 interações' },
    { value: 25, label: '25 interações' },
    { value: 50, label: '50 interações' },
    { value: 100, label: '100 interações' },
]

function ToggleOption({
    checked,
    onCheckedChange,
    title,
    description,
}: {
    checked: boolean
    onCheckedChange: (checked: boolean) => void
    title: string
    description: string
}) {
    return (
        <div className="flex items-start justify-between rounded-lg border bg-card p-4">
            <div className="space-y-1">
                <Label className="text-base font-medium">{title}</Label>
                <p className="text-sm text-muted-foreground">{description}</p>
            </div>
            <Switch checked={checked} onCheckedChange={onCheckedChange} />
        </div>
    )
}

export function PreferenciasTab({ data, onChange }: PreferenciasTabProps) {
    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <h2 className="text-2xl font-semibold">Preferências da conversa</h2>
                <p className="text-muted-foreground mt-1">
                    Configure como seu Agente interage nas conversas
                </p>
            </div>

            {/* Toggle Options */}
            <div className="space-y-4">
                <ToggleOption
                    checked={data.showTypingIndicator}
                    onCheckedChange={(checked) => onChange({ showTypingIndicator: checked })}
                    title="Exibir indicador de digitação"
                    description='Mostre quando o Agente está "digitando" antes de enviar a resposta'
                />

                {/* Response Speed Slider */}
                <div className="rounded-lg border bg-card p-4 space-y-4">
                    <div>
                        <Label className="text-base font-medium">Velocidade de resposta</Label>
                        <p className="text-sm text-muted-foreground">
                            Controle o delay entre as mensagens do Agente
                        </p>
                    </div>
                    <div className="flex items-center gap-4">
                        <Slider
                            value={[data.responseSpeed]}
                            onValueChange={([value]) => onChange({ responseSpeed: value })}
                            max={10}
                            step={0.5}
                            className="flex-1"
                        />
                        <span className="w-10 text-center font-medium">{data.responseSpeed}s</span>
                    </div>
                </div>

                <ToggleOption
                    checked={data.keepContext}
                    onCheckedChange={(checked) => onChange({ keepContext: checked })}
                    title="Manter contexto da conversa"
                    description="O Agente lembrará das mensagens anteriores para respostas mais contextualizadas"
                />

                <ToggleOption
                    checked={data.useEmojis}
                    onCheckedChange={(checked) => onChange({ useEmojis: checked })}
                    title="Usar emojis nas respostas"
                    description="Permita que o Agente utilize emojis para tornar as conversas mais amigáveis"
                />

                <ToggleOption
                    checked={data.allowManualTakeover}
                    onCheckedChange={(checked) => onChange({ allowManualTakeover: checked })}
                    title="Habilitar assumir a conversa manualmente e interromper as respostas do Agente"
                    description="Permite que operadores assumam a conversa e interrompam as respostas automáticas do Agente"
                />

                <ToggleOption
                    checked={data.restrictTopics}
                    onCheckedChange={(checked) => onChange({ restrictTopics: checked })}
                    title="Restringir Temas Permitidos"
                    description="Marque essa opção para que o agente não fale sobre outros assuntos."
                />

                {/* Interaction Limit */}
                <div className="flex items-center justify-between rounded-lg border bg-card p-4">
                    <div className="space-y-1">
                        <Label className="text-base font-medium">Limite de interações por atendimento</Label>
                        <p className="text-sm text-muted-foreground">
                            Defina a quantidade de interações que o agente pode aceitar por atendimento.
                        </p>
                    </div>
                    <select
                        value={data.interactionLimit}
                        onChange={(e) => onChange({ interactionLimit: Number(e.target.value) })}
                        className="h-10 rounded-md border bg-muted/50 px-3 text-sm"
                    >
                        {INTERACTION_LIMITS.map((limit) => (
                            <option key={limit.value} value={limit.value}>
                                {limit.label}
                            </option>
                        ))}
                    </select>
                </div>
            </div>

            {/* Footer Note */}
            <p className="text-sm text-muted-foreground text-center pt-4">
                Personalize o comportamento do seu Agente durante as conversas
            </p>
        </div>
    )
}
