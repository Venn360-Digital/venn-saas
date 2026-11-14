'use client'

import { Switch } from '@venn/ui/switch'
import { InlineField } from '@/components/shared/InlineField'
import { PanelField, PanelSection, RecordPanel, usePanelSave } from '@/components/shared/RecordPanel'

export interface QuickResponsePanelItem {
    id: string
    command: string
    text: string
    isActive: boolean
}

/** A ficha de uma resposta rápida: comando, texto e se está ativa. */
export function QuickResponsePanel({
    item,
    canEdit,
    onClose,
    onPrev,
    onNext,
    onChanged,
    onEditFull,
    onDelete,
}: {
    item: QuickResponsePanelItem
    canEdit: boolean
    onClose: () => void
    onPrev?: () => void
    onNext?: () => void
    onChanged: () => void
    /** Abre o diálogo do Novo em modo de edição, com todos os campos. */
    onEditFull?: (id: string) => void
    onDelete: (id: string) => void
}) {
    const { save, saved, local } = usePanelSave<QuickResponsePanelItem>(`/api/quick-responses/${item.id}`, onChanged, item)
    const qr = { ...item, ...local }

    return (
        <RecordPanel
            label={`Ficha da resposta ${qr.command}`}
            title={<span className="font-mono text-primary">{qr.command}</span>}
            onClose={onClose}
            onPrev={onPrev}
            onNext={onNext}
            onEditFull={canEdit && onEditFull ? () => onEditFull(item.id) : undefined}
            onDelete={canEdit ? () => onDelete(item.id) : undefined}
        >
            <PanelSection title="Dados" aside={<span className="text-[10px] text-muted-foreground">grava ao sair do campo</span>}>
                <PanelField label="Comando" htmlFor="qr-panel-command" saved={saved === 'command'}>
                    <InlineField
                        id="qr-panel-command"
                        value={qr.command}
                        disabled={!canEdit}
                        placeholder="/orcamento"
                        onCommit={(command) => { if (command) void save('command', { command }) }}
                        className="h-8 font-mono text-sm"
                    />
                </PanelField>
                <PanelField label="Texto" htmlFor="qr-panel-text" saved={saved === 'text'} top>
                    <InlineField
                        id="qr-panel-text"
                        multiline
                        value={qr.text}
                        disabled={!canEdit}
                        placeholder="Olá! Segue o orçamento solicitado…"
                        onCommit={(text) => { if (text) void save('text', { text }) }}
                        className="min-h-28 text-sm"
                    />
                </PanelField>
                <PanelField label="Ativa" htmlFor="qr-panel-active" saved={saved === 'isActive'}>
                    <Switch
                        id="qr-panel-active"
                        checked={qr.isActive}
                        disabled={!canEdit}
                        onCheckedChange={(isActive) => void save('isActive', { isActive })}
                    />
                </PanelField>
            </PanelSection>
        </RecordPanel>
    )
}
