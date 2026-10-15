'use client'

import { useRef, useState } from 'react'
import { toast } from 'sonner'

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
import { Play, Square } from 'lucide-react'
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
    const audioRef = useRef<HTMLAudioElement | null>(null)

    /**
     * Ouvir a voz escolhida, de verdade.
     *
     * O botão esperava dois segundos e voltava ao normal sem tocar nada — quem
     * clicava concluía que a voz estava muda. O áudio vem da rota de amostra e
     * é descartado ao terminar: `revokeObjectURL` evita segurar o arquivo na
     * memória da aba a cada clique.
     */
    const handlePlayVoice = async () => {
        if (isPlaying) {
            audioRef.current?.pause()
            setIsPlaying(false)
            return
        }
        setIsPlaying(true)
        try {
            const res = await fetch('/api/agents/voice-preview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                // Lê o que a pessoa escreveu, não uma frase pronta: quem
                // digitou o treinamento espera ouvir aquilo. O teto de 200
                // caracteres é da rota — amostra, não locução.
                body: JSON.stringify({
                    voice: data.voiceModel || 'nova',
                    text: data.voiceTraining?.trim().slice(0, 200) || undefined,
                }),
            })
            if (!res.ok) {
                const detail = await res.json().catch(() => null)
                toast.error(detail?.error ?? 'Não foi possível tocar a amostra.')
                setIsPlaying(false)
                return
            }
            const url = URL.createObjectURL(await res.blob())
            const audio = new Audio(url)
            audioRef.current = audio
            audio.onended = () => {
                setIsPlaying(false)
                URL.revokeObjectURL(url)
            }
            audio.onerror = () => {
                setIsPlaying(false)
                URL.revokeObjectURL(url)
                toast.error('Não foi possível tocar a amostra.')
            }
            await audio.play()
        } catch {
            setIsPlaying(false)
            toast.error('Não foi possível tocar a amostra.')
        }
    }

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-[15px] font-bold">Configuração de Voz</h2>
                <p className="mt-0.5 text-[12.5px] text-muted-foreground">
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
                        <p className="text-[12.5px] text-muted-foreground">
                            Habilite as respostas de seu Agente por áudio no WhatsApp
                        </p>
                    </div>
                    <Switch
                        checked={data.voiceEnabled}
                        onCheckedChange={(checked) => onChange({ voiceEnabled: checked })}
                    />
                </div>

                {/* A voz e o tom dela: duas escolhas curtas, lado a lado,
                    alinhadas pelo campo e não pelo rótulo. */}
                <div className="grid items-end gap-4 sm:grid-cols-2">
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
                                onClick={() => void handlePlayVoice()}
                                disabled={!data.voiceEnabled}
                                aria-label={isPlaying ? 'Parar amostra' : 'Ouvir amostra da voz'}
                            >
                                {isPlaying ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />}
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
                            // Era `voiceModel` nos dois campos: escolher o tom
                            // reescrevia a voz e o play passava a tocar "formal".
                            value={data.voiceTone}
                            onValueChange={(value) => onChange({ voiceTone: value })}
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
                    <div className="rounded-lg border border-warning/30 bg-warning-subtle p-4">
                        <p className="text-sm text-warning-subtle-foreground">
                            💡 <strong>Nota:</strong> A funcionalidade de voz será implementada após o MVP. A interface está pronta para uso futuro.
                        </p>
                    </div>
                )}
            </div>
        </div>
    )
}
