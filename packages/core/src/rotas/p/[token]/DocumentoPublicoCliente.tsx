'use client'

import { useState } from 'react'
import { cssDoDocumento } from '@venn/core/lib/propostas/estilo'

/**
 * O documento como o cliente o lê, e o aceite.
 *
 * ## Por que o HTML vem montado do servidor
 *
 * `dangerouslySetInnerHTML` com HTML de fora seria temerário; aqui o HTML é o
 * que `lib/propostas/render.ts` montou, com **tudo** escapado — nem o template
 * nem a descrição do item nem o nome do contato podem carregar tag. O teste que
 * sustenta isso é `scripts/check-propostas.ts` ("descrição com HTML é
 * escapada", "valor de variável é escapado"). Não há sanitizador neste
 * projeto, e esta é a razão pela qual não precisa haver: o HTML é nosso.
 *
 * ## O aceite é um ato, não um clique
 *
 * O botão não aceita direto: abre o campo do nome. Exigir o nome digitado faz
 * três coisas — dá autor ao carimbo (o `CHECK` do banco recusa aceite sem
 * nome), força um segundo de atenção antes de um ato irreversível, e é o que
 * transforma a trilha em prova.
 */

export interface DocumentoParaCliente {
    html: string
    rotulo: string
    numero: number
    organizacao: string
    totalEmTexto: string
    aceitoEm: string | null
    aceitoPor: string | null
    validoAte: string | null
    /** A cor principal do modelo, ou nula para o tema. */
    cor: string | null
    /** O logotipo da organização (URL), ou nulo. */
    logo: string | null
}

