'use client'

import { useEffect, useMemo, useRef } from 'react'
import { Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { OPENAI_MODELS } from '@/lib/llm/models'
import { DocumentoDeTreinamento } from '@/components/agents/creation/DocumentoDeTreinamento'
import { acharDocumento } from '@/lib/treinamento/documentos'
import type { CamposAntigos } from '@/lib/treinamento/gerar'
import { cn } from '@/lib/utils'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { InstrucoesData, PerfilData } from '@/types/agent-creation'

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
    /**
     * O modelo e a criatividade, que vinham da aba Instruções.
     *
     * Mudaram de lugar porque são do **agente**, como o nome e o idioma — a aba
     * Instruções existia para a instrução livre, e essa foi substituída por
     * Instruções centrais.
     */
    instrucoes: InstrucoesData
    onInstrucoesChange: (data: Partial<InstrucoesData>) => void
    /** O documento `instrucoes-centrais`: mora aqui, não em guia própria. */
    centrais: { valor: string; indexadoEm: string | null; trechos: number | null }
    onCentraisChange: (valor: string) => void
    /** Os campos antigos, para o botão de rascunho das Instruções centrais. */
    camposAntigos?: CamposAntigos
    /**
     * O `fieldset` de `CamposSomenteLeitura` cobre controles de formulário, e o
     * Slider do Radix é um `span[role=slider]` — escapa. Esta prop é para ele e
     * para os botões do documento.
     */
    somenteLeitura?: boolean
}

/** O teto do controle. O banco aceita até 2, que já não é conversa, é sorteio. */
const TEMPERATURA_MAX = 1.5

/**
 * O documento de Instruções centrais, do catálogo.
 *
 * `!` aqui é seguro e é conferido: `test:treinamento` confere a lista literal de
 * slugs, então este deixar de existir quebra o teste antes de quebrar a tela.
 */
const DOC_CENTRAIS = acharDocumento('instrucoes-centrais')!

function descreveTemperatura(valor: number): string {
    if (valor <= 0.2) return 'Quase sempre a mesma resposta para a mesma pergunta. Bom para preço e regra.'
    if (valor <= 0.5) return 'Pouca variação. Previsível, com alguma naturalidade.'
    if (valor <= 0.9) return 'Equilíbrio entre naturalidade e consistência.'
    if (valor <= 1.2) return 'Respostas mais variadas. Cuidado: mais chance de inventar o que não sabe.'
    return 'Muito imprevisível. Não recomendado para atendimento.'
}

export function PerfilTab({
    data,
    onChange,
    instrucoes,
    onInstrucoesChange,
    centrais,
    onCentraisChange,
    camposAntigos,
    somenteLeitura = false,
}: PerfilTabProps) {
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
                <p className="text-[12.5px] text-muted-foreground">
                    O estilo personalizado será aplicado ao compartilhar seu Agente IA
                </p>
            </div>

            <div className="space-y-4">
                {/* Imagem do agente */}
                {/* A identidade do agente numa linha: a foto à esquerda, o
                    nome e a função à direita. Empilhados, os três comiam meia
                    tela antes do primeiro campo de texto. */}
                <div className="grid items-start gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
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

                        {/* `flex-wrap` e `shrink-0`: na coluna de 300px os dois
                            botões não cabem ao lado da foto, e sem isso quem
                            cedia era a foto — ela ficava com largura zero e o
                            agente parecia não ter imagem. */}
                        <div className="flex flex-wrap items-center gap-3">
                            <div
                                className={cn(
                                    'flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-dashed',
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

                            <div className="flex flex-wrap items-center gap-2">
                                <Button variant="outline" size="sm" className="h-8" onClick={() => fileInputRef.current?.click()}>
                                    <Upload className="mr-2 h-4 w-4" />
                                    {preview ? 'Alterar imagem' : 'Enviar imagem'}
                                </Button>

                                {preview && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-8"
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

                {/*
                  * Instruções centrais: o documento de identidade do agente.
                  *
                  * Mora no Perfil e não em guia própria porque é isto que o
                  * Perfil é — quem o agente é. Ele SUBSTITUI a instrução livre
                  * da antiga aba Instruções: emitir as duas daria ao modelo duas
                  * declarações de identidade que podem divergir.
                  */}
                <div className="space-y-2">
                    <Label htmlFor={`treinamento-${DOC_CENTRAIS.slug}`}>
                        {DOC_CENTRAIS.titulo}
                    </Label>
                    <DocumentoDeTreinamento
                        doc={DOC_CENTRAIS}
                        valor={centrais.valor}
                        onChange={onCentraisChange}
                        indexadoEm={centrais.indexadoEm}
                        trechos={centrais.trechos}
                        somenteLeitura={somenteLeitura}
                        camposAntigos={camposAntigos}
                    />
                </div>

                {/*
                  * O "Tom de voz" saiu daqui.
                  *
                  * Eram DOIS controles sobre a MESMA coluna `voiceTone` — este e
                  * o da aba Voz —, e quem salvasse por último ganhava, sem a
                  * tela dizer nada. O tom do texto agora é escrito em Instruções
                  * centrais, junto da identidade, que é onde ele pertence; o da
                  * aba Voz segue sendo a entonação da fala.
                  */}
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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

                {/* Qual modelo responde e quanta liberdade ele tem: os dois
                    ajustes são do mesmo assunto e cabem na mesma linha. Vinham
                    da aba Instruções, que deixou de existir. */}
                <div className="grid items-start gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                        <Label htmlFor="llmModel">Modelo</Label>
                        <p className="text-xs text-muted-foreground">
                            O mais capaz entende melhor pedido confuso e mensagem desencontrada; o
                            mais barato dá conta da pergunta de rotina. Em resposta curta os dois
                            consomem 1 crédito — a economia aparece em conversa longa e em base de
                            conhecimento grande.
                        </p>
                        <Select
                            value={instrucoes.llmModel}
                            onValueChange={(llmModel) => onInstrucoesChange({ llmModel })}
                        >
                            <SelectTrigger id="llmModel">
                                <SelectValue placeholder="Escolher modelo" />
                            </SelectTrigger>
                            <SelectContent>
                                {OPENAI_MODELS.map((modelo) => (
                                    <SelectItem key={modelo.id} value={modelo.id}>
                                        {modelo.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-3 rounded-lg border bg-card p-4">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <Label className="text-base font-medium">
                                    Criatividade das respostas
                                </Label>
                                <p className="text-[12.5px] text-muted-foreground">
                                    Quanto o Agente pode variar a forma de responder
                                </p>
                            </div>
                            <span className="num shrink-0 text-sm font-medium">
                                {(instrucoes.temperature ?? 0.7).toFixed(1)}
                            </span>
                        </div>

                        <Slider
                            disabled={somenteLeitura}
                            value={[instrucoes.temperature ?? 0.7]}
                            onValueChange={([temperature]) => onInstrucoesChange({ temperature })}
                            min={0}
                            max={TEMPERATURA_MAX}
                            step={0.1}
                            aria-label="Criatividade das respostas"
                        />

                        <p className="text-xs text-muted-foreground">
                            {descreveTemperatura(instrucoes.temperature ?? 0.7)}
                        </p>
                    </div>
                </div>
            </div>
        </div>
    )
}
