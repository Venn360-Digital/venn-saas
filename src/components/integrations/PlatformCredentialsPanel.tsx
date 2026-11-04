'use client'

import { useEffect, useState } from 'react'
import { Check, ShieldCheck, Terminal } from 'lucide-react'

import { cn } from '@/lib/utils'

interface ProviderRow {
    provider: string
    label: string
    help: string
    /** Provedor cujas duas metades são segredo — o Asaas. Nenhuma volta para cá. */
    segredoDuplo?: boolean
    /** "sandbox" | "producao", derivado do prefixo da chave. Só com segredo duplo. */
    ambiente?: string | null
    configured: boolean
    temId: boolean
    temSegredo: boolean
    /** `ambiente` é o estado bom; `banco` é resquício de quando havia formulário. */
    origem: 'ambiente' | 'banco' | null
    /** Os nomes das variáveis a gravar. Nulo para quem não administra. */
    variaveis: { id: string; segredo: string } | null
}

/**
 * Os registros de aplicativo por onde toda clínica conecta — **em leitura**.
 *
 * Visível só para o OWNER do workspace da plataforma. Uma clínica nunca vê
 * isto: ela abre Integrações, clica "Conectar", escolhe a conta e pronto — o
 * que só funciona porque o aplicativo está registrado uma vez, no ambiente.
 *
 * ## Por que não há mais formulário
 *
 * Havia, até 2026-10-24, e era a ponte por onde as credenciais entravam. Saiu
 * por decisão do André: a primeira metade do Asaas é a chave que movimenta
 * cobrança, e nenhum SaaS põe isso atrás de uma sessão de navegador. O
 * raciocínio inteiro está no cabeçalho de `lib/platform-credentials.ts`.
 *
 * O que sobra aqui é mais útil do que um formulário: **qual variável falta**. O
 * operador grava pelo terminal, onde o valor não passa por navegador nenhum, e
 * esta tela confirma que chegou — e de onde veio, que é o que impede alguém de
 * acreditar ter rotacionado uma credencial que continua vindo de outro lugar.
 */
