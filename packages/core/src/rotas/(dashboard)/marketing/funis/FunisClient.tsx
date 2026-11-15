'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { GitBranch, Pencil, Plus, Trash2, UserPlus } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@venn/ui/button'
import { Input } from '@venn/ui/input'
import { ConfirmDialog } from '@venn/core/components/shared/ConfirmDialog'
import { DataTable, type Column } from '@venn/core/components/shared/DataTable'
import { EmptyState } from '@venn/core/components/shared/EmptyState'
import { FormField } from '@venn/core/components/shared/FormField'
import { IndexFrame } from '@venn/core/components/shared/IndexFrame'
import { RecordDialog } from '@venn/core/components/shared/RecordDialog'
import { RowActionItem, RowActions } from '@venn/core/components/shared/RowActions'
import { StatusBadge } from '@venn/core/components/shared/StatusBadge'
import { usePermissions } from '@venn/core/hooks/usePermissions'
import { useIndiceServidor } from '@venn/core/hooks/useIndiceServidor'
import { ContactPicker, type PickedContact } from '@venn/core/components/shared/ContactPicker'
import { frasedoGatilho, SITUACAO_DO_FUNIL } from '@venn/core/lib/funil/apresentacao'
import { lerGatilho } from '@venn/core/lib/funil/gatilho'
import { GALERIA_DE_FUNIS } from '@venn/core/lib/funil/galeria'
import { useVocab } from '@venn/core/hooks/useVocab'

import type { DadosIniciais, FunilItem } from './dados'

const RECORTE_INTEIRO = 'workspace-inteiro'

/**
 * Este funil recebe gente por decisão de alguém?
 *
 * Lê o gatilho com a mesma função do servidor (`lerGatilho`) em vez de olhar o
 * Json à mão: gatilho ilegível é "não é manual", e não um `trigger.tipo`
 * qualquer que a tela resolveu acreditar.
 */
function ehManual(f: FunilItem): boolean {
    return lerGatilho(f.trigger)?.tipo === 'manual' && f.status === 'published'
}

