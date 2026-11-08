'use client'

import { useCallback, useState } from 'react'
import { AtSign, Check, Copy, Plus, Settings2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DataTable, type Column } from '@/components/shared/DataTable'
import { EmptyState } from '@/components/shared/EmptyState'
import { FormField } from '@/components/shared/FormField'
import { IndexFrame } from '@/components/shared/IndexFrame'
import { RecordDialog } from '@/components/shared/RecordDialog'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { usePermissions } from '@/hooks/usePermissions'
import { useIndiceServidor } from '@/hooks/useIndiceServidor'
import { BRAND } from '@/config/brand'
import {
    explicacaoDoDkim,
    SITUACAO_DO_REMETENTE,
    type RegistroDeDns,
} from '@/lib/marketing/remetentes'

import type { DadosIniciais, RemetenteItem } from './dados'

const RECORTE_INTEIRO = 'workspace-inteiro'
const FORM_VAZIO = { domain: '', fromLocal: 'contato', fromName: '', replyTo: '' }

type CampoDoForm = keyof typeof FORM_VAZIO

export function RemetentesClient({ inicial }: { inicial: DadosIniciais }) {
    const { canEdit } = usePermissions()

    const buscar = useCallback(async () => {
        const res = await fetch('/api/marketing/remetentes')
        if (!res.ok) {
            toast.error('Não foi possível carregar os remetentes')
            return null
        }
        const itens = (await res.json()) as RemetenteItem[]
        return { itens, total: itens.length, totalPages: 1 }
    }, [])

    const {
        itens: remetentes,
        carregando: loading,
        recarregar,
    } = useIndiceServidor<RemetenteItem>({ inicial, recorte: RECORTE_INTEIRO, buscar })

    const [busca, setBusca] = useState('')
    const [novoAberto, setNovoAberto] = useState(false)
    const [form, setForm] = useState(FORM_VAZIO)
    const [erros, setErros] = useState<Partial<Record<CampoDoForm, string>>>({})
    const [enviando, setEnviando] = useState(false)
    /** O remetente cujas instruções de DNS estão abertas. */
    const [vendoDns, setVendoDns] = useState<RemetenteItem | null>(null)

    const visiveis = remetentes.filter(
        (r) =>
            busca.trim() === '' ||
            r.domain.includes(busca.trim().toLowerCase()) ||
            r.fromName.toLowerCase().includes(busca.trim().toLowerCase())
    )

    function abrirNovo() {
        setForm(FORM_VAZIO)
        setErros({})
        setNovoAberto(true)
    }

    async function salvar() {
        setEnviando(true)
        setErros({})
        try {
            const res = await fetch('/api/marketing/remetentes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(form),
            })
            const corpo = (await res.json()) as {
                error?: string
                campo?: CampoDoForm | null
                id?: string
                domain?: string
                from?: string
                status?: string
                dns?: RegistroDeDns[]
            }

            if (!res.ok) {
                /**
                 * O erro vai para **baixo do campo** que o causou, nunca em
                 * toast — é a regra do DESIGN.md (Tela 01, o diálogo). O toast
                 * fica só para o erro que não pertence a campo nenhum, como o
                 * provedor fora do ar.
                 */
                if (corpo.campo) setErros({ [corpo.campo]: corpo.error ?? 'Valor inválido' })
                else toast.error(corpo.error ?? 'Não foi possível cadastrar o domínio')
                return
            }

            setNovoAberto(false)
            await recarregar()
            toast.success('Domínio cadastrado. Agora publique os registros no DNS.')

            /**
             * Abre as instruções de DNS no ato.
             *
             * Sem isto, a pessoa cadastra o domínio, vê "Aguardando DNS" na
             * lista e não tem como adivinhar que ainda falta ela fazer alguma
             * coisa — e o remetente ficaria pendente para sempre, parecendo
             * defeito nosso.
             *
             * O item sai da **resposta do POST**, não da releitura: `recarregar`
             * não devolve a lista, e procurar o id nela dependeria do estado já
             * ter sido aplicado — corrida que às vezes abriria o diálogo vazio.
             */
            setVendoDns({
                id: corpo.id ?? '',
                domain: corpo.domain ?? form.domain,
                from: corpo.from ?? `${form.fromLocal}@${form.domain}`,
                fromName: form.fromName,
                replyTo: form.replyTo,
                status: corpo.status ?? 'pending',
                dkimStatus: null,
                verifiedAt: null,
                lastCheckedAt: null,
                dns: corpo.dns ?? [],
                createdAt: new Date().toISOString(),
            })
        } catch {
            toast.error('Não foi possível cadastrar o domínio')
        } finally {
            setEnviando(false)
        }
    }

    const colunas: Column<RemetenteItem>[] = [
        {
            id: 'remetente',
            header: 'Remetente',
            sortable: true,
            sortValue: (r) => r.domain,
            cell: (r) => (
                <div className="flex flex-col">
                    <span className="text-sm text-foreground">{r.from}</span>
                    <span className="text-xs text-muted-foreground">{r.fromName}</span>
                </div>
            ),
        },
        {
            id: 'status',
            header: 'Situação',
            width: '11rem',
            cell: (r) => <StatusBadge value={r.status} map={SITUACAO_DO_REMETENTE} />,
        },
        {
            id: 'replyTo',
            header: 'Respostas vão para',
            width: '16rem',
            cell: (r) => <span className="text-sm text-muted-foreground">{r.replyTo}</span>,
        },
    ]

    return (
        <>
            <IndexFrame
                title="Remetentes"
                search={busca}
                onSearchChange={setBusca}
                primary={
                    canEdit ? (
                        <Button onClick={abrirNovo}>
                            <Plus /> Novo remetente
                        </Button>
                    ) : null
                }
            >
                <DataTable
                    columns={colunas}
                    rows={visiveis}
                    getRowId={(r) => r.id}
                    loading={loading}
                    frame
                    onRowClick={(r) => setVendoDns(r)}
                    empty={
                        <EmptyState
                            variant="inline"
                            icon={AtSign}
                            title="Nenhum remetente ainda"
                            description={`As campanhas de e-mail saem do domínio da ${BRAND.vocabulario.organizacao}, não de um endereço nosso — é o que faz quem recebe reconhecer quem mandou.`}
                            action={
                                canEdit ? (
                                    <Button onClick={abrirNovo}>
                                        <Plus /> Novo remetente
                                    </Button>
                                ) : null
                            }
                        />
                    }
                />
            </IndexFrame>

            <RecordDialog
                open={novoAberto}
                onOpenChange={setNovoAberto}
                title="Novo remetente"
                description={`O e-mail sai do domínio da ${BRAND.vocabulario.organizacao}. Depois de cadastrar, três registros precisam ser publicados no DNS dele.`}
                submitLabel="Cadastrar domínio"
                hideAgain
                onSubmit={salvar}
                submitting={enviando}
            >
                <FormField
                    label="Domínio"
                    htmlFor="rem-domain"
                    required
                    error={erros.domain}
                    className="col-span-2"
                    hint="Só o domínio, sem https:// e sem @. Um subdomínio como mkt.clinica.com.br separa a reputação das campanhas da do e-mail do dia a dia."
                >
                    <Input
                        id="rem-domain"
                        value={form.domain}
                        onChange={(e) => {
                            setForm((p) => ({ ...p, domain: e.target.value }))
                            if (erros.domain) setErros({})
                        }}
                        placeholder="clinica.com.br"
                        autoFocus
                    />
                </FormField>

                <FormField label="Endereço" htmlFor="rem-local" required error={erros.fromLocal}>
                    <Input
                        id="rem-local"
                        value={form.fromLocal}
                        onChange={(e) => setForm((p) => ({ ...p, fromLocal: e.target.value }))}
                        placeholder="contato"
                    />
                </FormField>

                <FormField
                    label="Nome que aparece"
                    htmlFor="rem-name"
                    required
                    error={erros.fromName}
                >
                    <Input
                        id="rem-name"
                        value={form.fromName}
                        onChange={(e) => setForm((p) => ({ ...p, fromName: e.target.value }))}
                        placeholder="Clínica Sorriso Claro"
                    />
                </FormField>

                <FormField
                    label="Respostas vão para"
                    htmlFor="rem-reply"
                    required
                    error={erros.replyTo}
                    className="col-span-2"
                    hint="Quem responder a uma campanha chega nesta caixa. As respostas não entram em Conversas."
                >
                    <Input
                        id="rem-reply"
                        type="email"
                        value={form.replyTo}
                        onChange={(e) => setForm((p) => ({ ...p, replyTo: e.target.value }))}
                        placeholder="contato@clinica.com.br"
                    />
                </FormField>
            </RecordDialog>

            <InstrucoesDeDns remetente={vendoDns} onClose={() => setVendoDns(null)} />
        </>
    )
}

