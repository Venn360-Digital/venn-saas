'use client'

import { useState, useEffect } from 'react'
import { Plus, MoreHorizontal, User, DollarSign, GripVertical } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import {
    DndContext,
    DragEndEvent,
    DragOverlay,
    DragStartEvent,
    closestCenter,
    PointerSensor,
    useSensor,
    useSensors,
} from '@dnd-kit/core'
import {
    SortableContext,
    useSortable,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

interface Contact {
    id: string
    name: string | null
    phone: string | null
    avatar: string | null
}

interface Deal {
    id: string
    title: string
    value: number | null
    stageId: string
    contact: Contact | null
    notes: string | null
}

interface Stage {
    id: string
    name: string
    color: string
    order: number
    deals: Deal[]
}

function DealCard({ deal, isDragging }: { deal: Deal; isDragging?: boolean }) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
    } = useSortable({ id: deal.id })

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
    }

    return (
        <div
            ref={setNodeRef}
            style={style}
            className="rounded-lg border border-gray-700 bg-[#0A0E27] p-3 cursor-grab active:cursor-grabbing"
            {...attributes}
            {...listeners}
        >
            <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                    <h4 className="font-medium text-white truncate">{deal.title}</h4>
                    {deal.contact?.name && (
                        <div className="flex items-center gap-1 mt-1 text-sm text-gray-400">
                            <User className="h-3 w-3" />
                            <span className="truncate">{deal.contact.name}</span>
                        </div>
                    )}
                    {deal.value && (
                        <div className="flex items-center gap-1 mt-1 text-sm text-green-400">
                            <DollarSign className="h-3 w-3" />
                            <span>R$ {deal.value.toLocaleString('pt-BR')}</span>
                        </div>
                    )}
                </div>
                <GripVertical className="h-4 w-4 text-gray-500 flex-shrink-0" />
            </div>
        </div>
    )
}

function StageColumn({ stage, onAddDeal }: { stage: Stage; onAddDeal: (stageId: string) => void }) {
    return (
        <div className="flex-shrink-0 w-72">
            <div
                className="rounded-t-lg px-4 py-2 flex items-center justify-between"
                style={{ backgroundColor: stage.color }}
            >
                <h3 className="font-semibold text-white">{stage.name}</h3>
                <span className="text-xs text-white/80 bg-white/20 px-2 py-0.5 rounded-full">
                    {stage.deals.length}
                </span>
            </div>
            <div className="bg-[#1A1F3D] rounded-b-lg p-2 min-h-[400px] space-y-2">
                <SortableContext
                    items={stage.deals.map(d => d.id)}
                    strategy={verticalListSortingStrategy}
                >
                    {stage.deals.map((deal) => (
                        <DealCard key={deal.id} deal={deal} />
                    ))}
                </SortableContext>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onAddDeal(stage.id)}
                    className="w-full justify-start text-gray-400 hover:text-white hover:bg-gray-800"
                >
                    <Plus className="h-4 w-4 mr-2" />
                    Adicionar negócio
                </Button>
            </div>
        </div>
    )
}

