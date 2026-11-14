'use client'

import { InlineField } from '../shared/InlineField'
import { PanelField, PanelSection, RecordPanel, usePanelSave } from '../shared/RecordPanel'
import { TagChip } from '../shared/TagChip'
import { PICKER_RAMP } from '../../lib/palette'
import { cn } from '@venn/ui/utils'

export interface TagPanelItem {
    id: string
    name: string
    color: string
}

/** A ficha de uma etiqueta: nome e cor, gravados ao mexer. */
export function TagPanel({
    item,
    canEdit,
    onClose,
    onPrev,
    onNext,
    onChanged,
    onEditFull,
    onDelete,
}: {
    item: TagPanelItem
    canEdit: boolean
    onClose: () => void
    onPrev?: () => void
    onNext?: () => void
    onChanged: () => void
    /** Abre o diálogo do Novo em modo de edição, com todos os campos. */
    onEditFull?: (id: string) => void
    onDelete: (id: string) => void
}) {
    const { save, saved, local } = usePanelSave<TagPanelItem>(`/api/tags/${item.id}`, onChanged, item)
    const tag = { ...item, ...local }

    return (
        <RecordPanel
            label={`Ficha da etiqueta ${tag.name}`}
            title={<TagChip name={tag.name || 'Sem nome'} color={tag.color} />}
            onClose={onClose}
            onPrev={onPrev}
            onNext={onNext}
            onEditFull={canEdit && onEditFull ? () => onEditFull(item.id) : undefined}
            onDelete={canEdit ? () => onDelete(item.id) : undefined}
        >
            <PanelSection title="Dados" aside={<span className="text-[10px] text-muted-foreground">grava ao sair do campo</span>}>
                <PanelField label="Nome" htmlFor="tag-panel-name" saved={saved === 'name'}>
                    <InlineField
                        id="tag-panel-name"
                        value={tag.name}
                        disabled={!canEdit}
                        onCommit={(name) => { if (name) void save('name', { name }) }}
                        className="h-8 text-sm"
                    />
                </PanelField>
            </PanelSection>

            <PanelSection title="Cor" aside={saved === 'color' ? <span className="text-[10px] font-semibold text-success-subtle-foreground">salvo</span> : null}>
                <div role="radiogroup" aria-label="Cor da etiqueta" className="grid grid-cols-6 gap-2">
                    {PICKER_RAMP.map((color) => {
                        const selected = tag.color === color
                        return (
                            <button
                                key={color}
                                type="button"
                                role="radio"
                                aria-checked={selected}
                                aria-label={`Cor ${color}`}
                                disabled={!canEdit}
                                onClick={() => void save('color', { color })}
                                className={cn(
                                    'aspect-square w-full rounded-md transition-transform',
                                    selected ? 'scale-95 ring-2 ring-ring ring-offset-2 ring-offset-card' : 'hover:scale-95',
                                    !canEdit && 'cursor-default opacity-70 hover:scale-100'
                                )}
                                style={{ backgroundColor: color }}
                            />
                        )
                    })}
                </div>
                <p className="num pt-1 font-mono text-xs text-muted-foreground">{tag.color}</p>
            </PanelSection>
        </RecordPanel>
    )
}
