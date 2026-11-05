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
import { GRUPOS_DE_FUSOS, rotuloDoFuso } from '@/lib/fusos'
import { cn } from '@/lib/utils'
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectLabel,
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
    /**
     * O `fieldset` de `CamposSomenteLeitura` cobre controles de formulário, e o
     * Slider do Radix é um `span[role=slider]` — escapa. Esta prop é para ele e
     * para os botões do documento.
     */
    somenteLeitura?: boolean
}

/** O teto do controle. O banco aceita até 2, que já não é conversa, é sorteio. */
const TEMPERATURA_MAX = 1.5

function descreveTemperatura(valor: number): string {
    if (valor <= 0.2) return 'Quase sempre a mesma resposta para a mesma pergunta. Bom para preço e regra.'
    if (valor <= 0.5) return 'Pouca variação. Previsível, com alguma naturalidade.'
    if (valor <= 0.9) return 'Equilíbrio entre naturalidade e consistência.'
    if (valor <= 1.2) return 'Respostas mais variadas. Cuidado: mais chance de inventar o que não sabe.'
    return 'Muito imprevisível. Não recomendado para atendimento.'
}

/**
 * Um grupo de campos com um nome e um fio em cima.
 *
 * A guia tinha oito blocos soltos com `space-y`, cada um com o próprio rótulo e
 * a própria legenda, em larguras diferentes: a foto ao lado do nome, a mensagem
 * inicial inteira, um editor de documento, dois seletores em grade de três e
 * mais dois numa grade de duas. Lido de cima a baixo não havia agrupamento
 * nenhum — era a bagunça que o Andre apontou. Três grupos nomeados resolvem sem
 * esconder nada: quem é, como pensa, o que fala.
 */
function Grupo({
    titulo,
    descricao,
    children,
}: {
    /**
     * Opcional desde 2026-11-05: o grupo do modelo e da criatividade perdeu o
     * nome ("Como ele pensa") e a legenda a pedido do Andre. Sem título, o que
     * separa o grupo do anterior é o fio de cima — que já era o papel dele.
     */
    titulo?: string
    descricao?: string
    children: React.ReactNode
}) {
    return (
        <section className="border-t border-border pt-4 first:border-t-0 first:pt-0">
            {titulo ? (
                <div className="mb-3">
                    <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {titulo}
                    </h2>
                    {descricao ? (
                        <p className="mt-0.5 text-xs text-muted-foreground/80">{descricao}</p>
                    ) : null}
                </div>
            ) : null}
            {children}
        </section>
    )
}

