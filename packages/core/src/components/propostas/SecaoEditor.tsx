'use client'

import type { ReactNode } from 'react'
import { Plus, Trash2 } from 'lucide-react'

import { Button } from '@venn/ui/button'
import { Input } from '@venn/ui/input'
import { Label } from '@venn/ui/label'
import { ehCompromisso, ROTULO_DA_SECAO, type Secao } from '@venn/core/lib/propostas/secoes'

import { EditorDeTexto, type Paleta } from './EditorDeTexto'

/**
 * Uma seção em modo de edição — a forma de cada tipo.
 *
 * ## A forma é do produto; o conteúdo é da pessoa
 *
 * Cada tipo expõe os campos que o render conhece, e só eles: destaques têm
 * valor, rótulo e legenda; fases têm nome, prazo, responsável e descrição. Não
 * há "adicionar coluna" nem "mudar a cor": é isso que faz o documento sair
 * igual no editor, no link e na impressão — e é o que torna a IA capaz de
 * gerar uma seção, porque ela preenche campos, não desenha.
 *
 * ## Compromisso é marcado
 *
 * Seção de compromisso (`ehCompromisso`) vazia ganha um aviso: é o que a IA
 * deixa em branco de propósito, e é o que a pessoa precisa preencher antes de
 * enviar. O aviso é de tela; o envio não bloqueia por isso — um orçamento sem
 * fases é legítimo.
 *
 * ## A tabela de itens não mora aqui
 *
 * `itens` recebe o editor de itens pronto (`children`): ele fala com a rota de
 * itens, recalcula no servidor e já existia antes da v2. Esta tela só o
 * posiciona.
 */
