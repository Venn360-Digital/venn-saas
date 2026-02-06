'use client'

import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { PerfilData } from '@/types/agent-creation'

interface PerfilTabProps {
    data: PerfilData
    onChange: (data: Partial<PerfilData>) => void
}

export function PerfilTab({ data, onChange }: PerfilTabProps) {
    const charCount = data.initialMessage?.length || 0
    const maxChars = 500

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-2xl font-bold">Personalize o seu Agente</h2>
                <p className="text-sm text-muted-foreground mt-1">
                    O estilo personalizado será aplicado ao compartilhar seu Agente IA
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

                {/* Função do agente */}
                <div className="space-y-2">
                    <Label htmlFor="agentFunction">Função do agente</Label>
                    <p className="text-xs text-muted-foreground">
                        Defina a principal função deste agente
                    </p>
                    <Select
                        value={data.agentFunction}
                        onValueChange={(value) => onChange({ agentFunction: value as any })}
                    >
                        <SelectTrigger id="agentFunction">
                            <SelectValue placeholder="SDR Atendimento" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="sdr_atendimento">SDR Atendimento</SelectItem>
                            <SelectItem value="vendas">Vendas</SelectItem>
                            <SelectItem value="suporte">Suporte</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

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

                {/* Idioma */}
                <div className="space-y-2">
                    <Label htmlFor="language">Idioma</Label>
                    <p className="text-xs text-muted-foreground">
                        Selecione o idioma do Agente para geração de resposta
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
            </div>
        </div>
    )
}