/**
 * Os registros que o cliente publica, num diálogo largo.
 *
 * `size="wide"` (1120px) porque isto é conteúdo que **se lê e se copia**, não
 * formulário que se preenche — e é exatamente o caso que o DESIGN.md reserva
 * para o largo. Em 840 a coluna do valor do CNAME corta no meio do token.
 *
 * Sem `submitLabel` e sem `onSubmit`: o `RecordDialog` já trata quadro de
 * leitura como caso próprio — sem ação primária ele desenha **um** botão, que
 * fecha. Passando um `submitLabel="Fechar"` saíam dois botões, "Cancelar" e
 * "Fechar", oferecendo uma escolha entre duas coisas idênticas.
 */
function InstrucoesDeDns({
    remetente,
    onClose,
}: {
    remetente: RemetenteItem | null
    onClose: () => void
}) {
    return (
        <RecordDialog
            open={remetente !== null}
            onOpenChange={(aberto) => !aberto && onClose()}
            size="wide"
            title={remetente ? `Registros de ${remetente.domain}` : 'Registros'}
            description={remetente ? explicacaoDoDkim(remetente.dkimStatus) : ''}
        >
            <div className="col-span-2 space-y-4">
                <p className="text-sm text-muted-foreground">
                    Acrescente estes três registros na zona do domínio, onde o DNS dele é
                    administrado. A verificação acontece sozinha — não é preciso voltar aqui.
                </p>

                <div className="overflow-x-auto rounded-xl border border-border/60">
                    <table className="w-full text-sm">
                        <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                            <tr>
                                <th className="px-3 py-2 text-left font-medium">Tipo</th>
                                <th className="px-3 py-2 text-left font-medium">Nome</th>
                                <th className="px-3 py-2 text-left font-medium">Valor</th>
                                <th className="w-10" />
                            </tr>
                        </thead>
                        <tbody>
                            {(remetente?.dns ?? []).map((registro) => (
                                <LinhaDeRegistro key={registro.nome} registro={registro} />
                            ))}
                        </tbody>
                    </table>
                </div>

                {(remetente?.dns.length ?? 0) === 0 && (
                    <p className="text-sm text-muted-foreground">
                        Os registros ainda não foram gerados. Recarregue a página em instantes.
                    </p>
                )}
            </div>
        </RecordDialog>
    )
}

