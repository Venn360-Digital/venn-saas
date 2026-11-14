'use client'

import { CalendarClock } from 'lucide-react'

import { InlineField } from '@/components/shared/InlineField'
import { PanelField, PanelSection, RecordPanel, usePanelSave } from '@/components/shared/RecordPanel'
import { Switch } from '@venn/ui/switch'
import { PICKER_RAMP } from '@/lib/palette'
import { Tooltip, TooltipContent, TooltipTrigger } from '@venn/ui/tooltip'

export interface EspecialistaPanelItem {
    id: string
    name: string
    specialty: string | null
    color: string
    isActive: boolean
    windowCount: number
}

/**
 * A ficha do especialista — a terceira coluna que esta tela não tinha.
 *
 * A tela de especialistas nasceu com índice e diálogo, e pulou a ficha: clicar
 * na linha abria direto a grade de horários, que é outra coisa. O Andre
 * apontou em 2026-10-20, e a Tela 01 (DESIGN.md §5) é explícita — clicar na
 * linha abre a ficha, o diálogo fica para o Novo e para o lápis.
 *
 * As cores são dado do usuário, gravado no banco, e por isso entram por
 * `style` e não por classe — a mesma exceção que `TagChip` tem. A rampa vem de
 * `lib/palette.ts`, que é o único lugar do projeto autorizado a escrever hex
 * que vai para o banco (e o que o `lint:colors` cobra).
 */
const CORES = PICKER_RAMP

export function EspecialistaPanel({
    item,
    canEdit,
    onClose,
    onPrev,
    onNext,
    onChanged,
    onEditFull,
    onDelete,
    onJanelas,
}: {
    item: EspecialistaPanelItem
    canEdit: boolean
    onClose: () => void
    onPrev?: () => void
    onNext?: () => void
    onChanged: () => void
    onEditFull?: (id: string) => void
    onDelete: (id: string) => void
    /** A grade de horários dele, que é uma tela à parte. */
    onJanelas: (id: string) => void
}) {
    const { save, saved, local } = usePanelSave<EspecialistaPanelItem>(
        `/api/professionals/${item.id}`,
        onChanged,
        item
    )
    const e = { ...item, ...local }

    return (
        <RecordPanel
            label={`Ficha do especialista ${e.name}`}
            title={e.name || 'Sem nome'}
            avatar={
                <span
                    aria-hidden="true"
                    className="size-3 shrink-0 rounded-full"
                    style={{ backgroundColor: e.color }}
                />
            }
            badge={
                !e.isActive ? (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                        Inativo
                    </span>
                ) : undefined
            }
            onClose={onClose}
            onPrev={onPrev}
            onNext={onNext}
            onEditFull={canEdit && onEditFull ? () => onEditFull(item.id) : undefined}
            onDelete={canEdit ? () => onDelete(item.id) : undefined}
            /* A grade mora no rodapé, junto do lápis e da lixeira: é ação da
               ficha, não um terceiro botão com texto no meio dos campos. */
            footerExtra={
                <Tooltip>
                    <TooltipTrigger asChild>
                        <button
                            type="button"
                            aria-label="Janelas de atendimento"
                            onClick={() => onJanelas(item.id)}
                            className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        >
                            <CalendarClock className="size-4" />
                        </button>
                    </TooltipTrigger>
                    <TooltipContent>Janelas de atendimento</TooltipContent>
                </Tooltip>
            }
        >
            <PanelSection
                title="Dados"
                aside={
                    <span className="text-[10px] text-muted-foreground">grava ao sair do campo</span>
                }
            >
                <PanelField label="Nome" htmlFor="esp-panel-nome" saved={saved === 'name'}>
                    <InlineField
                        id="esp-panel-nome"
                        value={e.name}
                        disabled={!canEdit}
                        onCommit={(name) => {
                            if (name) void save('name', { name })
                        }}
                        className="h-8 text-sm"
                    />
                </PanelField>

                <PanelField
                    label="Especialidade"
                    htmlFor="esp-panel-especialidade"
                    saved={saved === 'specialty'}
                >
                    <InlineField
                        id="esp-panel-especialidade"
                        value={e.specialty ?? ''}
                        disabled={!canEdit}
                        placeholder="Adicionar"
                        onCommit={(specialty) =>
                            void save('specialty', { specialty: specialty || null })
                        }
                        className="h-8 text-sm"
                    />
                </PanelField>

                <PanelField label="Cor na agenda" saved={saved === 'color'}>
                    <div className="flex flex-wrap gap-1.5 px-2 py-1">
                        {CORES.map((c) => (
                            <button
                                key={c}
                                type="button"
                                disabled={!canEdit}
                                aria-label={`Usar a cor ${c}`}
                                aria-pressed={e.color === c}
                                onClick={() => void save('color', { color: c })}
                                data-ativo={e.color === c}
                                className="size-5 rounded-full ring-offset-2 ring-offset-background transition-all disabled:opacity-60 data-[ativo=true]:ring-2 data-[ativo=true]:ring-foreground"
                                style={{ backgroundColor: c }}
                            />
                        ))}
                    </div>
                </PanelField>

                <PanelField label="Ativo" saved={saved === 'isActive'}>
                    <div className="flex items-center gap-2 px-2 py-1">
                        <Switch
                            checked={e.isActive}
                            disabled={!canEdit}
                            onCheckedChange={(v) => void save('isActive', { isActive: v })}
                            aria-label="Especialista ativo"
                        />
                        <span className="text-[11px] text-muted-foreground">
                            {e.isActive
                                ? 'Aparece nos seletores da agenda.'
                                : 'Some dos seletores, e continua explicando o que já atendeu.'}
                        </span>
                    </div>
                </PanelField>
            </PanelSection>

            <PanelSection title="Agenda">
                <PanelField label="Janelas">
                    {/* Sem janela ele não aparece como disponível em lugar
                        nenhum — dizer isso vale mais que mostrar "0". */}
                    <p className="px-2 text-sm">
                        {e.windowCount > 0 ? (
                            <>
                                <span className="num font-medium">{e.windowCount}</span>{' '}
                                <span className="text-muted-foreground">
                                    faixa{e.windowCount === 1 ? '' : 's'} de horário
                                </span>
                            </>
                        ) : (
                            <span className="text-warning-subtle-foreground">
                                Sem horário — ele não aparece como disponível.
                            </span>
                        )}
                    </p>
                </PanelField>
            </PanelSection>
        </RecordPanel>
    )
}