export function PlatformCredentialsPanel() {
    const [rows, setRows] = useState<ProviderRow[] | null>(null)
    /**
     * O estado da fila de webhooks do Asaas.
     *
     * Fica aqui porque é aqui que a chave dele aparece — e porque é a única
     * informação desta integração que não dá sintoma em lugar nenhum: a fila
     * deles para depois de 15 falhas seguidas e os eventos somem em silêncio.
     */
    const [webhookDoAsaas, setWebhookDoAsaas] = useState<{
        ok: boolean
        problemas: string[]
    } | null>(null)
    const [visible, setVisible] = useState(false)

    useEffect(() => {
        const load = async () => {
            try {
                const res = await fetch('/api/platform/credentials')
                if (!res.ok) return
                const data = await res.json()
                setVisible(Boolean(data.isPlatformAdmin))
                setRows(data.providers ?? [])
                setWebhookDoAsaas(data.asaasWebhook ?? null)
            } catch {
                /* a seção simplesmente não aparece */
            }
        }
        void load()
    }, [])

    if (!visible || !rows) return null

    return (
        /* Sem teto de largura: cartão em guia acompanha a resolução (DESIGN.md
           §5, "Cartão em guia"). Este só aparece para o responsável pela
           plataforma, então o teto passou despercebido nas medições — quem vê
           a guia Integrações como clínica nunca o renderiza. */
        <section className="rounded-xl border border-border bg-card p-5">
            <div className="mb-1 flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-primary" />
                <h2 className="text-h4">Aplicativos da plataforma</h2>
            </div>
            <p className="mb-4 text-sm text-muted-foreground">
                Registrados uma vez e usados por todas as clínicas. As credenciais vivem no
                Cloudflare Secrets e entram por <code className="text-xs">wrangler secret put</code> —
                não por esta tela. Aqui você vê o que está definido e o que falta.
            </p>

            <ul className="divide-y divide-border rounded-lg border border-border">
                {rows.map((row) => (
                    <li key={row.provider} className="p-3">
                        <div className="min-w-0">
                            <p className="flex items-center gap-2 text-sm font-medium">
                                {row.label}
                                {row.configured ? (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-success-subtle px-2 py-0.5 text-[10px] font-semibold text-success-subtle-foreground">
                                        <Check className="h-3 w-3" />
                                        registrado
                                    </span>
                                ) : (
                                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                                        pendente
                                    </span>
                                )}
                                {/* Resquício: gravado pela tela antiga, antes de
                                    a ponte sair. Continua sendo lido, mas o
                                    lugar dele é o ambiente — e dizer isso aqui é
                                    o que faz alguém mover. */}
                                {row.origem === 'banco' ? (
                                    <span className="rounded-full bg-warning-subtle px-2 py-0.5 text-[10px] font-medium text-warning-subtle-foreground">
                                        ainda no banco
                                    </span>
                                ) : null}
                            </p>

                            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                                {row.configured && row.segredoDuplo
                                    ? /* Com segredo duplo não há id para mostrar
                                         — a chave é segredo. O que vale dizer é
                                         o ambiente, porque cobrar de verdade num
                                         teste é o erro caro desta tela.

                                         **Três estados, não dois.** O ternário
                                         anterior era binário: tudo que não fosse
                                         `producao` virava "Chave de sandbox —
                                         nada é cobrado". O valor que cai no
                                         `else` com mais frequência não é a chave
                                         de sandbox: é a chave ERRADA, que não
                                         começa com `$aact_` e por isso não serve
                                         para ambiente nenhum. A tela dizia uma
                                         frase tranquilizadora sobre uma
                                         integração morta — aconteceu em
                                         2026-11-04, com o Wallet ID gravado no
                                         lugar da chave de API, e foi esta linha
                                         que escondeu. */
                                      row.ambiente === 'producao'
                                        ? 'Chave de PRODUÇÃO — cobra de verdade.'
                                        : row.ambiente === 'sandbox'
                                          ? 'Chave de sandbox — nada é cobrado.'
                                          : 'O valor gravado não é uma chave do Asaas: ela começa com $aact_prod_ (produção) ou $aact_hmlg_ (sandbox). Enquanto for outro valor, nenhuma cobrança funciona.'
                                    : row.help}
                            </p>
                        </div>

                        {/* As variáveis, e só as que faltam quando falta alguma.
                            Listar as duas num provedor já pronto é ruído; num
                            provedor pela metade, saber QUAL metade falta é
                            exatamente a informação que evita a próxima tentativa
                            no escuro. */}
                        {row.variaveis ? (
                            <div className="mt-2 rounded-md bg-muted/40 px-3 py-2">
                                <p className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                                    <Terminal className="h-3 w-3" />
                                    {row.configured ? 'Definido em' : 'Grave no Cloudflare Secrets'}
                                </p>
                                <ul className="mt-1 space-y-0.5">
                                    {[
                                        { nome: row.variaveis.id, ok: row.temId },
                                        { nome: row.variaveis.segredo, ok: row.temSegredo },
                                    ].map((v) => (
                                        <li
                                            key={v.nome}
                                            className={cn(
                                                'font-mono text-[11px] leading-snug',
                                                v.ok ? 'text-muted-foreground' : 'text-foreground'
                                            )}
                                        >
                                            {v.ok ? '✓' : '·'} {v.nome}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ) : null}

                        {/* A fila do Asaas, na linha do Asaas. */}
                        {row.provider === 'asaas' && webhookDoAsaas && !webhookDoAsaas.ok ? (
                            <div className="mt-2 rounded-md bg-destructive-subtle px-3 py-2">
                                <p className="text-[11px] font-semibold text-destructive-subtle-foreground">
                                    A fila de webhooks precisa de atenção
                                </p>
                                <ul className="mt-1 space-y-0.5">
                                    {webhookDoAsaas.problemas.map((problema) => (
                                        <li
                                            key={problema}
                                            className="text-[11px] leading-snug text-destructive-subtle-foreground"
                                        >
                                            {problema}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ) : null}

                        {row.provider === 'asaas' && webhookDoAsaas?.ok ? (
                            <p className="mt-2 text-[11px] text-muted-foreground">
                                Fila de webhooks saudável — nenhuma entrega penalizada.
                            </p>
                        ) : null}
                    </li>
                ))}
            </ul>
        </section>
    )
}