export function FunisClient({ inicial }: { inicial: DadosIniciais }) {
    // Pelo contexto: a galeria interpola o vocabulário, e no navegador
    // `BRAND()` lança.
    const v = useVocab()
    const { canEdit } = usePermissions()
    const router = useRouter()

    const buscar = useCallback(async () => {
        const res = await fetch('/api/marketing/funis')
        if (!res.ok) {
            toast.error('Não foi possível carregar os funis')
            return null
        }
        const itens = (await res.json()) as FunilItem[]
        return { itens, total: itens.length, totalPages: 1 }
    }, [])

    const {
        itens: funis,
        carregando: loading,
        recarregar,
    } = useIndiceServidor<FunilItem>({ inicial, recorte: RECORTE_INTEIRO, buscar })

    const [busca, setBusca] = useState('')
    const [novoAberto, setNovoAberto] = useState(false)
    const [nome, setNome] = useState('')
    const [modelo, setModelo] = useState<string>('vazio')
    const [erro, setErro] = useState<string | undefined>()
    const [criando, setCriando] = useState(false)
    const [apagando, setApagando] = useState<FunilItem | null>(null)
    const [pondo, setPondo] = useState<FunilItem | null>(null)

    const visiveis = funis.filter(
        (f) =>
            busca.trim() === '' || f.name.toLowerCase().includes(busca.trim().toLowerCase())
    )

    async function criar() {
        if (!nome.trim()) {
            setErro('Dê um nome ao funil')
            return
        }
        setCriando(true)
        try {
            const partida = GALERIA_DE_FUNIS(v).find((g) => g.id === modelo)
            const res = await fetch('/api/marketing/funis', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: nome.trim(),
                    description: partida?.descricao ?? null,
                    trigger: partida?.trigger ?? { tipo: 'contato_criado' },
                    maxAtivos: partida?.maxAtivos ?? null,
                    passos: partida?.passos ?? [],
                }),
            })
            const corpo = (await res.json().catch(() => ({}))) as { id?: string; error?: string }
            if (!res.ok) {
                setErro(corpo.error ?? 'Não foi possível criar o funil')
                return
            }
            setNovoAberto(false)
            // Direto para o canvas: criar um funil sem desenhá-lo não tem
            // utilidade, e voltar para a lista obrigaria a um clique a mais
            // sempre.
            router.push(`/marketing/funis/${corpo.id}`)
        } finally {
            setCriando(false)
        }
    }

    async function apagar() {
        if (!apagando) return
        const res = await fetch(`/api/marketing/funis/${apagando.id}`, { method: 'DELETE' })
        if (!res.ok) {
            const corpo = (await res.json().catch(() => ({}))) as { error?: string }
            toast.error(corpo.error ?? 'Não foi possível apagar')
            return
        }
        setApagando(null)
        await recarregar()
    }

    const colunas: Column<FunilItem>[] = [
        {
            id: 'name',
            header: 'Funil',
            cell: (f) => (
                <div className="min-w-0">
                    <div className="truncate font-medium">{f.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                        {frasedoGatilho(f.trigger)} · {f.passos} passo{f.passos === 1 ? '' : 's'}
                    </div>
                </div>
            ),
        },
        {
            id: 'status',
            header: 'Situação',
            width: '9rem',
            cell: (f) => <StatusBadge value={f.status} map={SITUACAO_DO_FUNIL} />,
        },
        {
            id: 'ativos',
            header: 'Dentro',
            width: '7rem',
            cell: (f) => (
                <span className="text-sm">
                    {f.ativos}
                    {f.maxAtivos !== null && (
                        <span className="text-muted-foreground"> / {f.maxAtivos}</span>
                    )}
                </span>
            ),
        },
        {
            id: 'desfechos',
            header: 'Terminaram · pararam',
            width: '13rem',
            /**
             * Os dois juntos e separados por "·", não somados.
             *
             * "Parou porque a recepção assumiu" é o funil funcionando; "terminou"
             * é a sequência entregue. Um número só esconderia a pergunta que a
             * dona da clínica faz primeiro.
             */
            cell: (f) => (
                <span className="text-sm text-muted-foreground">
                    {f.concluidos} · {f.parados}
                    {f.falhos > 0 && (
                        <span className="text-destructive"> · {f.falhos} com falha</span>
                    )}
                </span>
            ),
        },
    ]

    return (
        <>
            <IndexFrame
                title="Funis"
                search={busca}
                onSearchChange={setBusca}
                primary={
                    canEdit ? (
                        <Button onClick={() => { setNome(''); setModelo('vazio'); setErro(undefined); setNovoAberto(true) }}>
                            <Plus /> Novo funil
                        </Button>
                    ) : null
                }
            >
                <DataTable
                    columns={colunas}
                    rows={visiveis}
                    getRowId={(f) => f.id}
                    loading={loading}
                    frame
                    onRowClick={(f) => router.push(`/marketing/funis/${f.id}`)}
                    rowActions={
                        canEdit
                            ? (f) => (
                                  <RowActions label={`Ações do funil ${f.name}`}>
                                      <RowActionItem
                                          icon={Pencil}
                                          onClick={() => router.push(`/marketing/funis/${f.id}`)}
                                      >
                                          Abrir o desenho
                                      </RowActionItem>
                                      {/*
                                        Só nos funis de gatilho manual: nos
                                        outros a rota recusa, e oferecer um
                                        botão que sempre dá erro é pior que não
                                        oferecer. Ver a rota `entrar`.
                                      */}
                                      {ehManual(f) && (
                                          <RowActionItem
                                              icon={UserPlus}
                                              onClick={() => setPondo(f)}
                                          >
                                              Pôr um contato aqui
                                          </RowActionItem>
                                      )}
                                      <RowActionItem
                                          icon={Trash2}
                                          destructive
                                          onClick={() => setApagando(f)}
                                      >
                                          Apagar
                                      </RowActionItem>
                                  </RowActions>
                              )
                            : undefined
                    }
                    empty={
                        <EmptyState
                            variant="inline"
                            icon={GitBranch}
                            title="Nenhum funil ainda"
                            description="Um funil manda a sequência sozinho — e para por conta própria quando alguém da equipe assume a conversa."
                            action={
                                canEdit ? (
                                    <Button onClick={() => setNovoAberto(true)}>
                                        <Plus /> Novo funil
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
                title="Novo funil"
                description="Nasce como rascunho. Nada é enviado até você publicar."
                submitLabel="Criar e desenhar"
                onSubmit={criar}
                submitting={criando}
            >
                <FormField
                    label="Nome"
                    htmlFor="funil-nome"
                    required
                    error={erro}
                    className="col-span-2"
                >
                    <Input
                        id="funil-nome"
                        value={nome}
                        onChange={(e) => {
                            setNome(e.target.value)
                            if (erro) setErro(undefined)
                        }}
                        placeholder="Retorno de seis meses"
                        autoFocus
                    />
                </FormField>

                <FormField
                    label="Começar de"
                    htmlFor="funil-modelo"
                    className="col-span-2"
                    hint="Um ponto de partida já desenhado, que você ajusta depois. Tudo nasce como rascunho."
                >
                    <select
                        id="funil-modelo"
                        value={modelo}
                        onChange={(e) => setModelo(e.target.value)}
                        className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                    >
                        <option value="vazio">Começar do zero</option>
                        {GALERIA_DE_FUNIS(v).map((g) => (
                            <option key={g.id} value={g.id}>
                                {g.nome}
                            </option>
                        ))}
                    </select>
                </FormField>
            </RecordDialog>

            <PorContatoNoFunil
                funil={pondo}
                onClose={() => setPondo(null)}
                onPosto={recarregar}
            />

            <ConfirmDialog
                open={apagando !== null}
                onOpenChange={(aberto) => !aberto && setApagando(null)}
                title={`Apagar "${apagando?.name ?? ''}"?`}
                description="O desenho e o histórico de passagens vão com ele. Funil com gente dentro não é apagado — despublique primeiro."
                confirmLabel="Apagar funil"
                destructive
                onConfirm={apagar}
            />
        </>
    )
}

/**
 * Pôr um contato num funil manual.
 *
 * ## Por que não fecha ao concluir
 *
 * Quem usa entrada manual costuma pôr **vários** — "os cinco que conversei na
 * feira". Fechar a cada um obrigaria a reabrir o menu da linha cinco vezes.
 * Então o diálogo fica, o campo limpa, e a contagem do que já entrou aparece
 * ali: é o mesmo espírito do "Criar e novo" do padrão de ficha.
 *
 * ## Por que o "já estava dentro" é aviso e não erro
 *
 * A rota responde `entrou: false` quando a passagem já existe. Não é falha de
 * nada — é a trava de uma passagem por vez fazendo o trabalho dela —, mas
 * também não é sucesso: dizer "pronto" faria a pessoa achar que a sequência vai
 * começar de novo, e ela não vai.
 */
function PorContatoNoFunil({
    funil,
    onClose,
    onPosto,
}: {
    funil: FunilItem | null
    onClose: () => void
    onPosto: () => Promise<unknown> | void
}) {
    const [contato, setContato] = useState<PickedContact | null>(null)
    const [enviando, setEnviando] = useState(false)
    const [postos, setPostos] = useState(0)

    async function por() {
        if (!funil || !contato) return
        setEnviando(true)
        try {
            const res = await fetch(`/api/marketing/funis/${funil.id}/entrar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contactId: contato.id }),
            })
            const corpo = (await res.json().catch(() => ({}))) as {
                entrou?: boolean
                error?: string
            }
            if (!res.ok) {
                toast.error(corpo.error ?? 'Não foi possível pôr o contato no funil')
                return
            }

            if (corpo.entrou) {
                setPostos((n) => n + 1)
                toast.success(`${contato.name ?? 'O contato'} entrou em "${funil.name}"`)
            } else {
                toast.info(`${contato.name ?? 'O contato'} já estava neste funil — nada recomeçou`)
            }
            setContato(null)
            await onPosto()
        } finally {
            setEnviando(false)
        }
    }

    return (
        <RecordDialog
            open={funil !== null}
            onOpenChange={(aberto) => {
                if (!aberto) {
                    setContato(null)
                    setPostos(0)
                    onClose()
                }
            }}
            title={`Pôr um contato em "${funil?.name ?? ''}"`}
            description="Este funil só recebe gente por aqui. As travas continuam valendo: quem pediu para não receber não recebe, e o funil para se alguém da equipe assumir a conversa."
            submitLabel="Pôr no funil"
            submitDisabled={!contato}
            hideAgain
            onSubmit={por}
            submitting={enviando}
        >
            <FormField label="Contato" className="col-span-2">
                <ContactPicker
                    value={contato}
                    onSelect={setContato}
                    onClear={() => setContato(null)}
                />
            </FormField>

            {postos > 0 && (
                <p className="col-span-2 text-sm text-muted-foreground">
                    {postos} {postos === 1 ? 'contato entrou' : 'contatos entraram'} nesta sessão. O
                    diálogo fica aberto para você pôr o próximo.
                </p>
            )}
        </RecordDialog>
    )
}
