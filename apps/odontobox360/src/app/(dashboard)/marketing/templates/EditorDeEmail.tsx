'use client'

import { useMemo, useState } from 'react'
import {
    ArrowDown,
    ArrowUp,
    Heading1,
    Image as ImageIcon,
    Minus,
    MousePointerClick,
    Text as TextIcon,
    Trash2,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { Button } from '@venn/ui/button'
import { Input } from '@venn/ui/input'
import { Textarea } from '@venn/ui/textarea'
import { FormField } from '@venn/core/components/shared/FormField'
import { RecordDialog } from '@venn/core/components/shared/RecordDialog'
import { useMarca } from '@venn/core/marca-contexto'
import {
    campanhaEmTexto,
    primeiroNome,
    renderCampanha,
    type Bloco,
} from '@venn/core/lib/email/blocos'

/**
 * O editor de um e-mail de campanha.
 *
 * ## Blocos, e não um editor de texto rico
 *
 * O projeto não tem — e deliberadamente não ganha — um editor WYSIWYG. Três
 * razões, e a terceira é a que decide: o dono da clínica não escreve HTML; o
 * projeto **não tem sanitizador** (`dompurify` e `sanitize-html` não estão nas
 * dependências), então HTML colado de fora viraria problema nosso; e a casca
 * precisa poder melhorar sem reescrever cada modelo já salvo.
 *
 * Com blocos, o conteúdo é dado e a aparência é código.
 *
 * ## A prévia é o mesmo render do disparo
 *
 * `renderCampanha` aqui é a **mesma função** que o fan-out chama. Uma prévia
 * aproximada seria pior que nenhuma: ela ensinaria a clínica a confiar num
 * resultado que não é o que vai sair.
 *
 * Roda no cliente porque `blocos.ts` não tem `server-only` — e não tem porque
 * esta tela é justamente o segundo consumidor dele.
 */

/** Um bloco recém-criado, com os campos vazios que a pessoa vai preencher. */
function blocoNovo(tipo: Bloco['tipo']): Bloco {
    switch (tipo) {
        case 'titulo':
            return { tipo: 'titulo', texto: '' }
        case 'texto':
            return { tipo: 'texto', texto: '' }
        case 'imagem':
            return { tipo: 'imagem', url: '', alt: '' }
        case 'botao':
            return { tipo: 'botao', texto: '', url: '' }
        case 'divisor':
            return { tipo: 'divisor' }
    }
}

const CATALOGO: { tipo: Bloco['tipo']; label: string; icone: LucideIcon }[] = [
    { tipo: 'titulo', label: 'Título', icone: Heading1 },
    { tipo: 'texto', label: 'Texto', icone: TextIcon },
    { tipo: 'imagem', label: 'Imagem', icone: ImageIcon },
    { tipo: 'botao', label: 'Botão', icone: MousePointerClick },
    { tipo: 'divisor', label: 'Divisor', icone: Minus },
]

const ROTULO: Record<Bloco['tipo'], string> = {
    titulo: 'Título',
    texto: 'Texto',
    imagem: 'Imagem',
    botao: 'Botão',
    divisor: 'Divisor',
}

export interface TemplateDeEmail {
    id: string
    name: string
    subject: string | null
    preheader: string | null
    blocks: Bloco[]
}

export function EditorDeEmail({
    aberto,
    onOpenChange,
    editando,
    onSalvo,
}: {
    aberto: boolean
    onOpenChange: (aberto: boolean) => void
    /** `null` para criar. */
    editando: TemplateDeEmail | null
    onSalvo: () => void | Promise<void>
}) {
    // A marca desce pelo React: no navegador o registro de módulo não existe
    // (quem o faz roda no servidor). Ver `marca-contexto.tsx`.
    const marca = useMarca()
    const [nome, setNome] = useState('')
    const [assunto, setAssunto] = useState('')
    const [previa, setPrevia] = useState('')
    const [blocos, setBlocos] = useState<Bloco[]>([])
    const [erros, setErros] = useState<Record<string, string>>({})
    const [enviando, setEnviando] = useState(false)
    /** Troca a cada abertura, para o formulário renascer sem `useEffect`. */
    const [geracao, setGeracao] = useState(0)

    /**
     * O formulário se refaz quando a identidade do que se edita muda.
     *
     * Em vez de um `useEffect` que copia props para estado — padrão que o
     * ESLint do projeto reprova (`react-hooks/set-state-in-effect`) e que
     * atrasa a primeira pintura em um quadro.
     */
    const chave = `${editando?.id ?? 'novo'}:${aberto}`
    const [chaveAnterior, setChaveAnterior] = useState(chave)
    if (chave !== chaveAnterior) {
        setChaveAnterior(chave)
        setNome(editando?.name ?? '')
        setAssunto(editando?.subject ?? '')
        setPrevia(editando?.preheader ?? '')
        setBlocos(editando?.blocks ?? [blocoNovo('titulo'), blocoNovo('texto')])
        setErros({})
        setGeracao((g) => g + 1)
    }

    const html = useMemo(
        () =>
            renderCampanha({
                blocos,
                // Valores de exemplo: a prévia mostra como fica **preenchido**,
                // que é o que a pessoa precisa julgar. Mostrar `{{nome}}` cru
                // esconderia justamente o defeito de frase que o campo causa.
                campos: {
                    nome: primeiroNome('Maria Aparecida da Silva'),
                    nomeCompleto: 'Maria Aparecida da Silva',
                    unidade: 'Sua unidade',
                },
                assinatura: 'Sua unidade · endereço',
                descadastroUrl: '#',
                preheader: previa || undefined,
            }),
        [blocos, previa]
    )

    function mover(indice: number, direcao: -1 | 1) {
        const destino = indice + direcao
        if (destino < 0 || destino >= blocos.length) return
        const copia = [...blocos]
        ;[copia[indice], copia[destino]] = [copia[destino], copia[indice]]
        setBlocos(copia)
    }

    function alterar(indice: number, mudanca: Partial<Bloco>) {
        setBlocos((atual) =>
            atual.map((b, i) => (i === indice ? ({ ...b, ...mudanca } as Bloco) : b))
        )
    }

    async function salvar() {
        setEnviando(true)
        setErros({})
        try {
            const corpo = {
                name: nome,
                subject: assunto || null,
                preheader: previa || null,
                // Bloco vazio não vai para o banco: a pessoa acrescentou e não
                // preencheu, e gravá-lo deixaria um buraco no e-mail enviado.
                blocks: blocos.filter((b) => !blocoVazio(b)),
            }

            const res = await fetch(
                editando
                    ? `/api/marketing/email-templates/${editando.id}`
                    : '/api/marketing/email-templates',
                {
                    method: editando ? 'PATCH' : 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(corpo),
                }
            )

            if (!res.ok) {
                const erro = (await res.json().catch(() => ({}))) as {
                    error?: string
                    campo?: string
                }
                setErros({ [erro.campo ?? 'name']: erro.error ?? 'Não foi possível salvar' })
                return
            }

            onOpenChange(false)
            await onSalvo()
        } finally {
            setEnviando(false)
        }
    }

    return (
        <RecordDialog
            open={aberto}
            onOpenChange={onOpenChange}
            size="wide"
            title={editando ? 'Editar modelo' : 'Novo modelo de e-mail'}
            description={`O conteúdo é montado em blocos. À direita aparece exatamente o que quem recebe vai ver — é o mesmo render do disparo.`}
            submitLabel={editando ? 'Salvar modelo' : 'Criar modelo'}
            hideAgain
            onSubmit={salvar}
            submitting={enviando}
        >
            <div className="col-span-2 grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
                {/* ───────────────── coluna da esquerda: o conteúdo ───────────────── */}
                <div className="min-w-0 space-y-4">
                    <FormField label="Nome do modelo" htmlFor="tpl-nome" required error={erros.name}>
                        <Input
                            id="tpl-nome"
                            value={nome}
                            onChange={(e) => setNome(e.target.value)}
                            placeholder="Retorno semestral"
                            autoFocus
                        />
                    </FormField>

                    <FormField
                        label="Assunto"
                        htmlFor="tpl-assunto"
                        error={erros.subject}
                        hint="Aceita {{nome}}. A campanha pode trocar o assunto na hora de disparar."
                    >
                        <Input
                            id="tpl-assunto"
                            value={assunto}
                            onChange={(e) => setAssunto(e.target.value)}
                            placeholder="{{nome}}, está na hora do seu retorno"
                        />
                    </FormField>

                    <FormField
                        label="Prévia"
                        htmlFor="tpl-previa"
                        error={erros.preheader}
                        hint="A linha que aparece ao lado do assunto na caixa de entrada."
                    >
                        <Input
                            id="tpl-previa"
                            value={previa}
                            onChange={(e) => setPrevia(e.target.value)}
                            placeholder="Sua limpeza semestral está em atraso"
                        />
                    </FormField>

                    <div className="space-y-2.5 border-t border-border/60 pt-4">
                        {blocos.map((bloco, i) => (
                            <CartaoDeBloco
                                key={`${geracao}-${i}`}
                                bloco={bloco}
                                primeiro={i === 0}
                                ultimo={i === blocos.length - 1}
                                onMover={(d) => mover(i, d)}
                                onAlterar={(m) => alterar(i, m)}
                                onRemover={() =>
                                    setBlocos((a) => a.filter((_, idx) => idx !== i))
                                }
                            />
                        ))}

                        {blocos.length === 0 && (
                            <p className="py-6 text-center text-sm text-muted-foreground">
                                Acrescente o primeiro bloco abaixo.
                            </p>
                        )}
                    </div>

                    <div className="flex flex-wrap gap-2 border-t border-border/60 pt-3">
                        {CATALOGO.map(({ tipo, label, icone: Icone }) => (
                            <Button
                                key={tipo}
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => setBlocos((a) => [...a, blocoNovo(tipo)])}
                            >
                                <Icone className="size-3.5" />
                                {label}
                            </Button>
                        ))}
                    </div>

                    {erros.blocks && (
                        <p className="text-sm text-destructive">{erros.blocks}</p>
                    )}
                </div>

                {/* ───────────────── coluna da direita: a prévia ───────────────── */}
                <div className="min-w-0">
                    <p className="mb-2 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
                        Como vai aparecer
                    </p>
                    {/*
                        Um `iframe` com `srcDoc`, e não uma `div` com
                        `dangerouslySetInnerHTML`: o e-mail traz tabelas e estilo
                        em atributo pensados para 600px, e solto na página ele
                        herdaria o CSS do app e mostraria algo que não é o que
                        vai sair. O `sandbox` vazio mata script e navegação —
                        a prévia não executa nada do que está sendo editado.
                    */}
                    {/*
                        Sem cor de fundo na classe, e isso é deliberado.

                        O HTML do e-mail pinta a própria — `renderCampanha` põe
                        `background-color` no `body` —, e é essa que tem de
                        aparecer. Uma cor fixa aqui seria redundante no melhor
                        caso. Um token de superfície seria pior: e-mail não
                        acompanha o tema do app, então a prévia ficaria escura
                        no modo escuro, mostrando algo que o destinatário nunca
                        vai ver.
                    */}
                    <iframe
                        title="Prévia do e-mail"
                        srcDoc={html}
                        sandbox=""
                        className="h-[420px] w-full rounded-lg border border-border/60"
                    />
                    <p className="mt-2 text-xs text-muted-foreground">
                        Os nomes são de exemplo. No disparo, cada pessoa recebe o dela — e quem
                        não tiver nome cadastrado recebe a frase sem o buraco.
                    </p>
                    <details className="mt-3">
                        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                            Ver em texto puro
                        </summary>
                        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-border/60 bg-muted/30 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
                            {campanhaEmTexto({
                                blocos,
                                campos: { nome: 'Maria', unidade: 'Sua unidade' },
                                assinatura: 'Sua unidade · endereço',
                                descadastroUrl: `https://${marca.appHost}/descadastro/…`,
                                preheader: previa || undefined,
                            })}
                        </pre>
                    </details>
                </div>
            </div>
        </RecordDialog>
    )
}