export function DocumentoPublicoCliente({
    token,
    marca,
    documento,
}: {
    token: string
    marca: string
    documento: DocumentoParaCliente
}) {
    const [aceitoEm, setAceitoEm] = useState(documento.aceitoEm)
    const [aceitoPor, setAceitoPor] = useState(documento.aceitoPor)
    const [abrindoAceite, setAbrindoAceite] = useState(false)
    const [nome, setNome] = useState('')
    const [enviando, setEnviando] = useState(false)
    const [erro, setErro] = useState<string | null>(null)

    const vencido = documento.validoAte ? new Date(documento.validoAte) < new Date() : false

    async function aceitar(evento: React.FormEvent) {
        evento.preventDefault()
        if (nome.trim().length < 3) {
            setErro('Escreva o seu nome completo.')
            return
        }

        setEnviando(true)
        setErro(null)
        try {
            const resposta = await fetch(`/api/p/${token}/aceitar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nome: nome.trim() }),
            })
            const corpo = (await resposta.json().catch(() => ({}))) as {
                acceptedAt?: string
                acceptedByName?: string
                error?: string
            }

            if (!resposta.ok) {
                /**
                 * 409 com o carimbo original: alguém já aceitou — provavelmente
                 * esta mesma pessoa, com dois cliques. Mostrar o aceite em vez
                 * de um erro é o desfecho certo; ela conseguiu o que queria.
                 */
                if (resposta.status === 409 && corpo.acceptedAt) {
                    setAceitoEm(corpo.acceptedAt)
                    setAceitoPor(corpo.acceptedByName ?? null)
                    setAbrindoAceite(false)
                    return
                }
                setErro(corpo.error ?? 'Não foi possível registrar o aceite. Tente novamente.')
                return
            }

            setAceitoEm(corpo.acceptedAt ?? new Date().toISOString())
            setAceitoPor(corpo.acceptedByName ?? nome.trim())
            setAbrindoAceite(false)
        } catch {
            setErro('Não foi possível registrar o aceite. Verifique a conexão e tente novamente.')
        } finally {
            setEnviando(false)
        }
    }

    return (
        <main className="min-h-dvh bg-muted/30 px-4 py-10 print:p-0">
            <div className="mx-auto w-full max-w-3xl">
                {/* "Baixar PDF" só existe AQUI, na visualização do link — decisão
                    do André em 22/11/2026: o editor visualiza e envia o link; o
                    arquivo é do cliente. É a impressão do navegador com o CSS de
                    `estilo.ts`: sem Browser Rendering, sem binding novo. */}
                <div className="mb-3 flex justify-end print:hidden">
                    <button
                        type="button"
                        onClick={() => window.print()}
                        className="inline-flex items-center justify-center gap-2 rounded-lg border border-input bg-card px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
                    >
                        <svg aria-hidden viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></svg>
                        Baixar PDF
                    </button>
                </div>

                <article className="documento-publico-moldura rounded-xl border border-border/60 bg-card p-6 shadow-sm sm:p-10 print:rounded-none print:border-0 print:p-0 print:shadow-none">
                    <header className="mb-8 flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-5">
                        <div className="flex items-center gap-3">
                            {/* A identidade do modelo: o logotipo da organização. `alt` com o
                                nome, porque o leitor de tela lê o nome e não a imagem. */}
                            {documento.logo && (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={documento.logo} alt={documento.organizacao} className="h-10 w-auto max-w-[9rem] object-contain" />
                            )}
                            <div>
                                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                    {documento.rotulo} {documento.numero}
                                </p>
                                <p className="mt-1 text-base font-semibold text-foreground">
                                    {documento.organizacao}
                                </p>
                            </div>
                        </div>
                        <p className="text-lg font-semibold tabular-nums text-foreground">
                            {documento.totalEmTexto}
                        </p>
                    </header>

                    {/* O HTML é o que o servidor montou e escapou. Ver o cabeçalho. */}
                    <div
                        className="documento-publico"
                        dangerouslySetInnerHTML={{ __html: documento.html }}
                    />

                    <footer className="mt-10 border-t border-border/60 pt-6">
                        {aceitoEm ? (
                            <div className="rounded-lg bg-muted/60 p-4 text-sm print:bg-transparent print:p-0">
                                <p className="font-medium text-foreground">Documento aceito</p>
                                <p className="mt-1 text-muted-foreground">
                                    {aceitoPor ? `Por ${aceitoPor}, em ` : 'Em '}
                                    {new Date(aceitoEm).toLocaleString('pt-BR')}
                                </p>
                            </div>
                        ) : vencido ? (
                            <p className="text-sm text-muted-foreground">
                                O prazo deste documento venceu. Fale com {documento.organizacao} para
                                receber uma versão atualizada.
                            </p>
                        ) : abrindoAceite ? (
                            <form onSubmit={aceitar} className="print:hidden">
                                <label
                                    htmlFor="nome-do-aceite"
                                    className="block text-sm font-medium text-foreground"
                                >
                                    Escreva o seu nome completo para aceitar
                                </label>
                                <input
                                    id="nome-do-aceite"
                                    type="text"
                                    value={nome}
                                    onChange={(e) => setNome(e.target.value)}
                                    autoComplete="name"
                                    autoFocus
                                    className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                    placeholder="Nome completo"
                                />
                                {erro && <p className="mt-2 text-sm text-destructive">{erro}</p>}
                                <div className="mt-4 flex flex-wrap gap-2">
                                    <button
                                        type="submit"
                                        disabled={enviando}
                                        className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
                                    >
                                        {enviando ? 'Registrando…' : 'Confirmar aceite'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setAbrindoAceite(false)}
                                        disabled={enviando}
                                        className="inline-flex items-center justify-center rounded-lg border border-input px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-60"
                                    >
                                        Cancelar
                                    </button>
                                </div>
                                <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                                    Ao confirmar, registramos a data, o seu nome e o endereço de rede
                                    de onde o aceite partiu.
                                </p>
                            </form>
                        ) : (
                            <div className="flex flex-wrap items-center gap-3 print:hidden">
                                <button
                                    type="button"
                                    onClick={() => setAbrindoAceite(true)}
                                    className="inline-flex items-center justify-center rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
                                >
                                    Aceitar {documento.rotulo.toLowerCase()}
                                </button>
                            </div>
                        )}
                    </footer>
                </article>

                <p className="mt-6 text-center text-xs text-muted-foreground/70 print:hidden">
                    {marca}
                </p>
            </div>

            {/*
             * O estilo do documento mora aqui, junto da única tela que o usa.
             *
             * A folha global não o conhece — e não deve: `documento-publico` é
             * o único lugar do produto que recebe HTML montado no servidor, e
             * manter as regras ao lado dele é o que impede que um ajuste no
             * tema mude a cara de um documento que já foi aceito.
             */}
            {/* O CSS é o mesmo do modo Visualizar do editor — `lib/propostas/estilo.ts`.
                Dois CSS fariam o vendedor ver uma coisa e o cliente outra. */}
            <style>{cssDoDocumento('.documento-publico', documento.cor)}</style>
        </main>
    )
}
