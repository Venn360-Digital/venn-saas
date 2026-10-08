'use client'

import { useState, useRef } from 'react'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Upload } from 'lucide-react'
import { VisualData } from '@/types/agent-creation'
import { cn } from '@/lib/utils'
import { AGENT_WIDGET_DEFAULTS, BRAND_HEX } from '@/lib/palette'

interface VisualTabProps {
    data: VisualData
    onChange: (data: Partial<VisualData>) => void
}

interface ColorPickerProps {
    label: string
    description: string
    value?: string
    onChange: (color: string) => void
}

function ColorPicker({ label, description, value, onChange }: ColorPickerProps) {
    const inputRef = useRef<HTMLInputElement>(null)

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                <div className="flex-1">
                    <Label>{label}</Label>
                    <p className="text-xs text-muted-foreground">{description}</p>
                </div>
                <div className="flex items-center gap-2">
                    <div
                        className="h-10 w-24 cursor-pointer rounded-md border"
                        style={{ backgroundColor: value || BRAND_HEX.white }}
                        onClick={() => inputRef.current?.click()}
                    />
                    <input
                        ref={inputRef}
                        type="color"
                        value={value || BRAND_HEX.white}
                        onChange={(e) => onChange(e.target.value)}
                        className="sr-only"
                    />
                </div>
            </div>
        </div>
    )
}

export function VisualTab({ data, onChange }: VisualTabProps) {
    const [avatarPreview, setAvatarPreview] = useState<string | null>(data.avatar || null)
    const fileInputRef = useRef<HTMLInputElement>(null)

    const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return

        const reader = new FileReader()
        reader.onloadend = () => {
            const result = reader.result as string
            setAvatarPreview(result)
            onChange({ avatar: result })
        }
        reader.readAsDataURL(file)
    }

    const handleColorChange = (key: keyof NonNullable<VisualData['visualConfig']>, color: string) => {
        onChange({
            visualConfig: {
                ...data.visualConfig,
                [key]: color,
            },
        })
    }

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-2xl font-bold">Personalize o seu Agente</h2>
                <p className="text-sm text-muted-foreground mt-1">
                    O estilo personalizado será aplicado ao compartilhar seu Agente IA
                </p>
            </div>

            <div className="space-y-6">
                {/* Imagem do Agente */}
                <div className="space-y-3">
                    <div>
                        <Label>Imagem do Agente</Label>
                        <p className="text-xs text-muted-foreground">
                            Insira a imagem que você quer que apareça como perfil do seu Agente
                        </p>
                    </div>

                    <div className="flex items-center gap-4">
                        <div
                            className={cn(
                                'flex h-20 w-20 items-center justify-center rounded-full border-2 border-dashed',
                                avatarPreview ? 'border-transparent' : 'border-muted-foreground/25'
                            )}
                        >
                            {avatarPreview ? (
                                <img
                                    src={avatarPreview}
                                    alt="Avatar"
                                    className="h-full w-full rounded-full object-cover"
                                />
                            ) : (
                                <span className="text-3xl">A</span>
                            )}
                        </div>

                        <Button
                            variant="outline"
                            onClick={() => fileInputRef.current?.click()}
                        >
                            <Upload className="mr-2 h-4 w-4" />
                            Alterar imagem
                        </Button>

                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={handleAvatarUpload}
                        />
                    </div>
                </div>

                {/* Cores */}
                <div className="space-y-4">
                    <h3 className="font-medium">
                        Defina as cores e detalhes de interação do seu Agente IA
                    </h3>

                    <ColorPicker
                        label="Cor da mensagem"
                        description="do usuário"
                        value={data.visualConfig?.userMessageColor}
                        onChange={(color) => handleColorChange('userMessageColor', color)}
                    />

                    <ColorPicker
                        label="Cor da fonte"
                        description="do usuário"
                        value={data.visualConfig?.userFontColor}
                        onChange={(color) => handleColorChange('userFontColor', color)}
                    />

                    <ColorPicker
                        label="Cor da mensagem"
                        description="do Agente"
                        value={data.visualConfig?.agentMessageColor}
                        onChange={(color) => handleColorChange('agentMessageColor', color)}
                    />

                    <ColorPicker
                        label="Cor da fonte"
                        description="do Agente"
                        value={data.visualConfig?.agentFontColor}
                        onChange={(color) => handleColorChange('agentFontColor', color)}
                    />
                </div>

                {/* Preview */}
                <div className="rounded-lg border p-4">
                    <h4 className="mb-3 text-sm font-medium">Preview</h4>
                    <div className="space-y-2">
                        {/* User message */}
                        <div className="flex justify-end">
                            <div
                                className="max-w-[70%] rounded-lg p-3"
                                style={{
                                    backgroundColor: data.visualConfig?.userMessageColor || AGENT_WIDGET_DEFAULTS.userMessageColor,
                                    color: data.visualConfig?.userFontColor || AGENT_WIDGET_DEFAULTS.userFontColor,
                                }}
                            >
                                <p className="text-sm">Olá! Como posso ajudar?</p>
                            </div>
                        </div>

                        {/* Agent message */}
                        <div className="flex justify-start">
                            <div
                                className="max-w-[70%] rounded-lg p-3"
                                style={{
                                    backgroundColor: data.visualConfig?.agentMessageColor || AGENT_WIDGET_DEFAULTS.agentMessageColor,
                                    color: data.visualConfig?.agentFontColor || AGENT_WIDGET_DEFAULTS.agentFontColor,
                                }}
                            >
                                <p className="text-sm">
                                    Olá! Sou seu assistente virtual. Como posso te ajudar hoje?
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