export default function NegociosPage() {
    const [stages, setStages] = useState<Stage[]>([])
    const [loading, setLoading] = useState(true)
    const [isDialogOpen, setIsDialogOpen] = useState(false)
    const [selectedStageId, setSelectedStageId] = useState<string>('')
    const [activeDeal, setActiveDeal] = useState<Deal | null>(null)

    // Form state
    const [newDeal, setNewDeal] = useState({
        title: '',
        value: '',
        notes: '',
    })

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 8,
            },
        })
    )

    useEffect(() => {
        loadPipeline()
    }, [])

    const loadPipeline = async () => {
        try {
            const res = await fetch('/api/pipelines')
            if (res.ok) {
                const data = await res.json()
                setStages(data)
            }
        } catch (error) {
            console.error('Error loading pipeline:', error)
        } finally {
            setLoading(false)
        }
    }

    const createDefaultPipeline = async () => {
        try {
            const res = await fetch('/api/pipelines/seed', { method: 'POST' })
            if (res.ok) {
                toast.success('Funil criado com sucesso!')
                loadPipeline()
            } else {
                toast.error('Erro ao criar funil')
            }
        } catch (error) {
            toast.error('Erro ao criar funil')
        }
    }

    const handleAddDeal = (stageId: string) => {
        setSelectedStageId(stageId)
        setNewDeal({ title: '', value: '', notes: '' })
        setIsDialogOpen(true)
    }

    const handleSaveDeal = async () => {
        if (!newDeal.title.trim()) {
            toast.error('Título é obrigatório')
            return
        }

        try {
            const res = await fetch('/api/deals', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: newDeal.title,
                    value: newDeal.value ? parseFloat(newDeal.value) : undefined,
                    notes: newDeal.notes || undefined,
                    stageId: selectedStageId,
                }),
            })

            if (res.ok) {
                toast.success('Negócio criado!')
                setIsDialogOpen(false)
                loadPipeline()
            } else {
                toast.error('Erro ao criar negócio')
            }
        } catch (error) {
            toast.error('Erro ao criar negócio')
        }
    }

    const handleDragStart = (event: DragStartEvent) => {
        const dealId = event.active.id as string
        for (const stage of stages) {
            const deal = stage.deals.find(d => d.id === dealId)
            if (deal) {
                setActiveDeal(deal)
                break
            }
        }
    }

    const handleDragEnd = async (event: DragEndEvent) => {
        const { active, over } = event
        setActiveDeal(null)

        if (!over) return

        const dealId = active.id as string
        let targetStageId: string | null = null

        // Find target stage
        for (const stage of stages) {
            if (stage.deals.some(d => d.id === over.id) || stage.id === over.id) {
                targetStageId = stage.id
                break
            }
        }

        if (!targetStageId) return

        // Find current stage
        let currentStageId: string | null = null
        for (const stage of stages) {
            if (stage.deals.some(d => d.id === dealId)) {
                currentStageId = stage.id
                break
            }
        }

        if (currentStageId === targetStageId) return

        // Optimistic update
        setStages(prev => {
            const newStages = prev.map(stage => ({
                ...stage,
                deals: stage.deals.filter(d => d.id !== dealId)
            }))

            const dealToMove = prev
                .find(s => s.id === currentStageId)
                ?.deals.find(d => d.id === dealId)

            if (dealToMove) {
                const targetIdx = newStages.findIndex(s => s.id === targetStageId)
                if (targetIdx >= 0) {
                    newStages[targetIdx].deals.push({
                        ...dealToMove,
                        stageId: targetStageId!
                    })
                }
            }

            return newStages
        })

        // API call
        try {
            await fetch(`/api/deals/${dealId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ stageId: targetStageId }),
            })
        } catch (error) {
            toast.error('Erro ao mover negócio')
            loadPipeline()
        }
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center h-96">
                <div className="text-gray-400">Carregando...</div>
            </div>
        )
    }

    if (stages.length === 0) {
        return (
            <div className="p-6">
                <div className="mb-6">
                    <h1 className="text-2xl font-bold text-white">Negócios | Pipeline</h1>
                    <p className="text-gray-400">Gerencie o fluxo de seus leads.</p>
                </div>

                <div className="flex flex-col items-center justify-center h-96">
                    <h3 className="text-lg font-medium text-white mb-2">Nenhum funil encontrado</h3>
                    <p className="text-gray-400 mb-6">Crie um funil para começar a gerenciar seus negócios.</p>
                    <Button
                        onClick={createDefaultPipeline}
                        className="bg-purple-600 hover:bg-purple-700"
                    >
                        <Plus className="h-4 w-4 mr-2" />
                        Criar Funil
                    </Button>
                </div>
            </div>
        )
    }

    return (
        <div className="p-6">
            <div className="mb-6 flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-white">Negócios | Pipeline</h1>
                    <p className="text-gray-400">Gerencie o fluxo de seus leads.</p>
                </div>
                <Button
                    onClick={() => handleAddDeal(stages[0]?.id)}
                    className="bg-purple-600 hover:bg-purple-700"
                >
                    <Plus className="h-4 w-4 mr-2" />
                    Novo Negócio
                </Button>
            </div>

            <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
            >
                <div className="flex gap-4 overflow-x-auto pb-4">
                    {stages.map((stage) => (
                        <StageColumn
                            key={stage.id}
                            stage={stage}
                            onAddDeal={handleAddDeal}
                        />
                    ))}
                </div>

                <DragOverlay>
                    {activeDeal && <DealCard deal={activeDeal} isDragging />}
                </DragOverlay>
            </DndContext>

            {/* Add Deal Dialog */}
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent className="bg-[#0F1629] border-gray-800 text-white">
                    <DialogHeader>
                        <DialogTitle>Novo Negócio</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 pt-4">
                        <div>
                            <Label>Título*</Label>
                            <Input
                                value={newDeal.title}
                                onChange={(e) => setNewDeal({ ...newDeal, title: e.target.value })}
                                placeholder="Ex: Proposta Website"
                                className="mt-1 bg-[#0A0E27] border-gray-700"
                            />
                        </div>
                        <div>
                            <Label>Valor (R$)</Label>
                            <Input
                                type="number"
                                value={newDeal.value}
                                onChange={(e) => setNewDeal({ ...newDeal, value: e.target.value })}
                                placeholder="0,00"
                                className="mt-1 bg-[#0A0E27] border-gray-700"
                            />
                        </div>
                        <div>
                            <Label>Observações</Label>
                            <Textarea
                                value={newDeal.notes}
                                onChange={(e) => setNewDeal({ ...newDeal, notes: e.target.value })}
                                placeholder="Notas sobre o negócio..."
                                className="mt-1 bg-[#0A0E27] border-gray-700"
                            />
                        </div>
                        <div className="flex justify-end gap-2 pt-4">
                            <Button
                                variant="outline"
                                onClick={() => setIsDialogOpen(false)}
                                className="border-gray-700"
                            >
                                Cancelar
                            </Button>
                            <Button
                                onClick={handleSaveDeal}
                                className="bg-purple-600 hover:bg-purple-700"
                            >
                                Salvar
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    )
}
