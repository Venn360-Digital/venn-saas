'use client'

import { InlineField } from '@/components/shared/InlineField'
import { PanelField, PanelSection, RecordPanel, usePanelSave } from '@/components/shared/RecordPanel'

export interface DepartmentPanelItem {
    id: string
    name: string
    description: string | null
}

/** A ficha de um departamento: nome e descrição, gravados ao sair. */
export function DepartmentPanel({
    item,
    canEdit,
    onClose,
    onPrev,
    onNext,
    onChanged,
    onEditFull,
    onDelete,
}: {
    item: DepartmentPanelItem
    canEdit: boolean
    onClose: () => void
    onPrev?: () => void
    onNext?: () => void
    onChanged: () => void
    /** Abre o diálogo do Novo em modo de edição, com todos os campos. */
    onEditFull?: (id: string) => void
    onDelete: (id: string) => void
}) {
    const { save, saved, local } = usePanelSave<DepartmentPanelItem>(`/api/departments/${item.id}`, onChanged, item)
    const dept = { ...item, ...local }

    return (
        <RecordPanel
            label={`Ficha do departamento ${dept.name}`}
            title={dept.name || 'Sem nome'}
            onClose={onClose}
            onPrev={onPrev}
            onNext={onNext}
            onEditFull={canEdit && onEditFull ? () => onEditFull(item.id) : undefined}
            onDelete={canEdit ? () => onDelete(item.id) : undefined}
        >
            <PanelSection title="Dados" aside={<span className="text-[10px] text-muted-foreground">grava ao sair do campo</span>}>
                <PanelField label="Nome" htmlFor="dept-panel-name" saved={saved === 'name'}>
                    <InlineField
                        id="dept-panel-name"
                        value={dept.name}
                        disabled={!canEdit}
                        onCommit={(name) => { if (name) void save('name', { name }) }}
                        className="h-8 text-sm"
                    />
                </PanelField>
                <PanelField label="Descrição" htmlFor="dept-panel-description" saved={saved === 'description'} top>
                    <InlineField
                        id="dept-panel-description"
                        multiline
                        value={dept.description ?? ''}
                        disabled={!canEdit}
                        placeholder="Primeiro contato, agendamento e confirmação"
                        onCommit={(description) => void save('description', { description })}
                        className="text-sm"
                    />
                </PanelField>
            </PanelSection>
        </RecordPanel>
    )
}
