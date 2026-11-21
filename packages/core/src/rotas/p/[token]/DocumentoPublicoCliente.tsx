'use client'

import { useState } from 'react'

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
                <article className="rounded-xl border border-border/60 bg-card p-6 shadow-sm sm:p-10 print:rounded-none print:border-0 print:p-0 print:shadow-none">
                    <header className="mb-8 flex flex-wrap items-baseline justify-between gap-2 border-b border-border/60 pb-5">
                        <div>
                            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                {documento.rotulo} {documento.numero}
                            </p>
                            <p className="mt-1 text-base font-semibold text-foreground">
                                {documento.organizacao}
                            </p>
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
                                <button
                                    type="button"
                                    onClick={() => window.print()}
                                    className="inline-flex items-center justify-center rounded-lg border border-input px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
                                >
                                    Imprimir ou salvar em PDF
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
            <style>{`
                .documento-publico { color: hsl(var(--foreground)); font-size: 0.9375rem; line-height: 1.65; }
                .documento-publico h2 { font-size: 1.125rem; font-weight: 600; margin: 1.75rem 0 0.5rem; }
                .documento-publico h2:first-child { margin-top: 0; }
                .documento-publico p { margin: 0.75rem 0; }
                .documento-publico ul { margin: 0.75rem 0; padding-left: 1.25rem; list-style: disc; }
                .documento-publico li { margin: 0.25rem 0; }
                .documento-publico .doc-vazio { color: hsl(var(--muted-foreground)); }

                .documento-publico .doc-itens {
                    width: 100%;
                    margin: 1.5rem 0;
                    border-collapse: collapse;
                    font-size: 0.875rem;
                }
                .documento-publico .doc-itens th,
                .documento-publico .doc-itens td {
                    padding: 0.625rem 0.5rem;
                    border-bottom: 1px solid hsl(var(--border));
                    text-align: left;
                    vertical-align: top;
                }
                .documento-publico .doc-itens th {
                    font-size: 0.75rem;
                    font-weight: 600;
                    text-transform: uppercase;
                    letter-spacing: 0.03em;
                    color: hsl(var(--muted-foreground));
                }
                /* Número alinhado à direita e com largura de dígito fixa: é o que
                   deixa a coluna somável a olho. */
                .documento-publico .doc-col-num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
                .documento-publico .doc-itens tfoot td { border-bottom: 0; padding-top: 0.75rem; }
                .documento-publico .doc-subtotal td { color: hsl(var(--muted-foreground)); padding-top: 0.375rem; padding-bottom: 0.375rem; }
                .documento-publico .doc-total td { font-weight: 600; font-size: 1rem; border-top: 1px solid hsl(var(--border)); }

                /*
                 * Impressão: é isto que substitui o PDF nesta fase.
                 *
                 * Nenhuma cor de fundo é declarada aqui, e não é esquecimento:
                 * o navegador não imprime fundo por omissão (print-color-adjust
                 * em economy), então forçar branco na impressão seria uma cor
                 * literal sem efeito — e o lint de cores a cobrou, com razão:
                 * ele varre o comentário também, que é como deve ser, porque a
                 * isenção não pode vir de esconder a cor dentro de uma nota.
                 *
                 * Sem crase nestas linhas, de propósito: este bloco vive dentro
                 * de um template literal, e uma crase aqui o FECHA — o resto do
                 * CSS passa a ser lido como JSX e o typecheck despenca em treze
                 * erros a partir desta linha. Foi o que aconteceu ao escrever
                 * esta nota pela primeira vez.
                 */
                @media print {
                    .documento-publico { font-size: 11pt; }
                    .documento-publico .doc-itens { font-size: 10pt; }
                    /* Linha de item não se parte entre páginas: meia linha no pé
                       de uma folha e meia no topo da outra é o defeito clássico
                       de tabela impressa. */
                    .documento-publico .doc-itens tr { break-inside: avoid; }
                    .documento-publico .doc-itens thead { display: table-header-group; }
                }
            `}</style>
        </main>
    )
}
