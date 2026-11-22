'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Plus, RotateCcw, Trash2, TriangleAlert } from 'lucide-react'

import { Button } from '@venn/ui/button'
import { Input } from '@venn/ui/input'
import { Label } from '@venn/ui/label'
import { Textarea } from '@venn/ui/textarea'
import { PageHeader } from '@venn/core/components/shared/PageHeader'
import { ROTULO_DO_TIPO, TIPOS_DE_DOCUMENTO } from '@venn/core/lib/propostas/estados'
import {
    AJUDA_DO_MARCADOR,
    MARCADOR_DE_ITENS,
    MARCADORES,
    marcadoresCitados,
} from '@venn/core/lib/propostas/variaveis'

import type { ModeloItem } from './dados'

/**
 * Os modelos de documento, e o texto que o cliente lê.
 *
 * ## Por que não há editor rico
 *
 * O corpo é **texto com marcadores**, não HTML colado. `lib/propostas/render.ts`
 * escapa tudo e reconhece título e lista por convenção de linha, e é por isso
 * que `<script>` num modelo aparece como `&lt;script&gt;` no documento. Um
 * editor WYSIWYG produziria HTML que o render teria de confiar — e não há
 * sanitizador neste projeto. A razão longa está em `marketing/.../EditorDeEmail.tsx`.
 *
 * ## Por que não há prévia ao vivo
 *
 * `renderDocumento` importa o cálculo, que importa o `Prisma` — e qualquer
 * módulo de servidor arrastado para uma tela `'use client'` leva o driver do
 * banco para o navegador, o que o `next build` reprova (ver `DESIGN.md` §10 e a
 * regra 7 de `check-marca.mjs`). A prévia de verdade é abrir uma proposta com o
 * modelo escolhido. O que esta tela dá no lugar é o que erra na prática:
 * **a lista de marcadores** e o aviso de marcador que não existe.
 */
