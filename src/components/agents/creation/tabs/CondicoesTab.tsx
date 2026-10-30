'use client'

import { useEffect, useState } from 'react'
import { Plus, Trash2, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { RuleData, RuleCondition, RuleAction } from '@/types/agent-creation'
import {
    DIAS_DA_SEMANA,
    JANELA_PADRAO,
    descreverJanela,
    normalizarJanela,
    type JanelaDeExpediente,
} from '@/lib/rules/expediente'

/**
 * As condições que o avaliador sabe executar — e só elas.
 *
 * A tela oferecia quatro tipos; dois deles nunca disparam. `user_intent` exige
 * uma classificação de intenção que nenhum passo do sistema produz, e `custom`
 * é um `return false` fixo no avaliador. Pior: `user_intent` era o tipo da
 * condição que a tela criava por padrão, então **toda regra nova nascia morta** —
 * a clínica montava a regra, salvava, e ela nunca rodava.
 *
 * Os dois continuam no schema, porque uma regra já gravada com eles precisa
 * continuar sendo lida (e aparece aqui com um aviso para ser corrigida). O que
 * saiu foi a possibilidade de criar mais uma.
 *
 * Os operadores também passam a depender do tipo: `message_contains` com "maior
 * que" caía no `default: false` do avaliador, outra forma silenciosa de montar
 * uma regra que não roda.
 */
interface DefinicaoCondicao {
    label: string
    operadores: { value: RuleCondition['operator']; label: string }[]
    /** Decide o campo que a tela desenha e como o valor é gravado. */
    tipo: 'texto' | 'numero' | 'booleano' | 'expediente'
    placeholder: string
    ajuda: string
}

type CondicaoSuportada =
    | 'message_contains'
    | 'time_elapsed'
    | 'first_message'
    | 'business_hours'

const CONDICOES: Record<CondicaoSuportada, DefinicaoCondicao> = {
    message_contains: {
        label: 'A mensagem do paciente',
        operadores: [
            { value: 'contains', label: 'contém' },
            { value: 'equals', label: 'é exatamente' },
            { value: 'starts_with', label: 'começa com' },
        ],
        tipo: 'texto',
        placeholder: 'preço, valor, quanto custa',
        ajuda: 'Separe variações por vírgula: qualquer uma delas dispara a regra.',
    },
    time_elapsed: {
        label: 'O tempo desde a última mensagem (em minutos)',
        operadores: [
            { value: 'greater_than', label: 'passou de' },
            { value: 'less_than', label: 'é menor que' },
            { value: 'equals', label: 'é exatamente' },
        ],
        tipo: 'numero',
        placeholder: '60',
        ajuda: 'Use para reagir a quem sumiu e voltou.',
    },
    first_message: {
        label: 'É a primeira mensagem da conversa',
        operadores: [{ value: 'equals', label: 'é' }],
        tipo: 'booleano',
        placeholder: '',
        ajuda: 'Vale só na mensagem que abre o atendimento. Não dá para escrever isso com tempo decorrido, que é vazio justamente na primeira.',
    },
    business_hours: {
        label: 'O horário de atendimento',
        operadores: [
            { value: 'outside', label: 'está fora de' },
            { value: 'inside', label: 'está dentro de' },
        ],
        tipo: 'expediente',
        placeholder: '',
        ajuda: 'A hora é a de Brasília. O fim é exclusivo: às 18:00 em ponto já está fora de uma janela que fecha às 18:00.',
    },
}

function isSuportada(tipo: string): tipo is CondicaoSuportada {
    return tipo in CONDICOES
}

/**
 * As ações, cada uma com os parâmetros que o executor realmente lê.
 *
 * O campo "Configuração" era um só, gravando sempre `params.message`, qualquer
 * que fosse o tipo da ação. Mas o executor pede `tagName` para etiquetar,
 * `stageId` para mover no funil e `delayMinutes` para agendar retomada — então
 * quatro das cinco ações lançavam erro, que o executor engole e registra no log.
 * Na tela, tudo parecia configurado.
 */
const ACOES = [
    { value: 'send_message', label: 'Enviar mensagem imediata' },
    { value: 'notify_human', label: 'Transferir para um atendente' },
    { value: 'add_tag', label: 'Adicionar etiqueta' },
    { value: 'move_pipeline', label: 'Mover no funil' },
    { value: 'schedule_followup', label: 'Agendar retomada' },
    { value: 'close_conversation', label: 'Encerrar atendimento' },
] as const

const PRAZOS = [
    { value: 60, label: 'em 1 hora' },
    { value: 240, label: 'em 4 horas' },
    { value: 1440, label: 'amanhã' },
    { value: 2880, label: 'em 2 dias' },
    { value: 10080, label: 'em 7 dias' },
]

interface Opcao {
    id: string
    name: string
}

interface CondicoesTabProps {
    agentId?: string | null
    rules: RuleData[]
    onChange: (rules: RuleData[]) => void
}

/**
 * O campo da janela de expediente: duas horas e os dias.
 *
 * Dias como botões e não como lista de seleção, porque a escolha é **múltipla** e
 * porque o resumo precisa caber ao lado — "seg, ter, qua, qui, sex 08:00–18:00"
 * é o que explica a regra a quem só passa o olho. O `type="time"` é o mesmo
 * controle que as janelas de especialista já usam.
 */
function CampoDeExpediente({
    janela,
    somenteLeitura,
    onChange,
}: {
    janela: JanelaDeExpediente
    somenteLeitura?: boolean
    onChange: (j: JanelaDeExpediente) => void
}) {
    const alternarDia = (dia: number) => {
        const dias = janela.dias.includes(dia)
            ? janela.dias.filter((d) => d !== dia)
            : [...janela.dias, dia].sort((a, b) => a - b)
        onChange({ ...janela, dias })
    }

    return (
        <div className="min-w-[280px] flex-1 space-y-2">
            <div className="flex items-center gap-2">
                <Input
                    type="time"
                    className="w-[110px] bg-muted/50"
                    aria-label="Início do atendimento"
                    disabled={somenteLeitura}
                    value={janela.inicio}
                    onChange={(e) => onChange({ ...janela, inicio: e.target.value })}
                />
                <span className="text-sm text-muted-foreground">às</span>
                <Input
                    type="time"
                    className="w-[110px] bg-muted/50"
                    aria-label="Fim do atendimento"
                    disabled={somenteLeitura}
                    value={janela.fim}
                    onChange={(e) => onChange({ ...janela, fim: e.target.value })}
                />
            </div>

            <div className="flex flex-wrap gap-1">
                {DIAS_DA_SEMANA.map((nome, dia) => {
                    const ligado = janela.dias.includes(dia)
                    return (
                        <button
                            key={nome}
                            type="button"
                            disabled={somenteLeitura}
                            aria-pressed={ligado}
                            aria-label={nome}
                            onClick={() => alternarDia(dia)}
                            className={cn(
                                'h-7 rounded px-2 text-xs font-medium transition-colors disabled:opacity-50',
                                ligado
                                    ? 'bg-primary-subtle text-primary-subtle-foreground'
                                    : 'bg-muted text-muted-foreground hover:bg-muted/70'
                            )}
                        >
                            {nome.slice(0, 3)}
                        </button>
                    )
                })}
            </div>

            {janela.fim <= janela.inicio ? (
                <p className="text-xs text-destructive">
                    O fim tem de ser depois do início — do jeito que está, a regra não dispara.
                </p>
            ) : janela.dias.length === 0 ? (
                <p className="text-xs text-destructive">
                    Escolha ao menos um dia — do jeito que está, a regra não dispara.
                </p>
            ) : (
                <p className="text-xs text-muted-foreground">{descreverJanela(janela)}</p>
            )}
        </div>
    )
}

export function CondicoesTab({ rules, onChange }: CondicoesTabProps) {
    const [stages, setStages] = useState<Opcao[]>([])
    const [departments, setDepartments] = useState<Opcao[]>([])
    const [tags, setTags] = useState<Opcao[]>([])

    /**
     * As listas que as ações precisam para oferecer escolha em vez de pedir que
     * alguém digite um id. Falhar aqui não trava a tela: o campo
     * correspondente avisa que a lista não carregou.
     */
    useEffect(() => {
        const carregar = async () => {
            const [s, d, t] = await Promise.all([
                fetch('/api/pipelines').then((r) => (r.ok ? r.json() : [])).catch(() => []),
                fetch('/api/departments').then((r) => (r.ok ? r.json() : null)).catch(() => null),
                fetch('/api/tags').then((r) => (r.ok ? r.json() : null)).catch(() => null),
            ])
            if (Array.isArray(s)) setStages(s.map((x) => ({ id: x.id, name: x.name })))
            if (d?.data) setDepartments(d.data.map((x: Opcao) => ({ id: x.id, name: x.name })))
            if (t?.data) setTags(t.data.map((x: Opcao) => ({ id: x.id, name: x.name })))
        }
        void carregar()
    }, [])

    const atualizarRegra = (i: number, patch: Partial<RuleData>) => {
        const proximas = [...rules]
        proximas[i] = { ...proximas[i], ...patch }
        onChange(proximas)
    }

    const addRule = () => {
        onChange([
            ...rules,
            {
                name: '',
                isActive: true,
                priority: 0,
                // Nasce com uma condição que funciona, não com a que nunca dispara.
                conditions: [{ type: 'message_contains', operator: 'contains', value: '' }],
                actions: [{ type: 'send_message', params: { message: '' } }],
            },
        ])
    }

    const atualizarCondicao = (ri: number, ci: number, patch: Partial<RuleCondition>) => {
        const conditions = [...rules[ri].conditions]
        const atual = { ...conditions[ci], ...patch }

        // Trocar o tipo troca o operador junto: um operador que o tipo novo não
        // aceita faz a condição nunca casar, sem nada na tela dizendo por quê.
        if (patch.type && isSuportada(patch.type)) {
            const def = CONDICOES[patch.type]
            const permitidos = def.operadores.map((o) => o.value)
            if (!permitidos.includes(atual.operator)) {
                atual.operator = permitidos[0] as RuleCondition['operator']
            }
            /**
             * Cada tipo nasce com o valor que **já funciona**, e não com `''`.
             *
             * Texto vazio é um começo legítimo para "a mensagem contém"; para a
             * janela de expediente seria uma condição malformada, que não dispara
             * e não diz por quê. A janela nasce seg–sex 08:00–18:00; a pergunta
             * de primeira mensagem nasce "sim", que é o caso de quem a escolhe.
             */
            atual.value =
                def.tipo === 'expediente' ? { ...JANELA_PADRAO } : def.tipo === 'booleano' ? true : ''
        }

        conditions[ci] = atual
        atualizarRegra(ri, { conditions })
    }

    const atualizarAcao = (ri: number, ai: number, patch: Partial<RuleAction>) => {
        const actions = [...rules[ri].actions]
        // Trocar o tipo zera os parâmetros: o que servia à ação anterior não
        // serve à nova, e um parâmetro órfão faz o executor falhar em silêncio.
        actions[ai] = patch.type
            ? { type: patch.type, params: {} }
            : { ...actions[ai], ...patch }
        atualizarRegra(ri, { actions })
    }

    const valorNaTela = (c: RuleCondition): string => {
        if (Array.isArray(c.value)) return c.value.join(', ')
        // Objeto é a janela de expediente, que tem campo próprio — `String()`
        // num objeto imprimiria `[object Object]` dentro do input.
        if (c.value && typeof c.value === 'object') return ''
        return c.value === undefined || c.value === null ? '' : String(c.value)
    }

    /** Texto vira lista (qualquer-uma-delas); tempo vira número. */
    const gravarValor = (tipo: CondicaoSuportada, texto: string): RuleCondition['value'] => {
        if (CONDICOES[tipo].tipo === 'numero') return Number(texto)
        const partes = texto.split(',').map((p) => p.trim()).filter(Boolean)
        return partes.length > 1 ? partes : texto
    }

    return (
        <div className="space-y-6">
            <div>
                <p className="text-[12.5px] text-muted-foreground">
                    Regras que rodam antes do Agente responder. A primeira que responder,
                    transferir ou encerrar fecha a vez dele nesta mensagem.
                </p>
                {/*
                  * O widget do site não passa pelas regras — e isso precisa estar
                  * escrito. A mensagem que chega por ele vai direto para a fila de
                  * resposta do Agente: nenhuma regra é avaliada, e quem configurou
                  * uma transferência por palavra-chave acreditaria que ela vale em
                  * todos os canais.
                  */}
                <p className="mt-1 text-[12.5px] text-muted-foreground">
                    Valem para <strong className="font-semibold text-foreground">WhatsApp e
                    Instagram</strong>. O widget do site não passa por elas: a mensagem vai
                    direto para o Agente.
                </p>
            </div>

            {rules.length === 0 && (
                <div className="rounded-lg border border-dashed p-8 text-center">
                    <p className="text-[12.5px] text-muted-foreground">
                        Nenhuma regra ainda. O Agente responde todas as mensagens sozinho.
                    </p>
                </div>
            )}

            <div className="space-y-4">
                {rules.map((rule, ri) => (
                    <div key={rule.id ?? ri} className="space-y-4 rounded-lg border p-4">
                        {/* Cabeçalho da regra */}
                        <div className="flex flex-wrap items-end gap-3">
                            <div className="min-w-[200px] flex-1 space-y-2">
                                <Label>Nome da regra</Label>
                                <Input
                                    placeholder="Ex: Pergunta sobre preço"
                                    value={rule.name}
                                    onChange={(e) => atualizarRegra(ri, { name: e.target.value })}
                                />
                            </div>

                            <div className="w-28 space-y-2">
                                <Label>Prioridade</Label>
                                <Input
                                    type="number"
                                    value={rule.priority ?? 0}
                                    onChange={(e) =>
                                        atualizarRegra(ri, { priority: Number(e.target.value) })
                                    }
                                />
                            </div>

                            <div className="flex items-center gap-2 pb-2">
                                <Switch
                                    checked={rule.isActive}
                                    onCheckedChange={(v) => atualizarRegra(ri, { isActive: v })}
                                />
                                <span className="text-[12.5px] text-muted-foreground">Ativa</span>
                            </div>

                            <Button
                                variant="ghost"
                                size="icon"
                                className="mb-1"
                                onClick={() => onChange(rules.filter((_, i) => i !== ri))}
                            >
                                <Trash2 className="h-4 w-4" />
                            </Button>
                        </div>

                        <p className="text-xs text-muted-foreground">
                            Maior prioridade é avaliada primeiro. Todas as condições
                            precisam ser verdadeiras para a regra disparar.
                        </p>

                        {/* SE */}
                        <div className="space-y-3">
                            <Label className="text-sm font-medium">SE (todas)</Label>

                            {rule.conditions.map((condition, ci) => {
                                const def = isSuportada(condition.type)
                                    ? CONDICOES[condition.type]
                                    : null
                                const suportada = def !== null

                                return (
                                    <div key={ci} className="space-y-2">
                                        {!suportada && (
                                            <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
                                                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                                                <span>
                                                    Esta condição (<strong>{condition.type}</strong>) nunca
                                                    dispara — ela depende de um recurso que não existe.
                                                    Escolha outro tipo para a regra voltar a funcionar.
                                                </span>
                                            </div>
                                        )}

                                        <div className="flex flex-wrap items-center gap-3">
                                            <select
                                                value={suportada ? condition.type : ''}
                                                onChange={(e) =>
                                                    atualizarCondicao(ri, ci, {
                                                        type: e.target.value as RuleCondition['type'],
                                                    })
                                                }
                                                className="h-10 min-w-[220px] flex-1 rounded-md border bg-muted/50 px-3 text-sm"
                                            >
                                                {!suportada && <option value="">Selecione…</option>}
                                                {Object.entries(CONDICOES).map(([value, c]) => (
                                                    <option key={value} value={value}>
                                                        {c.label}
                                                    </option>
                                                ))}
                                            </select>

                                            <select
                                                value={condition.operator}
                                                disabled={!def}
                                                onChange={(e) =>
                                                    atualizarCondicao(ri, ci, {
                                                        operator: e.target
                                                            .value as RuleCondition['operator'],
                                                    })
                                                }
                                                className="h-10 w-36 rounded-md border bg-muted/50 px-3 text-sm disabled:opacity-50"
                                            >
                                                {(def?.operadores ?? []).map((o) => (
                                                    <option key={o.value} value={o.value}>
                                                        {o.label}
                                                    </option>
                                                ))}
                                            </select>

                                            {def?.tipo === 'expediente' ? (
                                                <CampoDeExpediente
                                                    janela={
                                                        normalizarJanela(condition.value) ??
                                                        JANELA_PADRAO
                                                    }
                                                    onChange={(janela) =>
                                                        atualizarCondicao(ri, ci, { value: janela })
                                                    }
                                                />
                                            ) : def?.tipo === 'booleano' ? (
                                                <select
                                                    className="h-10 min-w-[180px] flex-1 rounded-md border bg-muted/50 px-3 text-sm"
                                                    aria-label={def.label}
                                                    value={
                                                        String(condition.value) === 'false'
                                                            ? 'false'
                                                            : 'true'
                                                    }
                                                    onChange={(e) =>
                                                        atualizarCondicao(ri, ci, {
                                                            value: e.target.value === 'true',
                                                        })
                                                    }
                                                >
                                                    <option value="true">sim</option>
                                                    <option value="false">não</option>
                                                </select>
                                            ) : (
                                                <Input
                                                    className="min-w-[180px] flex-1 bg-muted/50"
                                                    type={def?.tipo === 'numero' ? 'number' : 'text'}
                                                    placeholder={def?.placeholder}
                                                    disabled={!def}
                                                    value={valorNaTela(condition)}
                                                    onChange={(e) =>
                                                        atualizarCondicao(ri, ci, {
                                                            value: def
                                                                ? gravarValor(
                                                                      condition.type as CondicaoSuportada,
                                                                      e.target.value
                                                                  )
                                                                : e.target.value,
                                                        })
                                                    }
                                                />
                                            )}

                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                disabled={rule.conditions.length === 1}
                                                onClick={() =>
                                                    atualizarRegra(ri, {
                                                        conditions: rule.conditions.filter(
                                                            (_, i) => i !== ci
                                                        ),
                                                    })
                                                }
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>

                                        {def && (
                                            <p className="text-xs text-muted-foreground">{def.ajuda}</p>
                                        )}
                                    </div>
                                )
                            })}

                            <Button
                                variant="link"
                                className="h-auto p-0 text-primary"
                                onClick={() =>
                                    atualizarRegra(ri, {
                                        conditions: [
                                            ...rule.conditions,
                                            {
                                                type: 'message_contains',
                                                operator: 'contains',
                                                value: '',
                                            },
                                        ],
                                    })
                                }
                            >
                                + Adicionar condição
                            </Button>
                        </div>

                        {/* ENTÃO */}
                        <div className="space-y-3">
                            <Label className="text-sm font-medium">ENTÃO</Label>

                            {rule.actions.map((action, ai) => (
                                <div key={ai} className="space-y-2 rounded-md border bg-muted/20 p-3">
                                    <div className="flex items-center gap-3">
                                        <select
                                            value={action.type}
                                            onChange={(e) =>
                                                atualizarAcao(ri, ai, {
                                                    type: e.target.value as RuleAction['type'],
                                                })
                                            }
                                            className="h-10 flex-1 rounded-md border bg-background px-3 text-sm"
                                        >
                                            {ACOES.map((a) => (
                                                <option key={a.value} value={a.value}>
                                                    {a.label}
                                                </option>
                                            ))}
                                        </select>

                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            disabled={rule.actions.length === 1}
                                            onClick={() =>
                                                atualizarRegra(ri, {
                                                    actions: rule.actions.filter((_, i) => i !== ai),
                                                })
                                            }
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>

                                    <ParametrosDaAcao
                                        action={action}
                                        stages={stages}
                                        departments={departments}
                                        tags={tags}
                                        onParams={(params) =>
                                            atualizarAcao(ri, ai, {
                                                params: { ...action.params, ...params },
                                            })
                                        }
                                    />
                                </div>
                            ))}

                            <Button
                                variant="link"
                                className="h-auto p-0 text-primary"
                                onClick={() =>
                                    atualizarRegra(ri, {
                                        actions: [
                                            ...rule.actions,
                                            { type: 'send_message', params: { message: '' } },
                                        ],
                                    })
                                }
                            >
                                + Adicionar ação
                            </Button>
                        </div>
                    </div>
                ))}
            </div>

            <Button onClick={addRule} variant="outline" className="w-full">
                <Plus className="mr-2 h-4 w-4" />
                Adicionar regra
            </Button>
        </div>
    )
}

/** Cada ação pede o que o executor vai de fato ler. */
function ParametrosDaAcao({
    action,
    stages,
    departments,
    tags,
    onParams,
}: {
    action: RuleAction
    stages: Opcao[]
    departments: Opcao[]
    tags: Opcao[]
    onParams: (params: Record<string, unknown>) => void
}) {
    const texto = (chave: string) => String(action.params[chave] ?? '')

    switch (action.type) {
        case 'send_message':
            return (
                <Textarea
                    placeholder="O que o Agente deve responder…"
                    className="min-h-[70px] bg-background"
                    value={texto('message')}
                    onChange={(e) => onParams({ message: e.target.value })}
                />
            )

        case 'close_conversation':
            return (
                <div className="space-y-2">
                    <Input
                        className="bg-background"
                        placeholder="Nota interna do encerramento (opcional)"
                        value={texto('note')}
                        onChange={(e) => onParams({ note: e.target.value })}
                    />
                    <p className="text-xs text-muted-foreground">
                        O atendimento é finalizado e o Agente não responde esta mensagem. Quem
                        escrever depois reabre a conversa, e o limite de interações recomeça.
                    </p>
                </div>
            )

        case 'notify_human':
            return (
                <div className="space-y-2">
                    <Input
                        className="bg-background"
                        placeholder="Nota interna para quem assumir (opcional)"
                        value={texto('note')}
                        onChange={(e) => onParams({ note: e.target.value })}
                    />
                    {/* Sem departamento cadastrado, o seletor só oferece "deixar
                        em espera", que é o que a regra já faz sem ele. */}
                    {departments.length > 0 ? (
                        <select
                            value={texto('departmentId')}
                            onChange={(e) => onParams({ departmentId: e.target.value || undefined })}
                            className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                        >
                            <option value="">Deixar em espera, sem responsável</option>
                            {departments.map((d) => (
                                <option key={d.id} value={d.id}>
                                    Atribuir ao departamento {d.name}
                                </option>
                            ))}
                        </select>
                    ) : null}
                </div>
            )

        case 'add_tag':
            return (
                <>
                    <Input
                        className="bg-background"
                        list="etiquetas-existentes"
                        placeholder="Nome da etiqueta"
                        value={texto('tagName')}
                        onChange={(e) => onParams({ tagName: e.target.value })}
                    />
                    <datalist id="etiquetas-existentes">
                        {tags.map((t) => (
                            <option key={t.id} value={t.name} />
                        ))}
                    </datalist>
                    <p className="text-xs text-muted-foreground">
                        Etiqueta nova é criada na primeira vez que a regra disparar.
                    </p>
                </>
            )

        case 'move_pipeline':
            return stages.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                    Nenhuma fase de funil encontrada. Crie as fases em Negócios antes de usar
                    esta ação.
                </p>
            ) : (
                <select
                    value={texto('stageId')}
                    onChange={(e) => onParams({ stageId: e.target.value })}
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                >
                    <option value="">Escolha a fase de destino…</option>
                    {stages.map((s) => (
                        <option key={s.id} value={s.id}>
                            {s.name}
                        </option>
                    ))}
                </select>
            )

        case 'schedule_followup':
            return (
                <div className="space-y-2">
                    <select
                        value={String(action.params.delayMinutes ?? 1440)}
                        onChange={(e) => onParams({ delayMinutes: Number(e.target.value) })}
                        className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                    >
                        {PRAZOS.map((p) => (
                            <option key={p.value} value={p.value}>
                                Criar tarefa de retomada {p.label}
                            </option>
                        ))}
                    </select>
                    <select
                        value={texto('departmentId')}
                        onChange={(e) => onParams({ departmentId: e.target.value || undefined })}
                        className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                    >
                        <option value="">Sem responsável definido</option>
                        {departments.map((d) => (
                            <option key={d.id} value={d.id}>
                                Para o departamento {d.name}
                            </option>
                        ))}
                    </select>
                </div>
            )
    }
}