/**
 * Uma linha de registro, com botão de copiar.
 *
 * Copiar importa mais do que parece: o valor do CNAME é um token de 32
 * caracteres, e digitá-lo à mão é a forma mais provável de a verificação falhar
 * — e falhar de um jeito que a pessoa vai atribuir ao nosso sistema.
 */
function LinhaDeRegistro({ registro }: { registro: RegistroDeDns }) {
    const [copiado, setCopiado] = useState<'nome' | 'valor' | null>(null)

    async function copiar(texto: string, qual: 'nome' | 'valor') {
        try {
            await navigator.clipboard.writeText(texto)
            setCopiado(qual)
            setTimeout(() => setCopiado(null), 1600)
        } catch {
            toast.error('Não foi possível copiar')
        }
    }

    return (
        <tr className="border-t border-border/60">
            <td className="px-3 py-2 text-muted-foreground">{registro.tipo}</td>
            <td className="px-3 py-2">
                <button
                    type="button"
                    onClick={() => copiar(registro.nome, 'nome')}
                    className="flex items-center gap-1.5 text-left font-mono text-xs break-all hover:text-foreground"
                >
                    {registro.nome}
                    {copiado === 'nome' ? (
                        <Check className="size-3.5 shrink-0 text-emerald-600" />
                    ) : (
                        <Copy className="size-3.5 shrink-0 opacity-40" />
                    )}
                </button>
            </td>
            <td className="px-3 py-2">
                <button
                    type="button"
                    onClick={() => copiar(registro.valor, 'valor')}
                    className="flex items-center gap-1.5 text-left font-mono text-xs break-all hover:text-foreground"
                >
                    {registro.valor}
                    {copiado === 'valor' ? (
                        <Check className="size-3.5 shrink-0 text-emerald-600" />
                    ) : (
                        <Copy className="size-3.5 shrink-0 opacity-40" />
                    )}
                </button>
            </td>
            <td className="px-3 py-2 text-right">
                <Settings2 className="ml-auto size-3.5 opacity-0" aria-hidden />
            </td>
        </tr>
    )
}
