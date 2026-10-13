'use client'

import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { INTERACTION_LIMITS, type AgentPreferences } from '@/types/agent-preferences'

/**
 * A forma dos dados vem de `@/types/agent-preferences`, que é a mesma que a API
 * valida e o worker lê. Esta tela tinha a sua própria cópia da interface, e foi
 * essa cópia solta que deixou `responseSpeed` virar segundos aqui e um enum de
 * texto no worker, sem ninguém notar.
 *
 * Saiu daqui o interruptor "habilitar assumir a conversa manualmente": assumir
 * uma conversa **sempre** interrompe o agente, não é opcional, e o interruptor
 * sugeria que desligá-lo faria o agente responder por cima do atendente. O que
 * falta de verdade é devolver a conversa ao agente depois, e isso é outro
 * trabalho.
 */
interface PreferenciasTabProps {
    data: AgentPreferences
    onChange: (data: Partial<AgentPreferences>) => void
}

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
                            Tempo de espera antes do Agente responder, somado à pausa que
                            ele já faz para o paciente terminar de escrever
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
                            Quantas respostas o Agente dá numa conversa. Ao atingir o limite
                            ele para, avisa o paciente e deixa a conversa para a equipe.
                        </p>
                    </div>
                    <select
                        value={data.interactionLimit}
                        onChange={(e) => onChange({ interactionLimit: Number(e.target.value) })}
                        className="h-10 rounded-md border bg-muted/50 px-3 text-sm"
                    >
                        {INTERACTION_LIMITS.map((limit) => (
                            <option key={limit} value={limit}>
                                {limit} interações
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