export function ModelosClient({ inicial }: { inicial: ModeloItem[] }) {
    const router = useRouter()
    const [modelos, setModelos] = useState(inicial)
    const [emEdicao, setEmEdicao] = useState<string | null>(null)
    const [nome, setNome] = useState('')
    const [corpo, setCorpo] = useState('')
    const [salvando, setSalvando] = useState(false)
    const [aviso, setAviso] = useState<string | null>(null)

    const atual = modelos.find((m) => m.id === emEdicao) ?? null

    /**
     * Marcador citado que o motor não conhece.
     *
     * `marcadoresCitados` usa a **mesma** expressão de `substituirMarcadores`,
     * de propósito: o que esta tela lista tem de ser exatamente o que o motor
     * reconhece. Marcador desconhecido não quebra nada — ele fica **visível** no
     * documento, que é pior: o cliente lê `{{preco}}`.
     */
    const desconhecidos = useMemo(() => {
        const conhecidos = new Set<string>([...(MARCADORES as string[]), MARCADOR_DE_ITENS])
        return marcadoresCitados(corpo).filter((m) => !conhecidos.has(m))
    }, [corpo])

    function abrir(m: ModeloItem) {
        setEmEdicao(m.id)
        setNome(m.name)
        setCorpo(m.body ?? '')
        setAviso(null)
    }

    async function chamar(url: string, init: RequestInit): Promise<boolean> {
        setSalvando(true)
        setAviso(null)
        try {
            const resposta = await fetch(url, init)
            const corpoDaResposta = (await resposta.json().catch(() => ({}))) as { error?: string }
            if (!resposta.ok) {
                setAviso(corpoDaResposta.error ?? 'Não foi possível concluir.')
                return false
            }
            router.refresh()
            return true
        } finally {
            setSalvando(false)
        }
    }

    async function gravar() {
        if (!atual) return
        if (nome.trim().length === 0) {
            setAviso('O nome é obrigatório.')
            return
        }
        const ok = await chamar(`/api/propostas/templates/${atual.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: nome.trim(), body: corpo.trim() || null }),
        })
        if (ok) {
            setModelos((atuais) =>
                atuais.map((m) =>
                    m.id === atual.id ? { ...m, name: nome.trim(), body: corpo.trim() || null } : m
                )
            )
            setEmEdicao(null)
        }
    }

    async function criar(tipo: string) {
        await chamar('/api/propostas/templates', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: `${ROTULO_DO_TIPO[tipo as keyof typeof ROTULO_DO_TIPO]} novo`, kind: tipo }),
        })
    }

    return (
        <>
            <PageHeader
                title="Modelos de documento"
                description="O texto que o cliente lê. Marcador entre chaves vira o dado do documento."
                actions={
                    <div className="flex flex-wrap items-center gap-2">
                        <Button variant="ghost" onClick={() => router.push('/vendas/propostas')}>
                            <ArrowLeft className="size-4" aria-hidden />
                            Documentos
                        </Button>
                        {/*
                          * Restaurar os padrões é idempotente e **não sobrescreve**
                          * o que a unidade editou — `semearModelos` usa
                          * `skipDuplicates`. Quem quer o texto original de volta
                          * apaga o modelo e restaura.
                          */}
                        <Button
                            variant="outline"
                            disabled={salvando}
                            onClick={() =>
                                void chamar('/api/propostas/templates', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ semear: true }),
                                })
                            }
                        >
                            <RotateCcw className="size-4" aria-hidden />
                            Restaurar padrões
                        </Button>
                    </div>
                }
            />

            {aviso && (
                <p className="mb-4 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                    <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                    {aviso}
                </p>
            )}

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
                <div className="space-y-6">
                    {TIPOS_DE_DOCUMENTO.map((tipo) => {
                        const doTipo = modelos.filter((m) => m.kind === tipo)
                        return (
                            <section key={tipo}>
                                <div className="mb-2 flex items-center justify-between gap-3">
                                    <h2 className="text-sm font-semibold text-foreground">
                                        {ROTULO_DO_TIPO[tipo]}
                                    </h2>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        disabled={salvando}
                                        onClick={() => void criar(tipo)}
                                    >
                                        <Plus className="size-4" aria-hidden />
                                        Novo
                                    </Button>
                                </div>

                                {doTipo.length === 0 ? (
                                    <p className="rounded-lg border border-border/60 px-3 py-4 text-sm text-muted-foreground">
                                        Nenhum modelo. Documentos deste tipo abrem no corpo padrão —
                                        o que funciona, e não fala na voz da organização.
                                    </p>
                                ) : (
                                    <ul className="space-y-2">
                                        {doTipo.map((m) => (
                                            <li
                                                key={m.id}
                                                className="rounded-lg border border-border/60 px-3 py-2"
                                            >
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => abrir(m)}
                                                        className="flex-1 text-left text-sm font-medium text-foreground hover:underline"
                                                    >
                                                        {m.name}
                                                    </button>
                                                    {m.isDefault && (
                                                        <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
                                                            padrão
                                                        </span>
                                                    )}
                                                    {!m.isActive && (
                                                        <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                                                            inativo
                                                        </span>
                                                    )}
                                                    {m.emUso > 0 && (
                                                        <span className="text-xs text-muted-foreground">
                                                            {m.emUso} em uso
                                                        </span>
                                                    )}
                                                    {/*
                                                      * Apagar perde o LAYOUT das
                                                      * propostas que o usam — o
                                                      * conteúdo fica, porque o
                                                      * render tem corpo padrão.
                                                      * Quem só quer tirar do
                                                      * seletor desativa.
                                                      */}
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        disabled={salvando}
                                                        aria-label={`Desativar ${m.name}`}
                                                        onClick={() =>
                                                            void chamar(`/api/propostas/templates/${m.id}`, {
                                                                method: 'PATCH',
                                                                headers: { 'Content-Type': 'application/json' },
                                                                body: JSON.stringify({ isActive: !m.isActive }),
                                                            })
                                                        }
                                                    >
                                                        {m.isActive ? 'Desativar' : 'Ativar'}
                                                    </Button>
                                                    {m.emUso === 0 && (
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            disabled={salvando}
                                                            aria-label={`Apagar ${m.name}`}
                                                            onClick={() =>
                                                                void chamar(
                                                                    `/api/propostas/templates/${m.id}`,
                                                                    { method: 'DELETE' }
                                                                )
                                                            }
                                                        >
                                                            <Trash2 className="size-4" aria-hidden />
                                                        </Button>
                                                    )}
                                                </div>

                                                {emEdicao === m.id && (
                                                    <div className="mt-3 space-y-3 border-t border-border/60 pt-3">
                                                        <div>
                                                            <Label htmlFor={`nome-${m.id}`} className="mb-1.5 block">
                                                                Nome
                                                            </Label>
                                                            <Input
                                                                id={`nome-${m.id}`}
                                                                value={nome}
                                                                onChange={(e) => setNome(e.target.value)}
                                                                maxLength={100}
                                                            />
                                                        </div>
                                                        <div>
                                                            <Label htmlFor={`corpo-${m.id}`} className="mb-1.5 block">
                                                                Texto do documento
                                                            </Label>
                                                            <Textarea
                                                                id={`corpo-${m.id}`}
                                                                value={corpo}
                                                                onChange={(e) => setCorpo(e.target.value)}
                                                                rows={16}
                                                                maxLength={50_000}
                                                                className="font-mono text-xs"
                                                                placeholder="Vazio usa o corpo padrão do sistema."
                                                            />
                                                        </div>

                                                        {desconhecidos.length > 0 && (
                                                            <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-subtle px-3 py-2 text-xs text-warning-subtle-foreground">
                                                                <TriangleAlert
                                                                    className="mt-0.5 size-4 shrink-0 text-warning"
                                                                    aria-hidden
                                                                />
                                                                <span>
                                                                    {desconhecidos
                                                                        .map((d) => `{{${d}}}`)
                                                                        .join(', ')}{' '}
                                                                    não existe. Marcador desconhecido não
                                                                    quebra o documento — ele aparece assim
                                                                    mesmo, para o cliente.
                                                                </span>
                                                            </p>
                                                        )}

                                                        <div className="flex items-center gap-2">
                                                            <Button onClick={() => void gravar()} disabled={salvando}>
                                                                {salvando ? 'Gravando…' : 'Gravar'}
                                                            </Button>
                                                            <Button
                                                                variant="outline"
                                                                onClick={() => setEmEdicao(null)}
                                                                disabled={salvando}
                                                            >
                                                                Cancelar
                                                            </Button>
                                                        </div>
                                                    </div>
                                                )}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </section>
                        )
                    })}
                </div>

                {/*
                  * A ajuda vem de `AJUDA_DO_MARCADOR`, e não escrita aqui: o
                  * comentário naquele arquivo diz por que — marcador novo tem de
                  * aparecer na ajuda no mesmo commit em que passa a funcionar.
                  * Separados, a lista envelhece e quem escreve o modelo descobre
                  * o marcador por tentativa.
                  */}
                <aside className="rounded-lg border border-border/60 p-4 lg:sticky lg:top-6 lg:self-start">
                    <h2 className="text-sm font-semibold text-foreground">Marcadores</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                        Escreva entre chaves duplas. Linha começando com <code>#</code> vira título;
                        com <code>-</code>, item de lista.
                    </p>
                    <dl className="mt-3 space-y-2 text-xs">
                        {MARCADORES.map((marcador) => (
                            <div key={marcador}>
                                <dt className="font-mono text-foreground">{`{{${marcador}}}`}</dt>
                                <dd className="text-muted-foreground">{AJUDA_DO_MARCADOR[marcador]}</dd>
                            </div>
                        ))}
                        <div>
                            <dt className="font-mono text-foreground">{`{{${MARCADOR_DE_ITENS}}}`}</dt>
                            <dd className="text-muted-foreground">
                                a tabela de itens com os totais — o único que não é uma palavra só
                            </dd>
                        </div>
                    </dl>
                </aside>
            </div>
        </>
    )
}
