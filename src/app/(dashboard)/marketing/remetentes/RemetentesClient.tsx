'use client'

import { useCallback, useEffect, useState } from 'react'
import { AtSign, Check, Copy, Plus, RefreshCw, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@venn/ui/button'
import { Input } from '@venn/ui/input'
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
import type { SugestaoDeDmarc } from '@/lib/marketing/dmarc'

import type { DadosIniciais, RemetenteItem } from './dados'

const RECORTE_INTEIRO = 'workspace-inteiro'

/** O que a rota de DMARC devolve, como a tela o consome. */
type AchadoNaTela =
    | { encontrado: true; onde: string; herdado: boolean; registro: string }
    | { encontrado: false; indisponivel: boolean; sugestao: SugestaoDeDmarc }

/** O formulário da ficha. O domínio só é editável na criação. */
const FORM_VAZIO = { domain: '', fromLocal: 'contato', fromName: '', replyTo: '' }
type CampoDoForm = keyof typeof FORM_VAZIO

export function RemetentesClient({ inicial }: { inicial: DadosIniciais }) {
    const { canEdit } = usePermissions()

    const buscar = useCallback(async () => {
        const res = await fetch('/api/marketing/remetentes')
        if (!res.ok) {
            toast.error('Não foi possível carregar os domínios')
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
    /**
     * Uma ficha, dois modos.
     *
     * `'novo'` abre em branco com o domínio editável; um item abre com os dados
     * dele e o domínio travado. Antes eram dois diálogos — o de cadastro e o de
     * registros DNS, que abria ao clicar na linha —, e o resultado era que ver
     * os CNAME e conferir o remetente eram telas diferentes do mesmo assunto.
     */
    const [ficha, setFicha] = useState<RemetenteItem | 'novo' | null>(null)

    /**
     * A `key` da ficha, e por que ela existe em vez de um efeito.
     *
     * A ficha precisa recomeçar com os dados do alvo quando o alvo troca. A
     * forma errada é sincronizar por `useEffect` + `setState` — o próprio
     * ESLint do projeto recusa, e com razão: é render em cascata para resolver
     * algo que o React já resolve remontando o componente.
     *
     * A `key` **não** volta a `null` ao fechar, de propósito: se voltasse, o
     * componente desmontaria antes da animação de saída e o diálogo piscaria.
     * Ela só muda quando outra ficha abre.
     */
    const [chaveDaFicha, setChaveDaFicha] = useState('vazia')

    function abrir(alvo: RemetenteItem | 'novo') {
        setChaveDaFicha(alvo === 'novo' ? `novo-${Date.now()}` : alvo.id)
        setFicha(alvo)
    }

    const visiveis = remetentes.filter(
        (r) =>
            busca.trim() === '' ||
            r.domain.includes(busca.trim().toLowerCase()) ||
            r.fromName.toLowerCase().includes(busca.trim().toLowerCase())
    )

    const colunas: Column<RemetenteItem>[] = [
        {
            id: 'domain',
            header: 'Domínio',
            cell: (r) => (
                <div className="min-w-0">
                    <div className="truncate font-medium">{r.domain}</div>
                    <div className="truncate text-xs text-muted-foreground">{r.from}</div>
                </div>
            ),
        },
        {
            id: 'fromName',
            header: 'Nome que aparece',
            width: '16rem',
            cell: (r) => <span className="text-sm">{r.fromName}</span>,
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
                title="Domínios"
                search={busca}
                onSearchChange={setBusca}
                primary={
                    canEdit ? (
                        <Button onClick={() => abrir('novo')}>
                            <Plus /> Novo domínio
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
                    onRowClick={(r) => abrir(r)}
                    empty={
                        <EmptyState
                            variant="inline"
                            icon={AtSign}
                            title="Nenhum domínio ainda"
                            description={`As campanhas de e-mail saem do domínio da ${BRAND.vocabulario.organizacao}, não de um endereço nosso — é o que faz quem recebe reconhecer quem mandou.`}
                            action={
                                canEdit ? (
                                    <Button onClick={() => abrir('novo')}>
                                        <Plus /> Novo domínio
                                    </Button>
                                ) : null
                            }
                        />
                    }
                />
            </IndexFrame>

            <FichaDoDominio
                key={chaveDaFicha}
                alvo={ficha}
                podeEditar={canEdit}
                onClose={() => setFicha(null)}
                onSalvo={recarregar}
                onCriado={(novo) => abrir(novo)}
            />
        </>
    )
}

/**
 * A ficha de um domínio: os campos, os registros de DNS e o botão de verificar.
 *
 * `size="grande"` (960×800) e não `wide`: em 840 a coluna do valor do CNAME
 * cortava no meio do token — e o token é justamente o que a pessoa precisa
 * levar inteiro para o painel de DNS dela —, mas `wide` tem altura automática e
 * deixava a ficha baixa e retangular, com os campos perdidos na largura. O
 * `grande` guarda a proporção de 1,2:1 do padrão: é a mesma ficha, maior.
 */
function FichaDoDominio({
    alvo,
    podeEditar,
    onClose,
    onSalvo,
    onCriado,
}: {
    alvo: RemetenteItem | 'novo' | null
    podeEditar: boolean
    onClose: () => void
    onSalvo: () => Promise<unknown> | void
    onCriado: (novo: RemetenteItem) => void
}) {
    const ehNovo = alvo === 'novo'
    const item = alvo && alvo !== 'novo' ? alvo : null

    /**
     * Tudo nasce do alvo, no inicializador — não num efeito.
     *
     * Quem garante que isto roda de novo quando a ficha troca é a `key` no
     * componente (ver o pai). Sem ela, estes valores ficariam presos no
     * primeiro alvo; com ela, o React remonta e o inicializador roda — que é o
     * caminho que a documentação do React indica para "reiniciar estado quando
     * uma prop muda", e o que evita o render em cascata que o `setState` dentro
     * de efeito provoca.
     */
    const [form, setForm] = useState(() =>
        item
            ? {
                  domain: item.domain,
                  fromLocal: item.fromLocal,
                  fromName: item.fromName,
                  replyTo: item.replyTo,
              }
            : FORM_VAZIO
    )
    const [erros, setErros] = useState<Partial<Record<CampoDoForm, string>>>({})
    const [enviando, setEnviando] = useState(false)

    /** O estado vivo da verificação — ele muda sem recarregar a lista. */
    const [situacao, setSituacao] = useState<string | null>(item?.status ?? null)
    const [dkimStatus, setDkimStatus] = useState<string | null>(item?.dkimStatus ?? null)
    const [dns, setDns] = useState<RegistroDeDns[]>(item?.dns ?? [])
    const [verificando, setVerificando] = useState(false)

    /**
     * O DMARC, consultado ao vivo na zona do cliente.
     *
     * Este efeito **busca dado**, não sincroniza estado com prop — é o uso que
     * o React reserva para efeito, e não o que o lint do projeto recusa (o
     * `setState` em efeito para copiar prop, que aqui é resolvido pela `key`).
     * `undefined` é "ainda perguntando"; o resto vem da rota.
     */
    const [dmarc, setDmarc] = useState<AchadoNaTela | undefined>(undefined)

    useEffect(() => {
        if (!item) return
        let vivo = true
        fetch(`/api/marketing/remetentes/${item.id}/dmarc`)
            .then((r) => (r.ok ? (r.json() as Promise<AchadoNaTela>) : null))
            .then((corpo) => {
                if (vivo && corpo) setDmarc(corpo)
            })
            .catch(() => {})
        return () => {
            vivo = false
        }
    }, [item])

    function mudar(campo: CampoDoForm, valor: string) {
        setForm((p) => ({ ...p, [campo]: valor }))
        if (erros[campo]) setErros((p) => ({ ...p, [campo]: undefined }))
    }

    async function salvar() {
        setEnviando(true)
        try {
            const res = await fetch(
                ehNovo ? '/api/marketing/remetentes' : `/api/marketing/remetentes/${item?.id}`,
                {
                    method: ehNovo ? 'POST' : 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(
                        ehNovo
                            ? form
                            : {
                                  fromLocal: form.fromLocal,
                                  fromName: form.fromName,
                                  replyTo: form.replyTo,
                              }
                    ),
                }
            )
            const corpo = (await res.json().catch(() => ({}))) as {
                id?: string
                error?: string
                campo?: CampoDoForm
                dns?: RegistroDeDns[]
                status?: string
            }

            if (!res.ok) {
                if (corpo.campo) setErros({ [corpo.campo]: corpo.error })
                else toast.error(corpo.error ?? 'Não foi possível salvar')
                return
            }

            await onSalvo()

            if (ehNovo && corpo.id) {
                /**
                 * Cadastrou: a ficha **continua aberta**, agora com os registros.
                 *
                 * Fechar aqui esconderia os três CNAME no instante em que eles
                 * passam a existir, e a pessoa teria de descobrir que precisa
                 * clicar na linha para vê-los. Publicar o DNS é o passo
                 * seguinte do mesmo gesto.
                 */
                onCriado({
                    id: corpo.id,
                    domain: form.domain.trim().toLowerCase(),
                    from: `${form.fromLocal}@${form.domain.trim().toLowerCase()}`,
                    fromLocal: form.fromLocal,
                    fromName: form.fromName,
                    replyTo: form.replyTo,
                    status: corpo.status ?? 'pending',
                    dkimStatus: null,
                    verifiedAt: null,
                    lastCheckedAt: null,
                    dns: corpo.dns ?? [],
                    createdAt: new Date().toISOString(),
                })
                toast.success('Domínio cadastrado. Agora publique os três registros abaixo.')
                return
            }

            toast.success('Domínio atualizado')
            onClose()
        } finally {
            setEnviando(false)
        }
    }

    async function verificarAgora() {
        if (!item) return
        setVerificando(true)
        try {
            const res = await fetch(`/api/marketing/remetentes/${item.id}/verificar`, {
                method: 'POST',
            })
            const corpo = (await res.json().catch(() => ({}))) as {
                status?: string
                dkimStatus?: string | null
                dns?: RegistroDeDns[]
                error?: string
            }
            if (!res.ok) {
                toast.error(corpo.error ?? 'Não foi possível verificar agora')
                return
            }
            setSituacao(corpo.status ?? situacao)
            setDkimStatus(corpo.dkimStatus ?? null)
            if (corpo.dns) setDns(corpo.dns)
            await onSalvo()

            if (corpo.status === 'verified') toast.success('Domínio validado — já pode disparar')
            else if (corpo.status === 'failed') toast.error('O provedor recusou os registros')
            else toast.info('Os registros ainda não foram encontrados. Isso pode levar algumas horas.')
        } finally {
            setVerificando(false)
        }
    }

    /** O sufixo cinza do campo de endereço. */
    const sufixo = form.domain.trim() ? `@${form.domain.trim().toLowerCase()}` : '@seudominio.com.br'

    return (
        <RecordDialog
            open={alvo !== null}
            onOpenChange={(aberto) => !aberto && onClose()}
            size="grande"
            title={ehNovo ? 'Novo domínio' : form.domain}
            description={
                ehNovo
                    ? `O e-mail sai do domínio da ${BRAND.vocabulario.organizacao}. Depois de cadastrar, três registros precisam ser publicados no DNS dele.`
                    : explicacaoDoDkim(dkimStatus)
            }
            submitLabel={podeEditar ? (ehNovo ? 'Cadastrar domínio' : 'Salvar') : undefined}
            hideAgain
            onSubmit={podeEditar ? salvar : undefined}
            submitting={enviando}
        >
            <FormField
                label="Domínio"
                htmlFor="rem-domain"
                required
                error={erros.domain}
                className="col-span-2"
                hint={
                    ehNovo
                        ? 'Só o domínio, sem https:// e sem @. Recomendamos um subdomínio como mkt.clinica.com.br, assim separa a reputação do seu e-mail.'
                        : 'O domínio não muda: no provedor de e-mail ele É a identidade, e trocá-lo exigiria publicar outros três registros. Para usar outro, cadastre um novo.'
                }
            >
                <Input
                    id="rem-domain"
                    value={form.domain}
                    onChange={(e) => mudar('domain', e.target.value)}
                    placeholder="clinica.com.br"
                    autoFocus={ehNovo}
                    /**
                     * Travado fora da criação, e a razão está no `hint` acima —
                     * não é zelo de formulário: editar aqui invalidaria o DKIM
                     * que o cliente já publicou, sem nada dizer.
                     */
                    disabled={!ehNovo || !podeEditar}
                />
            </FormField>

            <FormField
                label="Endereço"
                htmlFor="rem-local"
                required
                error={erros.fromLocal}
                hint="Só o que vem antes do @."
            >
                {/*
                  O domínio fica à direita, em cinza e fora do campo.
                  Antes o campo pedia só o prefixo e não mostrava o resto, e o
                  erro previsível era digitar o endereço inteiro — que o schema
                  recusa por causa do @, com uma mensagem que a pessoa não
                  esperava. Mostrar o sufixo faz o formato ser óbvio sem precisar
                  de aviso.
                */}
                <div className="flex h-9 items-center rounded-md border border-input bg-transparent focus-within:ring-1 focus-within:ring-ring">
                    <Input
                        id="rem-local"
                        value={form.fromLocal}
                        onChange={(e) => mudar('fromLocal', e.target.value)}
                        placeholder="contato"
                        disabled={!podeEditar}
                        className="h-8 min-w-0 flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0"
                    />
                    <span
                        className="shrink-0 select-all truncate px-2.5 text-sm text-muted-foreground"
                        title={sufixo}
                    >
                        {sufixo}
                    </span>
                </div>
            </FormField>

            <FormField label="Nome que aparece" htmlFor="rem-name" required error={erros.fromName}>
                <Input
                    id="rem-name"
                    value={form.fromName}
                    onChange={(e) => mudar('fromName', e.target.value)}
                    placeholder="Clínica Sorriso Claro"
                    disabled={!podeEditar}
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
                    onChange={(e) => mudar('replyTo', e.target.value)}
                    placeholder="contato@clinica.com.br"
                    disabled={!podeEditar}
                />
            </FormField>

            {ehNovo ? (
                <p className="col-span-2 rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
                    Ao cadastrar, aparecem aqui os três registros CNAME para publicar no DNS deste
                    domínio. Enquanto eles não forem encontrados, as campanhas não saem.
                </p>
            ) : (
                <CartaoDeDns
                    situacao={situacao}
                    dns={dns}
                    dmarc={dmarc}
                    verificando={verificando}
                    podeVerificar={podeEditar}
                    onVerificar={verificarAgora}
                />
            )}
        </RecordDialog>
    )
}

/**
 * O cartão dos registros, dentro da própria ficha.
 *
 * Com o selo de situação e o botão de verificar no cabeçalho dele: é o mesmo
 * assunto — "o DNS já está certo?" —, e separar o estado do que o produz
 * obrigava a pessoa a olhar em dois lugares para responder a uma pergunta.
 *
 * ## A moldura é o cartão do sistema: `rounded-lg` com a borda cheia
 *
 * **Não** o "cartão de tabela" das telas de índice (`rounded-xl` com moldura
 * `border/60`). Aquele desenho saiu do sistema em 2026-11-09, quando a tabela
 * de índice passou a sangrar — margem zero nas quatro extremidades e o respiro
 * na célula. Aqui é um bloco dentro de um diálogo, e bloco se separa por borda
 * e superfície (DESIGN.md §4 e §5).
 *
 * E é **um** cartão, não dois. Na primeira versão deste arquivo a tabela tinha
 * moldura própria dentro deste bloco, o que desenhava duas molduras
 * concêntricas; ela virou a última faixa, separada por borda de topo, com
 * `overflow-hidden` no pai para o arredondamento valer até a última linha.
 */
function CartaoDeDns({
    situacao,
    dns,
    dmarc,
    verificando,
    podeVerificar,
    onVerificar,
}: {
    situacao: string | null
    dns: RegistroDeDns[]
    dmarc: AchadoNaTela | undefined
    verificando: boolean
    podeVerificar: boolean
    onVerificar: () => void
}) {
    return (
        <div className="col-span-2 overflow-hidden rounded-lg border border-border">
            <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
                <h3 className="text-sm font-medium">Registros no DNS</h3>
                <StatusBadge value={situacao} map={SITUACAO_DO_REMETENTE} />
                {podeVerificar && (
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="ml-auto"
                        onClick={onVerificar}
                        disabled={verificando}
                    >
                        <RefreshCw className={verificando ? 'animate-spin' : undefined} />
                        {verificando ? 'Verificando…' : 'Verificar agora'}
                    </Button>
                )}
            </div>

            <div className="space-y-3 p-4">
                <p className="text-sm text-muted-foreground">
                    Acrescente estes três registros na zona do domínio, onde o DNS dele é
                    administrado. A verificação também acontece sozinha de hora em hora — o botão
                    serve para não esperar.
                </p>

                {dns.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                        Os registros ainda não foram gerados. Use “Verificar agora”.
                    </p>
                )}
            </div>

            {dns.length > 0 && (
                <div className="overflow-x-auto border-t border-border">
                    <table className="w-full text-sm">
                        <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                            <tr>
                                <th className="px-3 py-2 text-left font-medium">Tipo</th>
                                <th className="px-3 py-2 text-left font-medium">Nome</th>
                                <th className="px-3 py-2 text-left font-medium">Valor</th>
                            </tr>
                        </thead>
                        <tbody>
                            {dns.map((registro) => (
                                <LinhaDeRegistro key={registro.nome} registro={registro} />
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            <FaixaDeDmarc dmarc={dmarc} />
        </div>
    )
}

/**
 * O DMARC, como última faixa do mesmo cartão.
 *
 * ## Por que não é um quarto CNAME na tabela de cima
 *
 * Aquela tabela é a lista do que **o SES exige** — enquanto falta um daqueles
 * três, o domínio não verifica e a campanha não sai. O DMARC não bloqueia nada
 * nosso: sem ele o envio funciona e a entrega piora, porque Gmail e Yahoo
 * passaram a exigir política publicada de quem manda em massa (fev/2024).
 * Misturar os dois na mesma lista faria o obrigatório e o recomendado terem o
 * mesmo peso, e o previsível é a pessoa parar no primeiro erro de verificação
 * achando que o DMARC também a reprovou.
 *
 * ## Três estados, e o terceiro não é detalhe
 *
 * Publicado, faltando, e **não deu para olhar**. Tratar falha de rede como
 * "faltando" mandaria publicar um registro que talvez já exista — e, quando o
 * domínio é um subdomínio, publicá-lo *afrouxa* a política da raiz, porque a do
 * subdomínio prevalece. Por isso a indisponibilidade aparece como tal.
 */
function FaixaDeDmarc({ dmarc }: { dmarc: AchadoNaTela | undefined }) {
    if (dmarc === undefined) {
        return (
            <div className="border-t border-border px-4 py-3 text-sm text-muted-foreground">
                Conferindo a política DMARC do domínio…
            </div>
        )
    }

    if (dmarc.encontrado) {
        return (
            <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3 text-sm">
                <ShieldCheck className="size-4 shrink-0 text-muted-foreground" />
                <span className="font-medium">DMARC publicado</span>
                <span className="text-muted-foreground">
                    em <code className="font-mono text-[13px]">{dmarc.onde}</code>
                    {dmarc.herdado && ' — herdado pelo subdomínio, não precisa repetir aqui'}
                </span>
            </div>
        )
    }

    if (dmarc.indisponivel) {
        return (
            <div className="border-t border-border px-4 py-3 text-sm text-muted-foreground">
                Não foi possível consultar a política DMARC agora. Reabra a ficha para tentar de
                novo — nada aqui depende disso para as campanhas saírem.
            </div>
        )
    }

    return (
        <div className="space-y-2.5 border-t border-border px-4 py-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
                <ShieldCheck className="size-4 shrink-0 text-muted-foreground" />
                <span className="font-medium">Falta a política DMARC</span>
                <span className="text-muted-foreground">recomendado, não obrigatório</span>
            </div>
            <p className="text-sm text-muted-foreground">
                As campanhas saem sem ela, mas Gmail e Yahoo exigem política publicada de quem envia
                em volume — sem ela a entrega cai sem erro aparente. Os três CNAME acima já cuidam
                da assinatura; falta só declarar a política. <code className="font-mono">p=none</code>{' '}
                não muda o tratamento de nada que hoje funciona.
            </p>
            <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                        <tr>
                            <th className="px-3 py-2 text-left font-medium">Tipo</th>
                            <th className="px-3 py-2 text-left font-medium">Nome</th>
                            <th className="px-3 py-2 text-left font-medium">Valor</th>
                        </tr>
                    </thead>
                    <tbody>
                        <LinhaDeRegistro registro={dmarc.sugestao} />
                    </tbody>
                </table>
            </div>
        </div>
    )
}

/**
 * Uma linha de registro, com botão de copiar.
 *
 * Copiar importa mais do que parece: o valor do CNAME é um token de 32
 * caracteres, e digitá-lo à mão é a forma mais provável de a verificação falhar
 * — e falhar de um jeito que a pessoa vai atribuir ao nosso sistema.
 */
function LinhaDeRegistro({
    registro,
}: {
    /**
     * Qualquer registro com tipo, nome e valor — os CNAME do DKIM e o TXT do
     * DMARC. O tipo é texto e não a união dos dois de propósito: o que esta
     * linha faz é mostrar e copiar, e ela não decide nada a partir dele.
     */
    registro: RegistroDeDns | SugestaoDeDmarc
}) {
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
                        <Check className="size-3.5 shrink-0 text-success-subtle-foreground" />
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
                        <Check className="size-3.5 shrink-0 text-success-subtle-foreground" />
                    ) : (
                        <Copy className="size-3.5 shrink-0 opacity-40" />
                    )}
                </button>
            </td>
        </tr>
    )
}
