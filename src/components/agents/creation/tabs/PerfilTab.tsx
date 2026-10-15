'use client'

import { useEffect, useMemo, useRef } from 'react'
import { Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { PerfilData } from '@/types/agent-creation'

type AgentFunction = NonNullable<PerfilData['agentFunction']>

/** Fonte única: o seletor é renderizado daqui, então não há opção fora do tipo. */
const AGENT_FUNCTIONS: { value: AgentFunction; label: string }[] = [
    { value: 'sdr_atendimento', label: 'SDR Atendimento' },
    { value: 'vendas', label: 'Vendas' },
    { value: 'suporte', label: 'Suporte' },
]

function isAgentFunction(value: string): value is AgentFunction {
    return AGENT_FUNCTIONS.some((option) => option.value === value)
}

/** Os fusos do Brasil, que é onde o produto atende. */
const FUSOS = [
    { value: 'America/Sao_Paulo', label: 'Brasília (GMT−3)' },
    { value: 'America/Manaus', label: 'Manaus (GMT−4)' },
    { value: 'America/Rio_Branco', label: 'Rio Branco (GMT−5)' },
    { value: 'America/Noronha', label: 'Fernando de Noronha (GMT−2)' },
]

const AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp']
const AVATAR_MAX_BYTES = 2 * 1024 * 1024

interface PerfilTabProps {
    data: PerfilData
    onChange: (data: Partial<PerfilData>) => void
}

export function PerfilTab({ data, onChange }: PerfilTabProps) {
    const charCount = data.initialMessage?.length || 0
    const maxChars = 500
    const fileInputRef = useRef<HTMLInputElement>(null)

    /**
     * Preview do arquivo recém-escolhido como blob URL — a imagem não precisa
     * virar texto para ser exibida. Derivado, não guardado em estado: um
     * `setState` dentro do efeito renderizaria duas vezes a cada escolha. O
     * efeito existe só para revogar, senão cada troca deixa um objeto preso na
     * memória da aba.
     */
    const localPreview = useMemo(
        () => (data.avatarFile ? URL.createObjectURL(data.avatarFile) : null),
        [data.avatarFile]
    )

    useEffect(() => {
        if (!localPreview) return
        return () => URL.revokeObjectURL(localPreview)
    }, [localPreview])

    const preview = localPreview ?? data.avatar ?? null

    const handleAvatarSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0]
        // Limpa o input para que escolher o mesmo arquivo de novo volte a disparar.
        event.target.value = ''
        if (!file) return

        if (!AVATAR_TYPES.includes(file.type)) {
            toast.error('Formato não suportado. Envie PNG, JPG ou WEBP.')
            return
        }

        if (file.size > AVATAR_MAX_BYTES) {
            toast.error('Imagem maior que 2 MB. Envie uma versão menor.')
            return
        }

        onChange({ avatarFile: file })
    }

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-2xl font-bold">Personalize o seu Agente</h2>
                <p className="text-sm text-muted-foreground mt-1">
                    O estilo personalizado será aplicado ao compartilhar seu Agente IA
                </p>
            </div>

            <div className="space-y-4">
                {/* Imagem do agente */}
                {/* A identidade do agente numa linha: a foto à esquerda, o
                    nome e a função à direita. Empilhados, os três comiam meia
                    tela antes do primeiro campo de texto. */}
                <div className="grid items-start gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
                    <div className="space-y-3">
                        <div>
                            <Label>Imagem do Agente</Label>
                            <p className="text-xs text-muted-foreground">
                                Aparece na lista de agentes e nas conversas, para quem atende.
                                Nos canais conectados o paciente continua vendo a foto da conta
                                de WhatsApp, Instagram ou Facebook da clínica — essa imagem não
                                substitui a do canal.
                            </p>
                        </div>

                        <div className="flex items-center gap-4">
                            <div
                                className={cn(
                                    'flex h-20 w-20 items-center justify-center overflow-hidden rounded-full border-2 border-dashed',
                                    preview ? 'border-transparent' : 'border-muted-foreground/25'
                                )}
                            >
                                {preview ? (
                                    // Origem variável (Storage ou blob local), fora do alcance
                                    // do next/image sem configurar remotePatterns.
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                        src={preview}
                                        alt="Imagem do agente"
                                        className="h-full w-full object-cover"
                                    />
                                ) : (
                                    <span className="text-3xl text-muted-foreground">
                                        {data.name?.trim()?.[0]?.toUpperCase() ?? 'A'}
                                    </span>
                                )}
                            </div>

                            <div className="flex items-center gap-2">
                                <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
                                    <Upload className="mr-2 h-4 w-4" />
                                    {preview ? 'Alterar imagem' : 'Enviar imagem'}
                                </Button>

                                {preview && (
                                    <Button
                                        variant="ghost"
                                        onClick={() => onChange({ avatarFile: null, avatar: '' })}
                                    >
                                        <X className="mr-2 h-4 w-4" />
                                        Remover
                                    </Button>
                                )}
                            </div>

                            <input
                                ref={fileInputRef}
                                type="file"
                                accept={AVATAR_TYPES.join(',')}
                                className="hidden"
                                onChange={handleAvatarSelect}
                            />
                        </div>

                        <p className="text-xs text-muted-foreground">
                            PNG, JPG ou WEBP, até 2 MB. A imagem é enviada quando você salva o Agente.
                        </p>
                    </div>

                    <div className="space-y-4">
                        {/* Nome do agente */}
                        <div className="space-y-2">
                            <Label htmlFor="name">Nome do agente</Label>
                            <Input
                                id="name"
                                placeholder="Ex: Ferroaco"
                                value={data.name}
                                onChange={(e) => onChange({ name: e.target.value })}
                            />
                        </div>

                        {/* Função do agente */}
                        <div className="space-y-2">
                            <Label htmlFor="agentFunction">Função do agente</Label>
                            <p className="text-xs text-muted-foreground">
                                Defina a principal função deste agente
                            </p>
                            <Select
                                value={data.agentFunction}
                                onValueChange={(value) => {
                                    if (isAgentFunction(value)) onChange({ agentFunction: value })
                                }}
                            >
                                <SelectTrigger id="agentFunction">
                                    <SelectValue placeholder="SDR Atendimento" />
                                </SelectTrigger>
                                <SelectContent>
                                    {AGENT_FUNCTIONS.map((option) => (
                                        <SelectItem key={option.value} value={option.value}>
                                            {option.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                
                    </div>
                </div>

                {/* Mensagem Inicial */}
                <div className="space-y-2">
                    <Label htmlFor="initialMessage">Mensagem Inicial</Label>
                    <p className="text-xs text-muted-foreground">
                        Será a mensagem inicial do seu Agente com os usuários
                    </p>
                    <Textarea
                        id="initialMessage"
                        placeholder="Digite a mensagem inicial..."
                        value={data.initialMessage || ''}
                        onChange={(e) => onChange({ initialMessage: e.target.value })}
                        className="min-h-[100px] resize-none"
                        maxLength={maxChars}
                    />
                    <p className="text-xs text-right text-muted-foreground">
                        {charCount} de {maxChars} caracteres
                    </p>
                </div>

                {/* Como o Agente fala e como se situa: tom, língua e relógio
                    são três escolhas curtas e cabem na mesma linha. */}
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {/* Tom de Voz */}
                    <div className="space-y-2">
                        <Label htmlFor="voiceTone">Tom de Voz</Label>
                        <p className="text-xs text-muted-foreground">
                            Escolha o tom de voz que o seu Agente irá utilizar durante as conversas
                        </p>
                        <Select
                            value={data.voiceTone}
                            onValueChange={(value) => onChange({ voiceTone: value })}
                        >
                            <SelectTrigger id="voiceTone">
                                <SelectValue placeholder="Prático" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="pratico">Prático</SelectItem>
                                <SelectItem value="formal">Formal</SelectItem>
                                <SelectItem value="casual">Casual</SelectItem>
                                <SelectItem value="amigavel">Amigável</SelectItem>
                                <SelectItem value="entusiasmado">Entusiasmado</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="language">Idioma</Label>
                        <p className="text-xs text-muted-foreground">
                            Em que língua o Agente responde
                        </p>
                        <Select
                            value={data.language}
                            onValueChange={(value) => onChange({ language: value })}
                        >
                            <SelectTrigger id="language">
                                <SelectValue placeholder="Português (Brasil)" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="pt-BR">Português (Brasil)</SelectItem>
                                <SelectItem value="en-US">Inglês (EUA)</SelectItem>
                                <SelectItem value="es-ES">Espanhol</SelectItem>
                                <SelectItem value="fr-FR">Francês</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="timezone">Fuso horário</Label>
                        <p className="text-xs text-muted-foreground">
                            O Agente usa para saber que horas são agora
                        </p>
                        <Select
                            value={data.timezone ?? 'America/Sao_Paulo'}
                            onValueChange={(timezone) => onChange({ timezone })}
                        >
                            <SelectTrigger id="timezone">
                                <SelectValue placeholder="Brasília (GMT−3)" />
                            </SelectTrigger>
                            <SelectContent>
                                {FUSOS.map((f) => (
                                    <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>
            </div>
        </div>
    )
}
