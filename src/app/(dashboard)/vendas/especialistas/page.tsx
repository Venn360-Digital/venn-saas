'use client'

import { useCallback, useEffect, useState } from 'react'
import { CalendarClock, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { IndexFrame } from '@/components/shared/IndexFrame'
import { DataTable, type Column } from '@/components/shared/DataTable'
import { RowActionItem, RowActions } from '@/components/shared/RowActions'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { FormField } from '@/components/shared/FormField'
import { RecordDialog } from '@/components/shared/RecordDialog'
import { JanelasDialog } from '@/components/specialists/JanelasDialog'
import { EspecialistaPanel } from '@/components/specialists/EspecialistaPanel'
import { panelNeighbours, usePanelKeys } from '@/components/shared/RecordPanel'
import { usePermissions } from '@/hooks/usePermissions'
import { normalizeSearch } from '@/lib/search'
import { PICKER_RAMP } from '@/lib/palette'

/**
 * Quem executa os procedimentos da clínica.
 *
 * Cadastro irmão de Departamentos e Itens — e **não** a lista de usuários:
 * `Activity.userId` já significa "Responsável", quem da equipe cuida da tarefa.
 * O cirurgião normalmente não faz login; quem marca é a recepção.
 *
 * A grade de horários dele vive atrás do botão Janelas, no mesmo diálogo que a
 * Agenda abre — um editor só, duas portas.
 */

interface Especialista {
    id: string
    name: string
    specialty: string | null
    color: string
    isActive: boolean
    windowCount: number
}

/**
 * A mesma régua de cores dos outros cadastros.
 *
 * `PICKER_RAMP` existe em `palette.ts` para isto, e é o único lugar do `src/`
 * onde cor literal é permitida — o verificador de cores recusa hex solto em
 * qualquer outro arquivo. Reusá-la também faz o especialista combinar com a
 * etiqueta e a fase do funil, em vez de inventar uma sexta paleta.
 */
const CORES = PICKER_RAMP

export default function EspecialistasPage() {
    const { canEdit } = usePermissions()

    const [itens, setItens] = useState<Especialista[]>([])
    const [loading, setLoading] = useState(true)
    const [busca, setBusca] = useState('')

    const [dialogoAberto, setDialogoAberto] = useState(false)
    /** A ficha aberta. Clicar na linha abre ela, não a grade (Tela 01). */
    const [fichaDe, setFichaDe] = useState<string | null>(null)
    const [editandoId, setEditandoId] = useState<string | null>(null)
    const [form, setForm] = useState({ name: '', specialty: '', color: CORES[0], isActive: true })
    const [erro, setErro] = useState<string | null>(null)
    const [salvando, setSalvando] = useState(false)

    const [excluindo, setExcluindo] = useState<Especialista | null>(null)
    const [janelasDe, setJanelasDe] = useState<string | null>(null)

    const carregar = useCallback(async () => {
        setLoading(true)
        try {
            // `all=true`: o cadastro mostra também quem foi desativado, que é
            // onde a pessoa vai para reativar.
            const res = await fetch('/api/specialists?all=true')
            if (res.ok) setItens(await res.json())
        } catch {
            toast.error('Não foi possível carregar os especialistas')
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        void carregar()
    }, [carregar])

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

    const abrirEdicao = (e: Especialista) => {
        setEditandoId(e.id)
        setForm({ name: e.name, specialty: e.specialty ?? '', color: e.color, isActive: e.isActive })
        setErro(null)
        setDialogoAberto(true)
    }

    const salvar = async (denovo: boolean) => {
        const name = form.name.trim()
        if (!name) {
            setErro('Dê um nome ao especialista.')
            return
        }
        setSalvando(true)
        try {
            const res = await fetch(editandoId ? `/api/specialists/${editandoId}` : '/api/specialists', {
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
            toast.success(editandoId ? 'Especialista atualizado' : 'Especialista criado')
            if (denovo && !editandoId) {
                setForm({ name: '', specialty: '', color: CORES[(itens.length + 1) % CORES.length], isActive: true })
            } else {
                setDialogoAberto(false)
            }
            await carregar()
        } finally {
            setSalvando(false)
        }
    }

    const excluir = async () => {
        if (!excluindo) return
        const res = await fetch(`/api/specialists/${excluindo.id}`, { method: 'DELETE' })
        const corpo = await res.json().catch(() => ({}))
        if (!res.ok) {
            toast.error(corpo.error ?? 'Não foi possível excluir')
            return
        }
        // Com agenda feita, a API desativa em vez de excluir — e diz por quê.
        toast.success(corpo.deactivated ? corpo.message : 'Especialista excluído')
        await carregar()
    }

    const ids = visiveis.map((e) => e.id)
    usePanelKeys(fichaDe, ids, setFichaDe)
    const aberto = visiveis.find((e) => e.id === fichaDe) ?? null

    const colunas: Column<Especialista>[] = [
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
                    // Sem janela o especialista não aparece como disponível em
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
                            onChanged={() => void carregar()}
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
                title="Especialistas"
                primary={
                    canEdit ? (
                        <Button size="sm" className="h-8 gap-1.5" onClick={abrirNovo}>
                            <Plus className="size-3.5" /> Novo especialista
                        </Button>
                    ) : null
                }
                search={busca}
                onSearchChange={setBusca}
                searchLabel="Buscar por nome ou especialidade"
            >
                <DataTable
                    frame
                    columns={colunas}
                    rows={visiveis}
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
                title={editandoId ? 'Editar especialista' : 'Novo especialista'}
                description="Quem executa os procedimentos. Os horários dele se definem depois, em Janelas."
                submitLabel={editandoId ? 'Salvar especialista' : 'Criar especialista'}
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
                title="Excluir especialista"
                description={
                    `"${excluindo?.name ?? ''}" sai do cadastro e as janelas dele vão junto. ` +
                    'Se ele já atendeu alguém, será apenas desativado — o histórico da agenda ' +
                    'precisa continuar dizendo quem atendeu.'
                }
                confirmLabel="Excluir"
                destructive
                onConfirm={excluir}
            />

            <JanelasDialog
                open={janelasDe !== null}
                onOpenChange={(a) => !a && setJanelasDe(null)}
                specialistId={janelasDe}
                onSaved={() => void carregar()}
            />
        </>
    )
}
