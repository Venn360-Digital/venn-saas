'use client'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { InlineField } from '@/components/shared/InlineField'
import { PanelField, PanelSection, RecordPanel, usePanelSave } from '@/components/shared/RecordPanel'

export interface ProductPanelItem {
    id: string
    name: string
    description: string | null
    sku: string | null
    category: string
    price: number | null
    group: string | null
}

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

/** "180,00" ↔ 180: o que a pessoa digita e o que a API guarda. */
function priceText(price: number | null) {
    return price == null ? '' : price.toFixed(2).replace('.', ',')
}
function parsePrice(text: string): number | null {
    if (!text) return null
    const n = parseFloat(text.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'))
    return Number.isFinite(n) ? n : null
}

/** A ficha de um item do catálogo: tudo o que o diálogo tinha, gravado campo a campo. */
export function ProductPanel({
    item,
    categories,
    canEdit,
    onClose,
    onPrev,
    onNext,
    onChanged,
    onDelete,
}: {
    item: ProductPanelItem
    categories: { id: string; label: string }[]
    canEdit: boolean
    onClose: () => void
    onPrev?: () => void
    onNext?: () => void
    onChanged: () => void
    onDelete: (id: string) => void
}) {
    const { save, saved, local } = usePanelSave<ProductPanelItem>(`/api/products/${item.id}`, onChanged)
    const p = { ...item, ...local }

    return (
        <RecordPanel
            label={`Ficha de ${p.name}`}
            title={
                <span className="flex min-w-0 items-baseline gap-2">
                    <span className="truncate">{p.name || 'Sem nome'}</span>
                    {p.price != null ? <span className="num shrink-0 text-xs font-medium text-muted-foreground">{BRL.format(p.price)}</span> : null}
                </span>
            }
            onClose={onClose}
            onPrev={onPrev}
            onNext={onNext}
            onDelete={canEdit ? () => onDelete(item.id) : undefined}
        >
            <PanelSection title="Dados" aside={<span className="text-[10px] text-muted-foreground">grava ao sair do campo</span>}>
                <PanelField label="Nome" htmlFor="prod-panel-name" saved={saved === 'name'}>
                    <InlineField id="prod-panel-name" value={p.name} disabled={!canEdit} onCommit={(name) => { if (name) void save('name', { name }) }} className="h-8 text-sm" />
                </PanelField>
                <PanelField label="Categoria" saved={saved === 'category'}>
                    <Select value={p.category} disabled={!canEdit} onValueChange={(category) => void save('category', { category })}>
                        <SelectTrigger size="sm" className="w-full" aria-label="Categoria">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {categories.map((c) => (
                                <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </PanelField>
                <PanelField label="Preço" htmlFor="prod-panel-price" saved={saved === 'price'}>
                    <InlineField
                        id="prod-panel-price"
                        value={priceText(p.price)}
                        disabled={!canEdit}
                        placeholder="180,00"
                        onCommit={(text) => void save('price', { price: parsePrice(text) })}
                        className="num h-8 text-sm"
                    />
                </PanelField>
                <PanelField label="SKU" htmlFor="prod-panel-sku" saved={saved === 'sku'}>
                    <InlineField id="prod-panel-sku" value={p.sku ?? ''} disabled={!canEdit} placeholder="PROF-001" onCommit={(sku) => void save('sku', { sku: sku || null })} className="h-8 font-mono text-sm" />
                </PanelField>
                <PanelField label="Grupo" htmlFor="prod-panel-group" saved={saved === 'group'}>
                    <InlineField id="prod-panel-group" value={p.group ?? ''} disabled={!canEdit} placeholder="Preventivo" onCommit={(group) => void save('group', { group: group || null })} className="h-8 text-sm" />
                </PanelField>
                <PanelField label="Descrição" htmlFor="prod-panel-description" saved={saved === 'description'} top>
                    <InlineField
                        id="prod-panel-description"
                        multiline
                        value={p.description ?? ''}
                        disabled={!canEdit}
                        placeholder="O que está incluído, duração média, observações"
                        onCommit={(description) => void save('description', { description: description || null })}
                        className="text-sm"
                    />
                </PanelField>
            </PanelSection>
        </RecordPanel>
    )
}
