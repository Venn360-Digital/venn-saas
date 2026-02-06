'use client'

import { useState } from 'react'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Play } from 'lucide-react'
import { VozData } from '@/types/agent-creation'

interface VozTabProps {
    data: VozData
    onChange: (data: Partial<VozData>) => void
}

const voiceModels = [
    { value: 'nova', label: 'Nova' },
    { value: 'alloy', label: 'Alloy' },
    { value: 'echo', label: 'Echo' },
    { value: 'fable', label: 'Fable' },
    { value: 'onyx', label: 'Onyx' },
    { value: 'shimmer', label: 'Shimmer' },
]

export function VozTab({ data, onChange }: VozTabProps) {
    const [isPlaying, setIsPlaying] = useState(false)

    const handlePlayVoice = () => {
        setIsPlaying(true)
        // TODO: Implementar preview de voz
        setTimeout(() => setIsPlaying(false), 2000)
    }

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-2xl font-bold">Configuração de Voz</h2>
                <p className="text-sm text-muted-foreground mt-1">
                    Configure como seu agente se comunicará por áudio
                </p>
            </div>

            <div className="space-y-6">
                {/* Toggle de voz */}
                <div className="flex items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                            <div className="rounded-md bg-primary/10 px-2 py-1">
                                <span className="text-xs font-medium text-primary">INATIVO</span>
                            </div>
                            <span className="text-sm font-medium">
                                Clique para desativar
                            </span>
                        </div>
                        <p className="text-sm text-muted-foreground">
                            Habilite as respostas de seu Agente por áudio no WhatsApp
                        </p>
                    </div>
                    <Switch
                        checked={data.voiceEnabled}
                        onCheckedChange={(checked) => onChange({ voiceEnabled: checked })}
                    />
                </div>

                {/* Modelo de voz */}
                <div className="space-y-2">
                    <Label htmlFor="voiceModel">
                        Escolha o modelo de voz a ser utilizado pelo seu Agente
                    </Label>
                    <div className="flex gap-2">
                        <Select
                            value={data.voiceModel}
                            onValueChange={(value) => onChange({ voiceModel: value })}
                            disabled={!data.voiceEnabled}
                        >
                            <SelectTrigger id="voiceModel" className="flex-1">
                                <SelectValue placeholder="Nova" />
                            </SelectTrigger>
                            <SelectContent>
                                {voiceModels.map((model) => (
                                    <SelectItem key={model.value} value={model.value}>
                                        {model.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Button
                            variant="outline"
                            size="icon"
                            onClick={handlePlayVoice}
                            disabled={!data.voiceEnabled || isPlaying}
                        >
                            <Play className="h-4 w-4" />
                        </Button>
                    </div>
                </div>

                {/* Tom de Voz */}
                <div className="space-y-2">
                    <Label htmlFor="voiceTone">Tom de Voz</Label>
                    <p className="text-xs text-muted-foreground">
                        Ao mudar o tom de voz no áudio, a personalidade do Agente será atualizada para manter a consistência
                    </p>
                    <Select
                        value={data.voiceModel}
                        onValueChange={(value) => onChange({ voiceModel: value })}
                        disabled={!data.voiceEnabled}
                    >
                        <SelectTrigger id="voiceTone">
                            <SelectValue placeholder="Prático" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="pratico">Prático</SelectItem>
                            <SelectItem value="formal">Formal</SelectItem>
                            <SelectItem value="casual">Casual</SelectItem>
                            <SelectItem value="amigavel">Amigável</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                {/* Treinamento */}
                <div className="space-y-2">
                    <Label htmlFor="voiceTraining">
                        Edite as informações para treinar o seu Agente IA
                    </Label>
                    <Textarea
                        id="voiceTraining"
                        value={data.voiceTraining || ''}
                        onChange={(e) => onChange({ voiceTraining: e.target.value })}
                        className="min-h-[120px]"
                        disabled={!data.voiceEnabled}
                    />
                </div>

                {data.voiceEnabled && (
                    <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-900 dark:bg-yellow-950/30">
                        <p className="text-sm text-yellow-800 dark:text-yellow-200">
                            💡 <strong>Nota:</strong> A funcionalidade de voz será implementada após o MVP. A interface está pronta para uso futuro.
                        </p>
                    </div>
                )}
            </div>
        </div>
    )
}
