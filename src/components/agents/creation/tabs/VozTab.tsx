'use client'

import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { VOZES, instrucaoDeFala, semearEntonacao, vozValida } from '@/lib/voz'

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
import { cn } from '@/lib/utils'

interface VozTabProps {
    data: VozData
    onChange: (data: Partial<VozData>) => void
}


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
                /**
                 * O campo de entonação vai como **entonação**, não como texto.
                 *
                 * Antes ele era lido em voz alta: quem escrevia "fale devagar e
                 * com calma" ouvia a voz dizendo "fale devagar e com calma", e
                 * concluía que era isso que o paciente ia receber. A amostra
                 * agora fala a frase padrão da rota, com a entonação aplicada —
                 * que é exatamente o que o paciente vai ouvir.
                 */
                body: JSON.stringify({
                    voice: vozValida(data.voiceModel),
                    instructions: instrucaoDeFala({
                        entonacao: semearEntonacao(data.voiceTraining),
                        tom: data.voiceTone,
                    }),
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
                <p className="text-[12.5px] text-muted-foreground">
                    Configure como seu agente se comunicará por áudio
                </p>
            </div>

            <div className="space-y-6">
                {/* Toggle de voz */}
                <div className="flex items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5">
                        {/* O selo e a frase saíam fixos em "INATIVO" e "Clique
                            para desativar", independentes do interruptor ao
                            lado: ligado, a tela dizia que estava desligado. */}
                        <div className="flex items-center gap-2">
                            <div
                                className={cn(
                                    'rounded-md px-2 py-1',
                                    data.voiceEnabled ? 'bg-success-subtle' : 'bg-muted'
                                )}
                            >
                                <span
                                    className={cn(
                                        'text-xs font-medium',
                                        data.voiceEnabled
                                            ? 'text-success-subtle-foreground'
                                            : 'text-muted-foreground'
                                    )}
                                >
                                    {data.voiceEnabled ? 'ATIVO' : 'INATIVO'}
                                </span>
                            </div>
                            <span className="text-sm font-medium">
                                {data.voiceEnabled
                                    ? 'O agente responde em áudio'
                                    : 'O agente responde por escrito'}
                            </span>
                        </div>
                        <p className="text-[12.5px] text-muted-foreground">
                            Habilite as respostas de seu Agente por áudio no WhatsApp
                        </p>
                    </div>
                    <Switch
                        checked={data.voiceEnabled}
                        /*
                         * Ligar a voz **preenche a entonação**, não deixa o
                         * campo vazio.
                         *
                         * Vazio, as vozes da OpenAI — treinadas em inglês —
                         * liam o português com sotaque americano, e a clínica
                         * não tinha como saber que precisava pedir o contrário.
                         * A instrução de idioma mora aqui, visível e editável,
                         * por decisão do Andre em 2026-10-20: frase que governa
                         * como o agente soa e que ninguém vê é frase que não se
                         * pode ajustar nem reprovar.
                         */
                        onCheckedChange={(checked) =>
                            onChange(
                                checked
                                    ? {
                                          voiceEnabled: true,
                                          voiceModel: vozValida(data.voiceModel),
                                          voiceTraining: semearEntonacao(data.voiceTraining),
                                      }
                                    : { voiceEnabled: false }
                            )
                        }
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
                                value={vozValida(data.voiceModel)}
                                onValueChange={(value) => onChange({ voiceModel: value })}
                                disabled={!data.voiceEnabled}
                            >
                                <SelectTrigger id="voiceModel" className="flex-1">
                                    <SelectValue placeholder="Coral" />
                                </SelectTrigger>
                                <SelectContent>
                                    {/* A nota distingue as cinco vozes novas das
                                        seis antigas: sem ela, a lista são onze
                                        nomes próprios em inglês, e a clínica
                                        escolhe por sorteio. */}
                                    {VOZES.map((voz) => (
                                        <SelectItem key={voz.id} value={voz.id}>
                                            <span className="flex flex-col items-start">
                                                <span>{voz.nome}</span>
                                                <span className="text-[11px] text-muted-foreground">
                                                    {voz.nota}
                                                </span>
                                            </span>
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

                {/* Entonação. Não é treino: é o campo `instructions` do modelo
                    de fala, que descreve **como** falar, e é a única coisa que
                    ele pode ser. Chamá-lo de treinamento fazia a clínica
                    escrever ali o que o agente deveria saber. */}
                <div className="space-y-2">
                    <Label htmlFor="voiceTraining">Como o agente deve falar</Label>
                    <p className="text-xs text-muted-foreground">
                        Descreva o jeito da fala — ritmo, calor, pausas. Não escreva aqui o
                        que o agente deve saber nem o que ele deve responder: isto muda só a
                        entonação do áudio.{' '}
                        <span className="font-medium text-foreground">
                            O português do Brasil já está garantido
                        </span>{' '}
                        — não precisa pedir.
                    </p>
                    <Textarea
                        id="voiceTraining"
                        value={data.voiceTraining || ''}
                        onChange={(e) => onChange({ voiceTraining: e.target.value })}
                        placeholder="Ex.: um pouco mais devagar, e mais calorosa ao confirmar o horário."
                        className="min-h-[120px]"
                        disabled={!data.voiceEnabled}
                    />
                </div>

                {data.voiceEnabled && (
                    <div className="rounded-lg border border-warning/30 bg-warning-subtle p-4">
                        <p className="text-sm text-warning-subtle-foreground">
                            💡 <strong>Nota:</strong> o áudio é cobrado pelo tamanho do texto
                            falado, e desconta do mesmo crédito das respostas. Resposta longa
                            vai como texto, porque nota de voz de minutos ninguém ouve até o
                            fim.
                        </p>
                    </div>
                )}
            </div>
        </div>
    )
}
