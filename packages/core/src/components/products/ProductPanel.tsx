'use client'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@venn/ui/select'
import { InlineField } from '../shared/InlineField'
import { PanelField, PanelSection, RecordPanel, usePanelSave } from '../shared/RecordPanel'
import { isSchedulable } from '../../lib/product-categories'
import { useMoeda } from '../../hooks/useMoeda'
import { precoDoTexto, textoDePreco } from '../../lib/moedas'

export interface ProductPanelItem {
    id: string
    name: string
    description: string | null
    sku: string | null
    category: string
    /** Minutos que ocupa na agenda. Nulo em produto, que não ocupa cadeira. */
    durationMinutes: number | null
    price: number | null
    group: string | null
}

/**
 * A ida e a volta do preço digitado moram em `lib/moedas` desde que a moeda
 * passou a ser da conta.
 *
 * O par antigo era de real escrito à mão: mostrava `180,00` e, na volta,
 * descartava **todo** ponto como separador de milhar. Em dólar a tela passa a
 * escrever `$180.00`, quem copia o formato digita `180.00`, e o ponto
 * descartado transformava o preço em 18000 — cem vezes maior, gravado sem
 * reclamação nenhuma.
 */

/** A ficha de um item do catálogo: tudo o que o diálogo tinha, gravado campo a campo. */
export function ProductPanel({
    item,
    categories,
    canEdit,
    onClose,
    onPrev,
    onNext,
    onChanged,
    onEditFull,
    onDelete,
}: {
    item: ProductPanelItem
    categories: { id: string; label: string }[]
    canEdit: boolean
    onClose: () => void
    onPrev?: () => void
    onNext?: () => void
    onChanged: () => void
    /** Abre o diálogo do Novo em modo de edição, com todos os campos. */
    onEditFull?: (id: string) => void
    onDelete: (id: string) => void
}) {
    const { save, saved, local } = usePanelSave<ProductPanelItem>(`/api/products/${item.id}`, onChanged, item)
    const moeda = useMoeda()
    const p = { ...item, ...local }

    return (
        <RecordPanel
            label={`Ficha de ${p.name}`}
            title={
                <span className="flex min-w-0 items-baseline gap-2">
                    <span className="truncate">{p.name || 'Sem nome'}</span>
                    {p.price != null ? <span className="num shrink-0 text-xs font-medium text-muted-foreground">{moeda.formatar(p.price)}</span> : null}
                </span>
            }
            onClose={onClose}
            onPrev={onPrev}
            onNext={onNext}
            onEditFull={canEdit && onEditFull ? () => onEditFull(item.id) : undefined}
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
                {/* Logo abaixo da categoria, porque é ela que decide se este
                    campo existe — e some em produto, onde a resposta certa é
                    "não se aplica". */}
                {isSchedulable(p.category) ? (
                    <PanelField label="Duração" htmlFor="prod-panel-duration" saved={saved === 'durationMinutes'}>
                        <InlineField
                            id="prod-panel-duration"
                            value={p.durationMinutes != null ? String(p.durationMinutes) : ''}
                            disabled={!canEdit}
                            placeholder="30"
                            onCommit={(texto) => {
                                const minutos = Number(texto.replace(/\D/g, ''))
                                void save('durationMinutes', { durationMinutes: minutos || null })
                            }}
                            className="num h-8 text-sm"
                        />
                    </PanelField>
                ) : null}
                {/* O símbolo no rótulo, não no campo: a pessoa digita só o
                    número, e sem ele não haveria nada na ficha dizendo em que
                    moeda este preço está. O exemplo do placeholder segue a
                    pontuação da moeda — pedir "180,00" numa conta em dólar é
                    ensinar o formato errado. */}
                <PanelField
                    label={`Preço (${moeda.simbolo})`}
                    htmlFor="prod-panel-price"
                    saved={saved === 'price'}
                >
                    <InlineField
                        id="prod-panel-price"
                        value={textoDePreco(p.price, moeda.codigo)}
                        disabled={!canEdit}
                        placeholder={textoDePreco(180, moeda.codigo)}
                        onCommit={(text) =>
                            void save('price', { price: precoDoTexto(text, moeda.codigo) })
                        }
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