export function PerfilTab({
    data,
    onChange,
    instrucoes,
    onInstrucoesChange,
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
        <div className="space-y-5">
            {/*
              * Três colunas, na ordem que o Andre pediu em 2026-11-05: nome e
              * idioma, função e fuso, imagem.
              *
              * A imagem foi para a **última** coluna. Ela abria a guia, e abrir
              * o cadastro de um agente por um disco pontilhado vazio dava ao
              * enfeite a primeira posição de leitura — o nome, que é o campo
              * que a pessoa veio preencher, ficava à direita de um upload.
              *
              * As duas primeiras colunas são pares de campos relacionados: nome
              * e idioma são como ele se apresenta, função e fuso são como ele
              * trabalha. Abaixo de `lg` as três empilham, e a imagem fica no fim
              * — que é a ordem certa num celular também.
              */}
            <Grupo titulo="Identidade">
                <div className="grid items-start gap-4 lg:grid-cols-3">
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="name">Nome do agente</Label>
                            <Input
                                id="name"
                                placeholder="Ex: Ana"
                                value={data.name}
                                onChange={(e) => onChange({ name: e.target.value })}
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="language">Idioma</Label>
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

                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="agentFunction">Função</Label>
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

                        {/* O fuso com que o agente responde "amanhã às 9h". Os
                            rótulos trazem o deslocamento de HOJE, calculado por
                            `Intl` — escrito à mão, metade da lista estaria
                            errada metade do ano por causa do horário de verão. */}
                        <div className="space-y-2">
                            <Label htmlFor="timezone">Fuso horário</Label>
                            <Select
                                value={data.timezone ?? 'America/Sao_Paulo'}
                                onValueChange={(timezone) => onChange({ timezone })}
                            >
                                <SelectTrigger id="timezone">
                                    <SelectValue placeholder="Brasília, São Paulo" />
                                </SelectTrigger>
                                <SelectContent className="max-h-72">
                                    {GRUPOS_DE_FUSOS.map((grupo) => (
                                        <SelectGroup key={grupo.titulo}>
                                            <SelectLabel>{grupo.titulo}</SelectLabel>
                                            {grupo.fusos.map((f) => (
                                                <SelectItem key={f.value} value={f.value}>
                                                    {rotuloDoFuso(f)}
                                                </SelectItem>
                                            ))}
                                        </SelectGroup>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    {/* `flex-wrap` e `shrink-0`: na coluna estreita os dois
                        botões não cabem ao lado da foto, e sem isso quem cedia
                        era a foto — ela ficava com largura zero e o agente
                        parecia não ter imagem. */}
                    <div className="space-y-2">
                        <Label>Imagem do agente</Label>
                        <div className="flex flex-wrap items-center gap-3">
                            <div
                                className={cn(
                                    'flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-dashed',
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
                                    <span className="text-2xl text-muted-foreground">
                                        {data.name?.trim()?.[0]?.toUpperCase() ?? 'A'}
                                    </span>
                                )}
                            </div>

                            <div className="flex flex-wrap items-center gap-1.5">
                                <Button variant="outline" size="sm" className="h-8" onClick={() => fileInputRef.current?.click()}>
                                    <Upload className="mr-1.5 size-3.5" />
                                    {preview ? 'Alterar' : 'Enviar'}
                                </Button>

                                {preview && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-8"
                                        onClick={() => onChange({ avatarFile: null, avatar: '' })}
                                    >
                                        <X className="mr-1.5 size-3.5" />
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

                        {/* O parágrafo que explicava que esta foto não substitui
                            a do canal saiu a pedido do Andre: eram quatro linhas
                            de ressalva num campo de upload, e o fato continua
                            escrito onde ele é verificável — no cabeçalho de
                            `api/agents/[id]/avatar`. */}
                        <p className="text-xs text-muted-foreground">
                            PNG, JPG ou WEBP, até 2 MB. Enviada ao salvar.
                        </p>
                    </div>
                </div>
            </Grupo>

            {/* Sem título: "Como ele pensa" e a legenda saíram a pedido dele. O
                fio de cima separa o grupo, que é o que o nome fazia. */}
            <Grupo>
                <div className="grid items-start gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                        <Label htmlFor="llmModel">Modelo</Label>
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
                        {/* O parágrafo que comparava o modelo capaz com o barato
                            saiu a pedido dele: quatro linhas de economia de
                            crédito debaixo de um seletor de duas opções. */}
                    </div>

                    <div className="space-y-2">
                        <div className="flex items-baseline justify-between gap-4">
                            <Label>Criatividade das respostas</Label>
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
            </Grupo>

            {/*
              * Sobrou a mensagem inicial. A legenda dizia "e as instruções que
              * valem para todas as outras" — as instruções saíram para a guia
              * Instruções gerais, e a frase passaria a prometer um campo que
              * não está mais aqui.
              */}
            <Grupo titulo="O que ele fala" descricao="A primeira mensagem que o paciente recebe.">
                <div className="space-y-2">
                    <Label htmlFor="initialMessage">Mensagem inicial</Label>
                    <Textarea
                        id="initialMessage"
                        placeholder="Digite a mensagem inicial..."
                        value={data.initialMessage || ''}
                        onChange={(e) => onChange({ initialMessage: e.target.value })}
                        className="min-h-[72px] resize-none"
                        maxLength={maxChars}
                    />
                    <p className="num text-right text-xs text-muted-foreground">
                        {charCount} de {maxChars} caracteres
                    </p>
                </div>
            </Grupo>
        </div>
    )
}