/** Um bloco sem conteúdo — acrescentado e nunca preenchido. */
function blocoVazio(bloco: Bloco): boolean {
    switch (bloco.tipo) {
        case 'titulo':
        case 'texto':
            return bloco.texto.trim().length === 0
        case 'imagem':
            return bloco.url.trim().length === 0
        case 'botao':
            return bloco.texto.trim().length === 0 || bloco.url.trim().length === 0
        case 'divisor':
            return false
    }
}

function CartaoDeBloco({
    bloco,
    primeiro,
    ultimo,
    onMover,
    onAlterar,
    onRemover,
}: {
    bloco: Bloco
    primeiro: boolean
    ultimo: boolean
    onMover: (direcao: -1 | 1) => void
    onAlterar: (mudanca: Partial<Bloco>) => void
    onRemover: () => void
}) {
    return (
        <div className="rounded-lg border border-border/60 bg-card p-3">
            <div className="mb-2 flex items-center justify-between">
                <span className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
                    {ROTULO[bloco.tipo]}
                </span>
                {/*
                    Setas, e não arrastar. `@dnd-kit` está no projeto e daria
                    conta, mas arrastar dentro de um diálogo que já rola é a
                    interação mais fácil de errar no celular — e a ordem de
                    cinco blocos se resolve com dois cliques.
                */}
                <div className="flex items-center gap-0.5">
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        disabled={primeiro}
                        onClick={() => onMover(-1)}
                        aria-label="Mover para cima"
                    >
                        <ArrowUp className="size-3.5" />
                    </Button>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        disabled={ultimo}
                        onClick={() => onMover(1)}
                        aria-label="Mover para baixo"
                    >
                        <ArrowDown className="size-3.5" />
                    </Button>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={onRemover}
                        aria-label={`Remover ${ROTULO[bloco.tipo].toLowerCase()}`}
                        className="text-muted-foreground hover:text-destructive"
                    >
                        <Trash2 className="size-3.5" />
                    </Button>
                </div>
            </div>

            {bloco.tipo === 'titulo' && (
                <Input
                    value={bloco.texto}
                    onChange={(e) => onAlterar({ texto: e.target.value })}
                    placeholder="Oi {{nome}}, faz um tempinho!"
                />
            )}

            {bloco.tipo === 'texto' && (
                <Textarea
                    value={bloco.texto}
                    onChange={(e) => onAlterar({ texto: e.target.value })}
                    placeholder={'Escreva aqui.\n\nUma linha em branco começa um parágrafo novo.'}
                    rows={4}
                />
            )}

            {bloco.tipo === 'imagem' && (
                <div className="space-y-2">
                    <Input
                        value={bloco.url}
                        onChange={(e) => onAlterar({ url: e.target.value })}
                        placeholder="https://… endereço da imagem"
                    />
                    <Input
                        value={bloco.alt ?? ''}
                        onChange={(e) => onAlterar({ alt: e.target.value })}
                        placeholder="Descrição da imagem (aparece quando ela não carrega)"
                    />
                </div>
            )}

            {bloco.tipo === 'botao' && (
                <div className="space-y-2">
                    <Input
                        value={bloco.texto}
                        onChange={(e) => onAlterar({ texto: e.target.value })}
                        placeholder="Escolher um horário"
                    />
                    <Input
                        value={bloco.url}
                        onChange={(e) => onAlterar({ url: e.target.value })}
                        placeholder="https://… para onde o botão leva"
                    />
                </div>
            )}

            {bloco.tipo === 'divisor' && (
                <p className="text-xs text-muted-foreground">Uma linha separando o que vem antes do que vem depois.</p>
            )}
        </div>
    )
}
