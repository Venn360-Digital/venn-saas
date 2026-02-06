'use client'

import { useState, useEffect } from 'react'
import { Plus, List, Calendar, Clock, CheckCircle2, Circle, Trash2, Edit } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface Activity {
    id: string
    title: string
    type: string
    description: string | null
    dueDate: string | null
    startTime: string | null
    endTime: string | null
    completedAt: string | null
    contact: { id: string; name: string | null } | null
    deal: { id: string; title: string } | null
}

const FILTERS = [
    { id: 'today', label: 'Hoje' },
    { id: 'week', label: 'Esta Semana' },
    { id: 'month', label: 'Este Mês' },
    { id: 'lastMonth', label: 'Mês Anterior' },
    { id: 'custom', label: 'Personalizado' },
]

const ACTIVITY_TYPES = [
    { id: 'meeting', label: 'Reunião', icon: '📅' },
    { id: 'call', label: 'Ligação', icon: '📞' },
    { id: 'videocall', label: 'Videochamada', icon: '📹' },
    { id: 'followup', label: 'Follow-up', icon: '🔄' },
    { id: 'email', label: 'E-mail', icon: '✉️' },
]


export default function AgendaPage() {
    const [activities, setActivities] = useState<Activity[]>([])
    const [loading, setLoading] = useState(true)
    const [filter, setFilter] = useState('today')
    const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list')
    const [isDialogOpen, setIsDialogOpen] = useState(false)
    const [editingActivity, setEditingActivity] = useState<Activity | null>(null)

    // Custom date range for "Personalizado" filter
    const [customDateRange, setCustomDateRange] = useState({
        startDate: new Date().toISOString().split('T')[0],
        endDate: new Date().toISOString().split('T')[0],
    })

    const [formData, setFormData] = useState({
        title: '',
        type: 'meeting',
        description: '',
        dueDate: '',
        startTime: '',
        endTime: '',
    })

    useEffect(() => {
        loadActivities()
    }, [filter, customDateRange])

    const loadActivities = async () => {
        setLoading(true)
        try {
            let url = `/api/activities?filter=${filter}`

            // Add custom date range params for "Personalizado" filter
            if (filter === 'custom') {
                url += `&startDate=${customDateRange.startDate}&endDate=${customDateRange.endDate}`
            }

            const res = await fetch(url)
            if (res.ok) {
                const data = await res.json()
                setActivities(data)
            }
        } catch (error) {
            console.error('Error loading activities:', error)
        } finally {
            setLoading(false)
        }
    }

    const handleOpenDialog = (activity?: Activity) => {
        if (activity) {
            setEditingActivity(activity)
            setFormData({
                title: activity.title,
                type: activity.type,
                description: activity.description || '',
                dueDate: activity.dueDate ? activity.dueDate.split('T')[0] : '',
                startTime: activity.startTime || '',
                endTime: activity.endTime || '',
            })
        } else {
            setEditingActivity(null)
            setFormData({
                title: '',
                type: 'meeting',
                description: '',
                dueDate: new Date().toISOString().split('T')[0],
                startTime: '',
                endTime: '',
            })
        }
        setIsDialogOpen(true)
    }

    const handleSave = async () => {
        if (!formData.title.trim()) {
            toast.error('Título é obrigatório')
            return
        }

        try {
            const url = editingActivity
                ? `/api/activities/${editingActivity.id}`
                : '/api/activities'

            const res = await fetch(url, {
                method: editingActivity ? 'PATCH' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...formData,
                    dueDate: formData.dueDate || undefined,
                }),
            })

            if (res.ok) {
                toast.success(editingActivity ? 'Atividade atualizada!' : 'Atividade criada!')
                setIsDialogOpen(false)
                loadActivities()
            } else {
                toast.error('Erro ao salvar atividade')
            }
        } catch (error) {
            toast.error('Erro ao salvar atividade')
        }
    }

    const handleToggleComplete = async (activity: Activity) => {
        try {
            const res = await fetch(`/api/activities/${activity.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ completed: !activity.completedAt }),
            })

            if (res.ok) {
                loadActivities()
            }
        } catch (error) {
            toast.error('Erro ao atualizar atividade')
        }
    }

    const handleDelete = async (id: string) => {
        if (!confirm('Tem certeza que deseja excluir esta atividade?')) return

        try {
            const res = await fetch(`/api/activities/${id}`, { method: 'DELETE' })
            if (res.ok) {
                toast.success('Atividade excluída!')
                loadActivities()
            }
        } catch (error) {
            toast.error('Erro ao excluir atividade')
        }
    }

    const getTypeLabel = (type: string) => {
        return ACTIVITY_TYPES.find(t => t.id === type)?.label || type
    }

    const formatTime = (activity: Activity) => {
        if (activity.startTime) {
            return activity.endTime
                ? `${activity.startTime} - ${activity.endTime}`
                : activity.startTime
        }
        return null
    }

    return (
        <div className="p-6">
            <div className="mb-6 flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-white">Agenda</h1>
                    <p className="text-gray-400">Organize suas tarefas, reuniões e follow-ups.</p>
                </div>
                <div className="flex items-center gap-2">
                    <div className="flex rounded-lg border border-gray-700 p-1">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setViewMode('list')}
                            className={cn(
                                "h-8 px-3",
                                viewMode === 'list' && "bg-gray-800"
                            )}
                        >
                            <List className="h-4 w-4" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setViewMode('calendar')}
                            className={cn(
                                "h-8 px-3",
                                viewMode === 'calendar' && "bg-gray-800"
                            )}
                        >
                            <Calendar className="h-4 w-4" />
                        </Button>
                    </div>
                    <Button
                        onClick={() => handleOpenDialog()}
                        className="bg-purple-600 hover:bg-purple-700"
                    >
                        <Plus className="h-4 w-4 mr-2" />
                        Nova atividade
                    </Button>
                </div>
            </div>

            {/* Filters */}
            <div className="mb-6 flex flex-wrap items-center gap-2">
                {FILTERS.map((f) => (
                    <Button
                        key={f.id}
                        variant="ghost"
                        size="sm"
                        onClick={() => setFilter(f.id)}
                        className={cn(
                            "rounded-full",
                            filter === f.id
                                ? "bg-gray-800 text-white"
                                : "text-gray-400 hover:text-white"
                        )}
                    >
                        {f.label}
                    </Button>
                ))}

                {/* Custom Date Range Inputs */}
                {filter === 'custom' && (
                    <div className="flex items-center gap-2 ml-4">
                        <div className="flex items-center gap-2">
                            <span className="text-sm text-gray-400">De:</span>
                            <Input
                                type="date"
                                value={customDateRange.startDate}
                                onChange={(e) => setCustomDateRange(prev => ({ ...prev, startDate: e.target.value }))}
                                className="w-36 h-8 bg-[#0A0E27] border-gray-700 text-sm"
                            />
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-sm text-gray-400">Até:</span>
                            <Input
                                type="date"
                                value={customDateRange.endDate}
                                onChange={(e) => setCustomDateRange(prev => ({ ...prev, endDate: e.target.value }))}
                                className="w-36 h-8 bg-[#0A0E27] border-gray-700 text-sm"
                            />
                        </div>
                    </div>
                )}
            </div>

            {/* Activity List */}
            <div className="space-y-2">
                {loading ? (
                    <div className="flex items-center justify-center h-64">
                        <span className="text-gray-400">Carregando...</span>
                    </div>
                ) : activities.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64 text-gray-400">
                        <Calendar className="h-12 w-12 mb-4 text-gray-600" />
                        <p>Nenhuma atividade encontrada</p>
                    </div>
                ) : (
                    activities.map((activity) => (
                        <div
                            key={activity.id}
                            className={cn(
                                "flex items-center gap-4 p-4 rounded-lg border border-gray-800 bg-[#0F1629]",
                                activity.completedAt && "opacity-60"
                            )}
                        >
                            <button
                                onClick={() => handleToggleComplete(activity)}
                                className="flex-shrink-0"
                            >
                                {activity.completedAt ? (
                                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                                ) : (
                                    <Circle className="h-5 w-5 text-gray-500 hover:text-purple-500" />
                                )}
                            </button>

                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className={cn(
                                        "font-medium text-white",
                                        activity.completedAt && "line-through"
                                    )}>
                                        {activity.title}
                                    </span>
                                    <span className="text-xs px-2 py-0.5 rounded bg-gray-800 text-gray-400">
                                        {getTypeLabel(activity.type)}
                                    </span>
                                </div>
                                {activity.description && (
                                    <p className="text-sm text-gray-400 truncate mt-1">
                                        {activity.description}
                                    </p>
                                )}
                            </div>

                            <div className="flex items-center gap-4 text-sm text-gray-400">
                                {formatTime(activity) && (
                                    <div className="flex items-center gap-1">
                                        <Clock className="h-4 w-4" />
                                        {formatTime(activity)}
                                    </div>
                                )}

                                <div className="flex items-center gap-1">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8"
                                        onClick={() => handleOpenDialog(activity)}
                                    >
                                        <Edit className="h-4 w-4" />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 text-red-500 hover:text-red-400"
                                        onClick={() => handleDelete(activity.id)}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* Dialog */}
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent className="bg-[#0F1629] border-gray-800 text-white">
                    <DialogHeader>
                        <DialogTitle>Nova Atividade</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 pt-4">
                        <div>
                            <Label>Título</Label>
                            <Input
                                value={formData.title}
                                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                                placeholder="Ex: Reunião com Cliente"
                                className="mt-1 bg-[#0A0E27] border-gray-700"
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <Label>Data</Label>
                                <Input
                                    type="date"
                                    value={formData.dueDate}
                                    onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })}
                                    className="mt-1 bg-[#0A0E27] border-gray-700"
                                />
                            </div>
                            <div>
                                <Label>Hora início</Label>
                                <Input
                                    type="time"
                                    value={formData.startTime}
                                    onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
                                    className="mt-1 bg-[#0A0E27] border-gray-700"
                                />
                            </div>
                        </div>

                        <div>
                            <Label>Hora fim (opcional)</Label>
                            <Input
                                type="time"
                                value={formData.endTime}
                                onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
                                className="mt-1 bg-[#0A0E27] border-gray-700"
                            />
                        </div>

                        <div>
                            <Label>Tipo</Label>
                            <Select
                                value={formData.type}
                                onValueChange={(value) => setFormData({ ...formData, type: value })}
                            >
                                <SelectTrigger className="mt-1 bg-[#0A0E27] border-gray-700">
                                    <SelectValue placeholder="Selecione..." />
                                </SelectTrigger>
                                <SelectContent className="bg-[#0F1629] border-gray-800">
                                    {ACTIVITY_TYPES.map((type) => (
                                        <SelectItem key={type.id} value={type.id}>
                                            {type.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
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
                                onClick={handleSave}
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
