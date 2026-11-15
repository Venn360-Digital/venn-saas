'use client'

import { useCallback, useState } from 'react'
import { CalendarClock, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@venn/ui/button'
import { Input } from '@venn/ui/input'
import { Switch } from '@venn/ui/switch'
import { Badge } from '@venn/ui/badge'
import { IndexFrame } from '@venn/core/components/shared/IndexFrame'
import { DataTable, type Column } from '@venn/core/components/shared/DataTable'
import { RowActionItem, RowActions } from '@venn/core/components/shared/RowActions'
import { ConfirmDialog } from '@venn/core/components/shared/ConfirmDialog'
import { BulkBar, deleteEach } from '@venn/core/components/shared/BulkBar'
import { Pagination } from '@venn/core/components/shared/Pagination'
import { FormField } from '@venn/core/components/shared/FormField'
import { RecordDialog } from '@venn/core/components/shared/RecordDialog'
import { JanelasDialog } from '@venn/core/components/professionals/JanelasDialog'
import { EspecialistaPanel } from '@venn/core/components/professionals/EspecialistaPanel'
import { useVocab } from '@venn/core/hooks/useVocab'
import { comArtigo } from '@venn/core/lib/concordancia'
import { panelNeighbours, usePanelKeys } from '@venn/core/components/shared/RecordPanel'
import { usePermissions } from '@venn/core/hooks/usePermissions'
import { normalizeSearch } from '@venn/core/lib/search'
import { PICKER_RAMP } from '@venn/core/lib/palette'

import { useIndiceServidor } from '@venn/core/hooks/useIndiceServidor'
import { INCLUIR_INATIVOS, type DadosIniciais, type Profissional } from './dados'

/**
 * Quem executa os servicos da clínica.
 *
 * Cadastro irmão de Departamentos e Itens — e **não** a lista de usuários:
 * `Activity.userId` já significa "Responsável", quem da equipe cuida da tarefa.
 * O cirurgião normalmente não faz login; quem marca é a recepção.
 *
 * A grade de horários dele vive atrás do botão Janelas, no mesmo diálogo que a
 * Agenda abre — um editor só, duas portas.
 */

/**
 * A mesma régua de cores dos outros cadastros.
 *
 * `PICKER_RAMP` existe em `palette.ts` para isto, e é o único lugar do `src/`
 * onde cor literal é permitida — o verificador de cores recusa hex solto em
 * qualquer outro arquivo. Reusá-la também faz o profissional combinar com a
 * etiqueta e a fase do funil, em vez de inventar uma sexta paleta.
 */
const CORES = PICKER_RAMP

export function EspecialistasClient({ inicial }: { inicial: DadosIniciais }) {
    // As palavras do nicho vêm da unidade; `comArtigo` monta o determinante
    // pelo gênero declarado na marca. Frase com particípio ("Profissional
    // atualizado") foi reescrita em forma neutra.
    const v = useVocab()

    const { canEdit } = usePermissions()

    const [busca, setBusca] = useState('')

    /**
     * A releitura da lista inteira — o `all` é o único parâmetro que a rota lê.
     *
     * Devolve o **mesmo envelope** das telas paginadas porque o hook é o mesmo:
     * a rota responde um array cru, e `total`/`totalPages` são preenchidos aqui
     * exatamente como `listaInteira` faz do outro lado. Quem conta de verdade é
     * a paginação de cliente, mais abaixo, a partir do que a busca deixou
     * visível — por isso nem `total` nem `totalPages` são lidos do hook.
     *
     * Erro devolve `null`: é assim que o hook sabe não mexer no que está na
     * tela. Sobrescrever com lista vazia apagaria linhas boas por causa de um
     * 500.
     */
    const buscar = useCallback(async () => {
        const res = await fetch(`/api/professionals?all=${INCLUIR_INATIVOS}`)
        if (!res.ok) {
            toast.error(`Não foi possível carregar ${comArtigo(v, 'profissionais')}`)
            return null
        }
        const itens = (await res.json()) as Profissional[]
        return { itens, total: itens.length, totalPages: 1 }
    }, [])

    /**
     * Semear com o que o servidor mandou, **não buscar na montagem** e reler
     * quando o recorte muda é disciplina igual em todo índice — e por isso mora
     * em `useIndiceServidor`, não copiada aqui. O guarda que impede a busca da
     * montagem era a peça mais fácil de errar do padrão: comparar o recorte (e
     * não contar visitas num `useRef`, que o StrictMode gasta na primeira das
     * duas execuções) é o que o hook já faz certo uma vez só.
     */
    const {
        itens,
        carregando: loading,
        recarregar,
    } = useIndiceServidor<Profissional>({
        inicial,
        /**
         * O recorte desta tela é só o `all`: não há paginação nem busca no
         * servidor, o filtro de texto e as páginas recortam o que já está em
         * memória. Na primeira renderização a chave descreve o **mesmo** recorte
         * que o servidor serviu — é esse casamento que faz a montagem não
         * buscar. Hoje ela nunca muda; está escrita assim para que um futuro
         * seletor de inativos entre pela chave e volte a buscar sozinho, em vez
         * de precisar de um segundo mecanismo.
         */
        recorte: `all=${INCLUIR_INATIVOS}`,
        buscar,
    })

    const [dialogoAberto, setDialogoAberto] = useState(false)
    /** A ficha aberta. Clicar na linha abre ela, não a grade (Tela 01). */
    const [fichaDe, setFichaDe] = useState<string | null>(null)
    /** As linhas marcadas, para a `BulkBar` do rodapé. */
    const [marcados, setMarcados] = useState<string[]>([])
    const [excluindoLote, setExcluindoLote] = useState(false)
    /**
     * A paginação é do cliente: a API devolve a lista inteira.
     *
     * O rodapé existe de qualquer forma — é o que a Tela 01 manda, e é onde
     * mora a contagem ("1–7 de 7"), que o cabeçalho não carrega.
     */
    const [pagina, setPagina] = useState(1)
    const [porPagina, setPorPagina] = useState(20)
    const [editandoId, setEditandoId] = useState<string | null>(null)
    const [form, setForm] = useState({ name: '', specialty: '', color: CORES[0], isActive: true })
    const [erro, setErro] = useState<string | null>(null)
    const [salvando, setSalvando] = useState(false)

    const [excluindo, setExcluindo] = useState<Profissional | null>(null)
    const [janelasDe, setJanelasDe] = useState<string | null>(null)

    const visiveis = busca.trim()
        ? itens.filter((e) =>
              normalizeSearch(`${e.name} ${e.specialty ?? ''}`).includes(normalizeSearch(busca))
          )
        : itens

    const abrirNovo = () => {
        setEditandoId(null)
        setForm({ name: '', specialty: '', color: CORES[itens.length % CORES.length], isActive: true })
        setErro(null)
        setDialogoAberto(true)
    }

    const abrirEdicao = (e: Profissional) => {
        setEditandoId(e.id)
        setForm({ name: e.name, specialty: e.specialty ?? '', color: e.color, isActive: e.isActive })
        setErro(null)
        setDialogoAberto(true)
    }

    const salvar = async (denovo: boolean) => {
        const name = form.name.trim()
        if (!name) {
            setErro(`Dê um nome ${comArtigo(v, 'profissional', 'a')}.`)
            return
        }
        setSalvando(true)
        try {
            const res = await fetch(editandoId ? `/api/professionals/${editandoId}` : '/api/professionals', {
                method: editandoId ? 'PATCH' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name,
                    specialty: form.specialty.trim() || null,
                    color: form.color,
                    isActive: form.isActive,
                }),
            })
            if (!res.ok) {
                const corpo = await res.json().catch(() => ({}))
                setErro(corpo.error ?? 'Não foi possível salvar')
                return
            }
            toast.success(editandoId ? 'Cadastro atualizado' : 'Cadastro criado')
            if (denovo && !editandoId) {
                setForm({ name: '', specialty: '', color: CORES[(itens.length + 1) % CORES.length], isActive: true })
            } else {
                setDialogoAberto(false)
            }
            await recarregar()
        } finally {
            setSalvando(false)
        }
    }

    const excluir = async () => {
        if (!excluindo) return
        const res = await fetch(`/api/professionals/${excluindo.id}`, { method: 'DELETE' })
        const corpo = await res.json().catch(() => ({}))
        if (!res.ok) {
            toast.error(corpo.error ?? 'Não foi possível excluir')
            return
        }
        // Com agenda feita, a API desativa em vez de excluir — e diz por quê.
        toast.success(corpo.deactivated ? corpo.message : 'Cadastro excluído')
        await recarregar()
    }

    const totalPaginas = Math.max(1, Math.ceil(visiveis.length / porPagina))
    const paginaAtual = Math.min(pagina, totalPaginas)
    const naPagina = visiveis.slice((paginaAtual - 1) * porPagina, paginaAtual * porPagina)

    /**
     * As setas da ficha andam pelo que está **na página**.
     *
     * Navegar para um registro que a tabela não mostra deixaria a ficha aberta
     * sobre uma lista que não a contém — e a seta seguinte não teria para onde
     * voltar.
     */
    const ids = naPagina.map((e) => e.id)
    usePanelKeys(fichaDe, ids, setFichaDe)
    const aberto = naPagina.find((e) => e.id === fichaDe) ?? null

    const excluirMarcados = async () => {
        const ok = await deleteEach(marcados, (id) => `/api/professionals/${id}`)
        if (ok > 0) {
            toast.success(`${ok} registro${ok === 1 ? '' : 's'} excluído${ok === 1 ? '' : 's'}`)
        }
        if (ok < marcados.length) {
            toast.error(`${marcados.length - ok} não puderam ser excluídos`)
        }
        setMarcados([])
        await recarregar()
    }

    const colunas: Column<Profissional>[] = [
        {
            id: 'name',
            header: 'Nome',
            sortable: true,
            sortValue: (e) => e.name,
            cell: (e) => (
                <span className="flex items-center gap-2">
                    <span
                        aria-hidden="true"
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: e.color }}
                    />
                    <span className="font-medium">{e.name}</span>
                    {!e.isActive ? <Badge variant="outline">Inativo</Badge> : null}
                </span>
            ),
        },
        {
            id: 'specialty',
            header: 'Especialidade',
            sortable: true,
            sortValue: (e) => e.specialty ?? '',
            hideBelow: 'sm',
            cell: (e) => <span className="text-muted-foreground">{e.specialty || '—'}</span>,
        },
        {
            id: 'windows',
            header: 'Janelas',
            sortable: true,
            sortValue: (e) => e.windowCount,
            cell: (e) =>
                e.windowCount > 0 ? (
                    <span className="num text-muted-foreground">{e.windowCount}</span>
                ) : (
                    // Sem janela o profissional não aparece como disponível em
                    // lugar nenhum — vale dizer, não deixar em branco.
                    <span className="text-warning-subtle-foreground">sem horário</span>
                ),
        },
    ]

    return (
        <>
            <IndexFrame
                aside={
                    aberto ? (
                        <EspecialistaPanel
                            key={aberto.id}
                            item={aberto}
                            canEdit={canEdit}
                            onClose={() => setFichaDe(null)}
                            {...panelNeighbours(fichaDe, ids, setFichaDe)}
                            onChanged={() => void recarregar()}
                            onEditFull={(id) => {
                                const x = itens.find((i) => i.id === id)
                                if (x) abrirEdicao(x)
                            }}
                            onDelete={(id) => {
                                const x = itens.find((i) => i.id === id)
                                if (x) setExcluindo(x)
                            }}
                            onJanelas={(id) => setJanelasDe(id)}
                        />
                    ) : null
                }
                title={v.Profissionais}
                primary={
                    canEdit ? (
                        <Button size="sm" className="h-8 gap-1.5" onClick={abrirNovo}>
                            <Plus className="size-3.5" /> Adicionar {v.profissional}
                        </Button>
                    ) : null
                }
                search={busca}
                /* Digitar troca o conjunto, então a página volta para a
                   primeira — no próprio evento, não num efeito que observa a
                   busca: o `set` em efeito encadeia uma renderização a mais
                   para chegar ao mesmo lugar (e é o que o `react-hooks`
                   cobrava). */
                onSearchChange={(valor) => {
                    setBusca(valor)
                    setPagina(1)
                }}
                searchLabel="Buscar por nome ou especialidade"
            >
                <DataTable
                    frame
                    selectable={canEdit}
                    selected={marcados}
                    onSelectedChange={setMarcados}
                    bulkActions={(ids) => (
                        <BulkBar
                            count={ids.length}
                            noun={[v.profissional, v.profissionais]}
                            onDelete={() => setExcluindoLote(true)}
                            onClear={() => setMarcados([])}
                        />
                    )}
                    footer={
                        <Pagination
                            page={paginaAtual}
                            totalPages={totalPaginas}
                            total={visiveis.length}
                            limit={porPagina}
                            onPageChange={setPagina}
                            onLimitChange={(limite) => {
                                setPorPagina(limite)
                                setPagina(1)
                            }}
                        />
                    }
                    columns={colunas}
                    rows={naPagina}
                    getRowId={(e) => e.id}
                    loading={loading}
                    onRowClick={(e) => setFichaDe(e.id)}
                    rowActions={
                        canEdit
                            ? (e) => (
                                  <RowActions label={`Ações de ${e.name}`}>
                                      {/* "Abrir ficha" e não "Editar": o lápis
                                          mora no rodapé da ficha (Tela 01). */}
                                      <RowActionItem icon={Pencil} onClick={() => setFichaDe(e.id)}>
                                          Abrir ficha
                                      </RowActionItem>
                                      <RowActionItem icon={CalendarClock} onClick={() => setJanelasDe(e.id)}>
                                          Janelas de atendimento
                                      </RowActionItem>
                                      <RowActionItem icon={Trash2} destructive onClick={() => setExcluindo(e)}>
                                          Excluir
                                      </RowActionItem>
                                  </RowActions>
                              )
                            : undefined
                    }
                />
            </IndexFrame>

            <RecordDialog
                open={dialogoAberto}
                onOpenChange={setDialogoAberto}
                title={editandoId ? `Editar ${v.profissional}` : `Adicionar ${v.profissional}`}
                description={`Quem executa ${comArtigo(v, 'servicos')}. Os horários se definem depois, em Janelas.`}
                submitLabel={editandoId ? 'Salvar' : `Criar ${v.profissional}`}
                hideAgain={Boolean(editandoId)}
                submitting={salvando}
                onSubmit={salvar}
            >
                <div className="flex flex-col gap-4">
                    <FormField label="Nome" required error={erro ?? undefined}>
                        <Input
                            value={form.name}
                            onChange={(e) => setForm({ ...form, name: e.target.value })}
                            placeholder="Dra. Helena Ribeiro"
                            autoFocus
                        />
                    </FormField>

                    <FormField label="Especialidade">
                        <Input
                            value={form.specialty}
                            onChange={(e) => setForm({ ...form, specialty: e.target.value })}
                            placeholder="Implantodontia"
                        />
                    </FormField>

                    <FormField label="Cor na agenda">
                        <div className="flex gap-2">
                            {CORES.map((c) => (
                                <button
                                    key={c}
                                    type="button"
                                    aria-label={`Usar a cor ${c}`}
                                    aria-pressed={form.color === c}
                                    onClick={() => setForm({ ...form, color: c })}
                                    className="size-7 rounded-full ring-offset-2 ring-offset-background transition-all data-[ativo=true]:ring-2 data-[ativo=true]:ring-foreground"
                                    data-ativo={form.color === c}
                                    style={{ backgroundColor: c }}
                                />
                            ))}
                        </div>
                    </FormField>

                    {editandoId ? (
                        <FormField label="Ativo">
                            <div className="flex items-center gap-2">
                                <Switch
                                    checked={form.isActive}
                                    onCheckedChange={(v) => setForm({ ...form, isActive: v })}
                                />
                                <span className="text-xs text-muted-foreground">
                                    Inativo some dos seletores de agenda, mas continua explicando
                                    os compromissos que ele já atendeu.
                                </span>
                            </div>
                        </FormField>
                    ) : null}
                </div>
            </RecordDialog>

            <ConfirmDialog
                open={excluindo !== null}
                onOpenChange={(a) => !a && setExcluindo(null)}
                title={`Excluir ${v.profissional}`}
                description={
                    `"${excluindo?.name ?? ''}" sai do cadastro e as janelas dele vão junto. ` +
                    'Se ele já atendeu alguém, será apenas desativado — o histórico da agenda ' +
                    'precisa continuar dizendo quem atendeu.'
                }
                confirmLabel="Excluir"
                destructive
                onConfirm={excluir}
            />

            {/* O alerta do lote diz o que se perde, como o individual —
                "tem certeza?" não informa nada (Tela 01, §6). */}
            <ConfirmDialog
                open={excluindoLote}
                onOpenChange={(aberto) => !aberto && setExcluindoLote(false)}
                title={`Excluir ${marcados.length} ${marcados.length === 1 ? v.profissional : v.profissionais}`}
                description="Quem tiver compromisso na agenda é desativado em vez de excluído — ele continua explicando o que já atendeu."
                confirmLabel="Excluir"
                destructive
                onConfirm={() => void excluirMarcados()}
            />

            <JanelasDialog
                open={janelasDe !== null}
                onOpenChange={(a) => !a && setJanelasDe(null)}
                professionalId={janelasDe}
                onSaved={() => void recarregar()}
            />
        </>
    )
}