export function SecaoEditor({
    secao,
    onChange,
    valores,
    paleta,
    children,
}: {
    secao: Secao
    onChange: (s: Secao) => void
    valores: Record<string, string | null>
    paleta: Paleta
    /** O editor de itens, quando `secao.tipo === 'itens'`. */
    children?: ReactNode
}) {
    const texto = (props: {
        id: string
        rotulo: string
        valor: string | null | undefined
        aoMudar: (v: string) => void
        curto?: boolean
        placeholder?: string
    }) => (
        <div>
            <Label htmlFor={props.id} className="mb-1.5 block text-xs">
                {props.rotulo}
            </Label>
            <EditorDeTexto
                id={props.id}
                valor={props.valor ?? ''}
                onChange={props.aoMudar}
                valores={valores}
                paleta={paleta}
                curto={props.curto}
                placeholder={props.placeholder}
            />
        </div>
    )

    const vazia = (() => {
        switch (secao.tipo) {
            case 'destaques':
                return secao.itens.length === 0
            case 'fases':
                return secao.fases.length === 0
            case 'investimento':
                return secao.cartoes.length === 0
            case 'garantia':
                return secao.blocos.length === 0
            case 'condicoes':
                return secao.corpo.trim().length === 0
            default:
                return false
        }
    })()

    return (
        <div className="space-y-3">
            {ehCompromisso(secao.tipo) && vazia && (
                <p className="rounded-md border border-warning/40 bg-warning-subtle px-3 py-2 text-xs text-warning-subtle-foreground">
                    <strong>{ROTULO_DA_SECAO[secao.tipo]}</strong> é compromisso: a IA deixa em branco de propósito.
                    Preencha antes de enviar — ou remova a seção.
                </p>
            )}

            {secao.tipo === 'capa' && (
                <>
                    {texto({ id: `${secao.id}-t`, rotulo: 'Título', valor: secao.titulo, curto: true, placeholder: 'Vazio usa o título do documento', aoMudar: (v) => onChange({ ...secao, titulo: v || null }) })}
                    {texto({ id: `${secao.id}-s`, rotulo: 'Subtítulo', valor: secao.subtitulo, curto: true, placeholder: 'Ex.: Proposta comercial para …', aoMudar: (v) => onChange({ ...secao, subtitulo: v || null }) })}
                    <p className="text-xs text-muted-foreground">
                        Nome da organização, cliente, data e número entram sozinhos. A arte da capa chega na
                        próxima fase (gerada por IA ou enviada por você).
                    </p>
                </>
            )}

            {secao.tipo === 'sumario' && (
                <p className="text-xs text-muted-foreground">
                    Montado sozinho a partir das seções com título. Nada a preencher.
                </p>
            )}

            {(secao.tipo === 'texto' || secao.tipo === 'carta' || secao.tipo === 'condicoes') && (
                <>
                    {texto({ id: `${secao.id}-t`, rotulo: 'Título', valor: secao.titulo, curto: true, placeholder: secao.tipo === 'condicoes' ? 'Condições' : 'Sem título', aoMudar: (v) => onChange({ ...secao, titulo: v || null }) })}
                    {texto({ id: `${secao.id}-c`, rotulo: 'Texto', valor: secao.corpo, placeholder: 'Linha com # vira título; com - vira lista. Digite @ para inserir um dado.', aoMudar: (v) => onChange({ ...secao, corpo: v }) })}
                </>
            )}

            {secao.tipo === 'destaques' && (
                <>
                    {texto({ id: `${secao.id}-t`, rotulo: 'Título', valor: secao.titulo, curto: true, aoMudar: (v) => onChange({ ...secao, titulo: v || null }) })}
                    <Lista
                        itens={secao.itens}
                        rotuloDoNovo="número"
                        novo={() => ({ valor: '', rotulo: '', legenda: null })}
                        onChange={(itens) => onChange({ ...secao, itens })}
                        render={(d, i, mudar) => (
                            <div className="grid gap-2 sm:grid-cols-3">
                                <Input value={d.valor} onChange={(e) => mudar({ ...d, valor: e.target.value })} placeholder="64%" aria-label={`Valor do destaque ${i + 1}`} />
                                <Input value={d.rotulo} onChange={(e) => mudar({ ...d, rotulo: e.target.value })} placeholder="Atendimentos resolvidos" aria-label={`Rótulo do destaque ${i + 1}`} />
                                <Input value={d.legenda ?? ''} onChange={(e) => mudar({ ...d, legenda: e.target.value || null })} placeholder="legenda (opcional)" aria-label={`Legenda do destaque ${i + 1}`} />
                            </div>
                        )}
                    />
                </>
            )}

            {secao.tipo === 'escopo' && (
                <>
                    {texto({ id: `${secao.id}-t`, rotulo: 'Título', valor: secao.titulo, curto: true, placeholder: 'Escopo', aoMudar: (v) => onChange({ ...secao, titulo: v || null }) })}
                    <Lista
                        itens={secao.cartoes}
                        rotuloDoNovo="cartão"
                        novo={() => ({ titulo: '', descricao: '' })}
                        onChange={(cartoes) => onChange({ ...secao, cartoes })}
                        render={(c, i, mudar) => (
                            <div className="space-y-2">
                                <Input value={c.titulo} onChange={(e) => mudar({ ...c, titulo: e.target.value })} placeholder="Título do cartão" aria-label={`Título do cartão ${i + 1}`} />
                                <EditorDeTexto valor={c.descricao} onChange={(v) => mudar({ ...c, descricao: v })} valores={valores} paleta={paleta} placeholder="Descrição" />
                            </div>
                        )}
                    />
                </>
            )}

            {secao.tipo === 'fases' && (
                <>
                    {texto({ id: `${secao.id}-t`, rotulo: 'Título', valor: secao.titulo, curto: true, placeholder: 'Fases', aoMudar: (v) => onChange({ ...secao, titulo: v || null }) })}
                    <Lista
                        itens={secao.fases}
                        rotuloDoNovo="fase"
                        novo={() => ({ nome: '', descricao: '', responsavel: null, prazo: null })}
                        onChange={(fases) => onChange({ ...secao, fases })}
                        render={(f, i, mudar) => (
                            <div className="space-y-2">
                                <div className="grid gap-2 sm:grid-cols-3">
                                    <Input value={f.nome} onChange={(e) => mudar({ ...f, nome: e.target.value })} placeholder="Nome da fase" aria-label={`Nome da fase ${i + 1}`} />
                                    <Input value={f.prazo ?? ''} onChange={(e) => mudar({ ...f, prazo: e.target.value || null })} placeholder="Prazo (ex.: dias 1–3)" aria-label={`Prazo da fase ${i + 1}`} />
                                    <Input value={f.responsavel ?? ''} onChange={(e) => mudar({ ...f, responsavel: e.target.value || null })} placeholder="Responsável" aria-label={`Responsável da fase ${i + 1}`} />
                                </div>
                                <EditorDeTexto valor={f.descricao} onChange={(v) => mudar({ ...f, descricao: v })} valores={valores} paleta={paleta} placeholder="O que acontece nesta fase" />
                            </div>
                        )}
                    />
                </>
            )}

            {secao.tipo === 'itens' && (
                <>
                    {texto({ id: `${secao.id}-t`, rotulo: 'Título', valor: secao.titulo, curto: true, placeholder: 'Sem título acima da tabela', aoMudar: (v) => onChange({ ...secao, titulo: v || null }) })}
                    {children}
                </>
            )}

            {secao.tipo === 'investimento' && (
                <>
                    {texto({ id: `${secao.id}-t`, rotulo: 'Título', valor: secao.titulo, curto: true, placeholder: 'Investimento', aoMudar: (v) => onChange({ ...secao, titulo: v || null }) })}
                    {texto({ id: `${secao.id}-i`, rotulo: 'Introdução', valor: secao.introducao, placeholder: 'Uma frase antes dos cartões (opcional)', aoMudar: (v) => onChange({ ...secao, introducao: v || null }) })}
                    <Lista
                        itens={secao.cartoes}
                        rotuloDoNovo="cartão de preço"
                        novo={() => ({ titulo: '', valor: '', periodo: null, inclui: [] })}
                        onChange={(cartoes) => onChange({ ...secao, cartoes })}
                        render={(c, i, mudar) => (
                            <div className="space-y-2">
                                <div className="grid gap-2 sm:grid-cols-3">
                                    <Input value={c.titulo} onChange={(e) => mudar({ ...c, titulo: e.target.value })} placeholder="Setup inicial" aria-label={`Título do cartão ${i + 1}`} />
                                    <EditorDeTexto valor={c.valor} onChange={(v) => mudar({ ...c, valor: v })} valores={valores} paleta={paleta} curto placeholder="R$ 4.800 ou @ total" />
                                    <Input value={c.periodo ?? ''} onChange={(e) => mudar({ ...c, periodo: e.target.value || null })} placeholder="pagamento único / por mês" aria-label={`Período do cartão ${i + 1}`} />
                                </div>
                                <textarea
                                    value={c.inclui.join('\n')}
                                    onChange={(e) => mudar({ ...c, inclui: e.target.value.split('\n').filter((l) => l.trim()) })}
                                    placeholder={'O que inclui, um por linha'}
                                    rows={3}
                                    aria-label={`O que o cartão ${i + 1} inclui`}
                                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                />
                            </div>
                        )}
                    />
                </>
            )}

            {secao.tipo === 'garantia' && (
                <>
                    {texto({ id: `${secao.id}-t`, rotulo: 'Título', valor: secao.titulo, curto: true, placeholder: 'Garantia e bônus', aoMudar: (v) => onChange({ ...secao, titulo: v || null }) })}
                    <Lista
                        itens={secao.blocos}
                        rotuloDoNovo="bloco"
                        novo={() => ({ titulo: '', texto: '' })}
                        onChange={(blocos) => onChange({ ...secao, blocos })}
                        render={(b, i, mudar) => (
                            <div className="space-y-2">
                                <Input value={b.titulo} onChange={(e) => mudar({ ...b, titulo: e.target.value })} placeholder="Garantia" aria-label={`Título do bloco ${i + 1}`} />
                                <EditorDeTexto valor={b.texto} onChange={(v) => mudar({ ...b, texto: v })} valores={valores} paleta={paleta} placeholder="O que acompanha" />
                            </div>
                        )}
                    />
                </>
            )}

            {secao.tipo === 'aceite' &&
                texto({
                    id: `${secao.id}-a`,
                    rotulo: 'Texto do aceite',
                    valor: secao.texto,
                    placeholder: 'Vazio usa: "Ao aceitar este documento, {cliente} confirma ter lido e concordado com as condições acima."',
                    aoMudar: (v) => onChange({ ...secao, texto: v || null }),
                })}

            {secao.tipo === 'fechamento' && (
                <>
                    {texto({ id: `${secao.id}-t`, rotulo: 'Título', valor: secao.titulo, curto: true, aoMudar: (v) => onChange({ ...secao, titulo: v || null }) })}
                    {texto({ id: `${secao.id}-c`, rotulo: 'Texto', valor: secao.corpo, placeholder: 'Agradecemos pela oportunidade…', aoMudar: (v) => onChange({ ...secao, corpo: v }) })}
                    {texto({ id: `${secao.id}-ch`, rotulo: 'Chamada', valor: secao.chamada, curto: true, placeholder: 'OBRIGADO.', aoMudar: (v) => onChange({ ...secao, chamada: v || null }) })}
                    <p className="text-xs text-muted-foreground">Nome, e-mail e telefone do responsável entram sozinhos no fim.</p>
                </>
            )}
        </div>
    )
}

/** Uma lista editável de linhas, com acrescentar e remover. */
function Lista<T>({
    itens,
    novo,
    rotuloDoNovo,
    onChange,
    render,
}: {
    itens: T[]
    novo: () => T
    rotuloDoNovo: string
    onChange: (itens: T[]) => void
    render: (item: T, indice: number, mudar: (item: T) => void) => ReactNode
}) {
    return (
        <div className="space-y-2">
            {itens.map((item, i) => (
                <div key={i} className="flex gap-2 rounded-md border border-border/60 p-2">
                    <div className="min-w-0 flex-1">{render(item, i, (novoItem) => onChange(itens.map((x, j) => (j === i ? novoItem : x))))}</div>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 shrink-0 px-2"
                        aria-label={`Remover ${rotuloDoNovo} ${i + 1}`}
                        onClick={() => onChange(itens.filter((_, j) => j !== i))}
                    >
                        <Trash2 className="size-4" aria-hidden />
                    </Button>
                </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={() => onChange([...itens, novo()])}>
                <Plus className="size-4" aria-hidden />
                Acrescentar {rotuloDoNovo}
            </Button>
        </div>
    )
}
