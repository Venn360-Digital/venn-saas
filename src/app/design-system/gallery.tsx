'use client'

import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'
import {
    Calendar,
    Check,
    ChevronDown,
    Download,
    Inbox,
    Moon,
    Plus,
    Search,
    Sun,
    Trash2,
    TriangleAlert,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table'

/* Reads the token straight out of the cascade, so a swatch can never claim a
   colour the stylesheet stopped using. */
function useTokenValues(names: string[]) {
    const { resolvedTheme } = useTheme()
    const [values, setValues] = useState<Record<string, string>>({})

    useEffect(() => {
        const styles = getComputedStyle(document.documentElement)
        const next: Record<string, string> = {}
        for (const name of names) {
            next[name] = styles.getPropertyValue(`--${name}`).trim()
        }
        setValues(next)
        // resolvedTheme is the dependency that matters: the same token names
        // resolve to different values once .dark is on the html element.
    }, [resolvedTheme, names.join(',')])

    return values
}

type Swatch = { token: string; use: string; pair?: string }

const SURFACES: Swatch[] = [
    { token: 'background', use: 'Fundo de página', pair: 'foreground' },
    { token: 'card', use: 'Card, painel, linha', pair: 'card-foreground' },
    { token: 'popover', use: 'Menu, dropdown, tooltip', pair: 'popover-foreground' },
]

const ACTION: Swatch[] = [
    { token: 'primary', use: 'Ação primária', pair: 'primary-foreground' },
    { token: 'primary-hover', use: 'Hover — nunca /90' },
    { token: 'primary-active', use: 'Pressionado' },
    { token: 'primary-subtle', use: 'Fundo tingido de ação', pair: 'primary-subtle-foreground' },
]

const NEUTRALS: Swatch[] = [
    { token: 'muted', use: 'Preenchimento mais quieto', pair: 'muted-foreground' },
    { token: 'secondary', use: 'Botão secundário', pair: 'secondary-foreground' },
    { token: 'accent', use: 'Superfície de hover', pair: 'accent-foreground' },
]

const STATES: Swatch[] = [
    { token: 'success', use: 'Confirmado, pago, ativo', pair: 'success-foreground' },
    { token: 'warning', use: 'Atrasado, pendente', pair: 'warning-foreground' },
    { token: 'info', use: 'Informativo', pair: 'info-foreground' },
    { token: 'destructive', use: 'Apagar, falhar', pair: 'destructive-foreground' },
]

const LINES: Swatch[] = [
    { token: 'border', use: 'Divisor, borda de card' },
    { token: 'border-strong', use: 'Divisor enfatizado' },
    { token: 'input', use: 'Borda de campo' },
    { token: 'ring', use: 'Anel de foco' },
]

const CHARTS: Swatch[] = [1, 2, 3, 4, 5].map((n) => ({
    token: `chart-${n}`,
    use: `Série ${n}`,
}))

const ALL_TOKENS = [
    ...SURFACES,
    ...ACTION,
    ...NEUTRALS,
    ...STATES,
    ...LINES,
    ...CHARTS,
].flatMap((s) => (s.pair ? [s.token, s.pair] : [s.token]))

function Section({
    n,
    title,
    lead,
    children,
}: {
    n: string
    title: string
    lead?: string
    children: React.ReactNode
}) {
    return (
        <section className="border-t border-border pt-8">
            <div className="mb-5 flex items-baseline gap-3">
                <span className="num text-sm text-muted-foreground">{n}</span>
                <h2 className="text-h2">{title}</h2>
            </div>
            {lead ? (
                <p className="mb-5 max-w-[65ch] text-sm text-muted-foreground">{lead}</p>
            ) : null}
            {children}
        </section>
    )
}

function SwatchRow({
    swatches,
    values,
}: {
    swatches: Swatch[]
    values: Record<string, string>
}) {
    return (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {swatches.map((s) => (
                <div
                    key={s.token}
                    className="overflow-hidden rounded-lg border border-border bg-card"
                >
                    <div
                        className="flex h-16 items-center justify-center text-xs"
                        style={{
                            backgroundColor: `var(--${s.token})`,
                            color: s.pair ? `var(--${s.pair})` : undefined,
                        }}
                    >
                        {s.pair ? 'Texto sobre' : null}
                    </div>
                    <div className="space-y-0.5 px-3 py-2">
                        <p className="font-mono text-xs text-foreground">--{s.token}</p>
                        <p className="num text-xs text-muted-foreground">
                            {values[s.token] || '—'}
                        </p>
                        <p className="text-xs text-muted-foreground">{s.use}</p>
                    </div>
                </div>
            ))}
        </div>
    )
}

export function DesignSystemGallery() {
    const { resolvedTheme, setTheme } = useTheme()
    const [mounted, setMounted] = useState(false)
    const values = useTokenValues(ALL_TOKENS)

    useEffect(() => setMounted(true), [])

    const isDark = resolvedTheme === 'dark'

    return (
        <div className="min-h-screen bg-background">
            <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur-sm">
                <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
                    <div>
                        <h1 className="text-h1">Design system</h1>
                        <p className="text-sm text-muted-foreground">
                            Os componentes reais, com os tokens reais
                        </p>
                    </div>
                    {mounted ? (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setTheme(isDark ? 'light' : 'dark')}
                        >
                            {isDark ? <Sun /> : <Moon />}
                            {isDark ? 'Claro' : 'Escuro'}
                        </Button>
                    ) : (
                        <Skeleton className="h-8 w-24" />
                    )}
                </div>
            </header>

            <main className="mx-auto max-w-5xl space-y-10 px-6 py-8">
                <p className="max-w-[65ch] text-sm text-muted-foreground">
                    Esta página lê os valores direto da folha de estilo computada — ela
                    não pode afirmar uma cor que o CSS deixou de usar. As decisões e o
                    porquê de cada uma estão em{' '}
                    <code className="font-mono text-xs text-foreground">DESIGN.md</code>.
                </p>

                <Section
                    n="01"
                    title="Superfície"
                    lead="O fundo de página é levemente tingido para que o card branco leia como levantado. Antes os dois eram o mesmo branco, e era por isso que o main precisava de uma tinta falsa."
                >
                    <SwatchRow swatches={SURFACES} values={values} />
                </Section>

                <Section
                    n="02"
                    title="Ação"
                    lead="A ação é o azul médio, não o navy — um preenchimento navy seria o elemento mais alto da tela. Hover e active são tokens próprios: misturar o preenchimento em direção ao transparente sobre página branca deixa o hover mais claro que o repouso, e o botão lê como desabilitado justamente enquanto está sendo apontado."
                >
                    <SwatchRow swatches={ACTION} values={values} />
                </Section>

                <Section
                    n="03"
                    title="Neutros"
                    lead="Três degraus distintos, não três nomes para o mesmo cinza. accent é a superfície de hover do shadcn — a menta não vive aqui, senão todo hover de dropdown fica verde."
                >
                    <SwatchRow swatches={NEUTRALS} values={values} />
                </Section>

                <Section
                    n="04"
                    title="Estado"
                    lead="Tinta pálida para estado passivo (badge, chip, banner); preenchimento sólido para controle (botão, checkbox). O nome do token diz o par: bg-*-subtle anda com text-*-subtle-foreground."
                >
                    <div className="space-y-4">
                        <SwatchRow swatches={STATES} values={values} />
                        <div className="flex flex-wrap gap-2">
                            <Badge variant="success">Confirmado</Badge>
                            <Badge variant="warning">Atrasado</Badge>
                            <Badge variant="info">Em análise</Badge>
                            <Badge variant="destructive">Perdido</Badge>
                            <Badge variant="neutral">Rascunho</Badge>
                            <Badge>Padrão</Badge>
                            <Badge variant="outline">Contorno</Badge>
                            <Badge variant="secondary">Secundário</Badge>
                        </div>
                    </div>
                </Section>

                <Section n="05" title="Linhas e foco">
                    <SwatchRow swatches={LINES} values={values} />
                </Section>

                <Section
                    n="06"
                    title="Gráficos"
                    lead="Entradas vizinhas trocam de família cromática, para que duas séries adjacentes não colem."
                >
                    <div className="space-y-4">
                        <SwatchRow swatches={CHARTS} values={values} />
                        <div className="flex h-24 items-end gap-2 rounded-lg border border-border bg-card p-4">
                            {[64, 42, 78, 30, 54].map((h, i) => (
                                <div
                                    key={i}
                                    className="flex-1 rounded-sm"
                                    style={{
                                        height: `${h}%`,
                                        backgroundColor: `var(--chart-${i + 1})`,
                                    }}
                                />
                            ))}
                        </div>
                    </div>
                </Section>

                <Section
                    n="07"
                    title="Tipografia"
                    lead="Open Sans em título e corpo; Inter só nos números, onde o numeral tabular mantém coluna alinhada. A escala da referência era não-monotônica — os pixels foram preservados, os papéis remapeados."
                >
                    <div className="space-y-4 rounded-lg border border-border bg-card p-6">
                        <div>
                            <p className="mb-1 font-mono text-xs text-muted-foreground">
                                text-display · 40/1.2 · painel de marca
                            </p>
                            <p className="text-display">Atendimento que não perde paciente</p>
                        </div>
                        <div>
                            <p className="mb-1 font-mono text-xs text-muted-foreground">
                                text-h1 · 28/1.2 · título de página
                            </p>
                            <p className="text-h1">Contatos</p>
                        </div>
                        <div>
                            <p className="mb-1 font-mono text-xs text-muted-foreground">
                                text-h2 · 24/1.25 · seção
                            </p>
                            <p className="text-h2">Dados do paciente</p>
                        </div>
                        <div>
                            <p className="mb-1 font-mono text-xs text-muted-foreground">
                                text-h3 · 20/1.3 · título de card e dialog
                            </p>
                            <p className="text-h3">Próximas consultas</p>
                        </div>
                        <div>
                            <p className="mb-1 font-mono text-xs text-muted-foreground">
                                text-h4 · 16/1.4 · sub-seção
                            </p>
                            <p className="text-h4">Convênio</p>
                        </div>
                        <div>
                            <p className="mb-1 font-mono text-xs text-muted-foreground">
                                text-sm · 14/1.5 · corpo, o padrão do app
                            </p>
                            <p className="max-w-[65ch] text-sm">
                                A paciente confirmou a consulta de limpeza para quinta às 14h e
                                pediu para remarcar a avaliação de clareamento.
                            </p>
                        </div>
                        <div>
                            <p className="mb-1 font-mono text-xs text-muted-foreground">
                                font-mono · stack de sistema · ID, chave, URL
                            </p>
                            <p className="font-mono text-sm">wh_8f2a1c9e04b7</p>
                        </div>
                        <div>
                            <p className="mb-1 font-mono text-xs text-muted-foreground">
                                num · Inter tabular — compare o alinhamento
                            </p>
                            <div className="grid max-w-[14rem] grid-cols-2 gap-x-4 text-sm">
                                <span className="num text-right">1.284,00</span>
                                <span className="text-right">1.284,00</span>
                                <span className="num text-right">911,50</span>
                                <span className="text-right">911,50</span>
                                <span className="num text-right">47.003,19</span>
                                <span className="text-right">47.003,19</span>
                            </div>
                        </div>
                    </div>
                </Section>

                <Section
                    n="08"
                    title="Botões"
                    lead="Um primário por tela. O resto é outline, secondary ou ghost. Ação destrutiva sempre pede confirmação."
                >
                    <div className="space-y-4 rounded-lg border border-border bg-card p-6">
                        <div className="flex flex-wrap items-center gap-2">
                            <Button>
                                <Plus />
                                Novo contato
                            </Button>
                            <Button variant="secondary">Secundário</Button>
                            <Button variant="outline">
                                <Download />
                                Exportar
                            </Button>
                            <Button variant="ghost">Ghost</Button>
                            <Button variant="link">Link</Button>
                            <Button variant="destructive">
                                <Trash2 />
                                Apagar
                            </Button>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <Button size="xs">Extra pequeno</Button>
                            <Button size="sm">Pequeno</Button>
                            <Button>Padrão</Button>
                            <Button size="lg">Grande</Button>
                            <Button disabled>Desabilitado</Button>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button variant="outline" size="icon-sm" aria-label="Buscar">
                                        <Search />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>Buscar</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button variant="outline" size="icon" aria-label="Agenda">
                                        <Calendar />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>Agenda</TooltipContent>
                            </Tooltip>
                            <span className="text-xs text-muted-foreground">
                                Botão só de ícone precisa de tooltip e aria-label
                            </span>
                        </div>
                    </div>
                </Section>

                <Section
                    n="09"
                    title="Campos"
                    lead="Use o primitivo pelado. Input, Select e Textarea já resolvem superfície, borda, placeholder e foco nos dois modos — qualquer classe de cor que se sinta vontade de adicionar num campo é, quase sempre, uma que o primitivo já aplica melhor."
                >
                    <div className="grid gap-5 rounded-lg border border-border bg-card p-6 sm:grid-cols-2">
                        <div className="space-y-2">
                            <Label htmlFor="ds-email">E-mail</Label>
                            <Input id="ds-email" type="email" placeholder="nome@clinica.com.br" />
                            <p className="text-xs text-muted-foreground">
                                Placeholder é exemplo real, não instrução
                            </p>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="ds-conv">Convênio</Label>
                            <Select>
                                <SelectTrigger id="ds-conv">
                                    <SelectValue placeholder="Selecione" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="particular">Particular</SelectItem>
                                    <SelectItem value="amil">Amil Dental</SelectItem>
                                    <SelectItem value="odonto">OdontoPrev</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="ds-err">Telefone</Label>
                            <Input id="ds-err" aria-invalid defaultValue="31 9999" />
                            <p className="text-xs text-destructive">
                                Informe o telefone com DDD e 9 dígitos
                            </p>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="ds-obs">Observação</Label>
                            <Textarea id="ds-obs" placeholder="Alergia a anestésico, por exemplo" />
                        </div>
                        <div className="flex items-center gap-3">
                            <Checkbox id="ds-check" defaultChecked />
                            <Label htmlFor="ds-check">Enviar lembrete por WhatsApp</Label>
                        </div>
                        <div className="flex items-center gap-3">
                            <Switch id="ds-switch" defaultChecked />
                            <Label htmlFor="ds-switch">Agente responde fora do horário</Label>
                        </div>
                    </div>
                </Section>

                <Section
                    n="10"
                    title="Tabela"
                    lead="Cabeçalho em muted; dado de célula em foreground, não em muted — o dado é o conteúdo. Coluna numérica à direita e com num."
                >
                    <div className="overflow-hidden rounded-lg border border-border bg-card">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Paciente</TableHead>
                                    <TableHead>Situação</TableHead>
                                    <TableHead className="text-right">Valor</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {[
                                    ['Marina Alves', 'success', 'Confirmado', '1.284,00'],
                                    ['Rui Barbosa Filho', 'warning', 'Atrasado', '911,50'],
                                    ['Clara Nogueira', 'neutral', 'Rascunho', '47.003,19'],
                                ].map(([name, tone, label, value]) => (
                                    <TableRow key={name}>
                                        <TableCell className="text-foreground">{name}</TableCell>
                                        <TableCell>
                                            <Badge
                                                variant={
                                                    tone as 'success' | 'warning' | 'neutral'
                                                }
                                            >
                                                {label}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="num text-right text-foreground">
                                            {value}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </Section>

                <Section
                    n="11"
                    title="Estados"
                    lead="Toda tela que busca dados precisa dos quatro: carregando, vazio, erro e sucesso. Faltar um é bug, não polimento."
                >
                    <div className="grid gap-4 lg:grid-cols-3">
                        <div className="space-y-3 rounded-lg border border-border bg-card p-5">
                            <p className="text-h4">Carregando</p>
                            <div className="space-y-2">
                                <Skeleton className="h-4 w-3/4" />
                                <Skeleton className="h-4 w-full" />
                                <Skeleton className="h-4 w-2/3" />
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Skeleton, nunca a palavra Carregando
                            </p>
                        </div>

                        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-card p-5 text-center">
                            <div className="rounded-full bg-muted p-3">
                                <Inbox className="size-5 text-muted-foreground" />
                            </div>
                            <p className="text-h4">Nenhum contato ainda</p>
                            <p className="text-xs text-muted-foreground">
                                Adicione o primeiro ou importe uma planilha.
                            </p>
                            <Button size="sm" className="mt-1">
                                <Plus />
                                Novo contato
                            </Button>
                        </div>

                        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-destructive-subtle bg-destructive-subtle p-5 text-center">
                            <TriangleAlert className="size-5 text-destructive-subtle-foreground" />
                            <p className="text-h4 text-destructive-subtle-foreground">
                                Não foi possível carregar
                            </p>
                            <p className="text-xs text-destructive-subtle-foreground">
                                Verifique a conexão e tente de novo.
                            </p>
                            <Button variant="outline" size="sm" className="mt-1">
                                Tentar de novo
                            </Button>
                        </div>
                    </div>
                </Section>

                <Section
                    n="12"
                    title="Voz"
                    lead="As palavras são material de design. Sentence case, verbo primeiro, sem por favor, e erro que diz o que fazer."
                >
                    <div className="overflow-hidden rounded-lg border border-border bg-card">
                        <div className="grid grid-cols-2 border-b border-border bg-muted px-4 py-2 text-xs text-muted-foreground">
                            <span>Escreva</span>
                            <span>Não escreva</span>
                        </div>
                        {[
                            ['Contato salvo', 'Contato salvo com sucesso!'],
                            ['Informe um nome', 'Por favor, informe um nome.'],
                            ['Novo contato', 'Novo Contato'],
                            [
                                'Esse e-mail já está em uso. Tente outro.',
                                'Erro: não foi possível criar o contato.',
                            ],
                            ['Nenhum contato ainda', 'Nada aqui'],
                        ].map(([good, bad]) => (
                            <div
                                key={good}
                                className="grid grid-cols-2 gap-4 border-b border-border px-4 py-2.5 text-sm last:border-b-0"
                            >
                                <span className="flex items-start gap-2 text-foreground">
                                    <Check className="mt-0.5 size-4 shrink-0 text-success-subtle-foreground" />
                                    {good}
                                </span>
                                <span className="text-muted-foreground line-through decoration-border">
                                    {bad}
                                </span>
                            </div>
                        ))}
                    </div>
                </Section>

                <Section n="13" title="O que não fazer">
                    <ul className="max-w-[65ch] space-y-2 text-sm text-muted-foreground">
                        {[
                            'Nenhum roxo — era a identidade Kaly, e o lint falha o build se voltar.',
                            'Nenhum hex direto em .tsx fora do TagChip e dos pickers de cor.',
                            'Nenhuma aurora em blur atrás de card: clichê de dark SaaS, nada odontológico.',
                            'Nenhum card de vidro — translucidez sobre branco lê como bug de renderização.',
                            'Nenhum gradiente em CTA. Preenchimento chapado.',
                            'Nenhum confirm() ou alert() nativo.',
                            'Nenhuma transição global em *. Componente que anima declara.',
                            'Nenhum opacity em texto para fazê-lo secundário — use text-muted-foreground.',
                        ].map((rule) => (
                            <li key={rule} className="flex items-start gap-2">
                                <ChevronDown className="mt-0.5 size-4 shrink-0 -rotate-90" />
                                {rule}
                            </li>
                        ))}
                    </ul>
                </Section>
            </main>
        </div>
    )
}
