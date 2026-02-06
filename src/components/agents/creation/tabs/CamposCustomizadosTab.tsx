'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Plus, Trash2, Edit } from 'lucide-react'
import { cn } from '@/lib/utils'

interface CustomField {
    id?: string
    variable: string
    fieldType: 'text' | 'number' | 'date' | 'boolean' | 'select'
    defaultValue?: string
}

interface CamposCustomizadosTabProps {
    agentId?: string | null
    fields: CustomField[]
    onChange: (fields: CustomField[]) => void
}

const FIELD_TYPES = [
    { value: 'text', label: 'Texto' },
    { value: 'number', label: 'Número' },
    { value: 'date', label: 'Data' },
    { value: 'boolean', label: 'Sim/Não' },
    { value: 'select', label: 'Seleção' },
]

export function CamposCustomizadosTab({ agentId, fields, onChange }: CamposCustomizadosTabProps) {
    const [isAdding, setIsAdding] = useState(false)
    const [newField, setNewField] = useState<CustomField>({
        variable: '',
        fieldType: 'text',
    })

    const addField = () => {
        if (!newField.variable.trim()) return

        onChange([...fields, newField])
        setNewField({ variable: '', fieldType: 'text' })
        setIsAdding(false)
    }

    const deleteField = (index: number) => {
        onChange(fields.filter((_, i) => i !== index))
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-semibold">Campos customizados</h2>
                    <p className="text-muted-foreground mt-1">
                        Crie variáveis personalizadas para usar nas conversas
                    </p>
                </div>
                <Button
                    onClick={() => setIsAdding(true)}
                    className="bg-primary hover:bg-primary/90"
                >
                    <Plus className="mr-2 h-4 w-4" />
                    Novo campo customizado
                </Button>
            </div>

            {/* Table */}
            <div className="rounded-lg border bg-card overflow-hidden">
                {/* Table Header */}
                <div className="grid grid-cols-3 gap-4 bg-muted/50 px-4 py-3 text-sm font-medium">
                    <div>Variável</div>
                    <div>Tipo</div>
                    <div>Ações</div>
                </div>

                {/* Table Body */}
                <div className="divide-y">
                    {fields.length === 0 && !isAdding ? (
                        <div className="p-8 text-center text-muted-foreground">
                            Nenhum campo customizado cadastrado
                        </div>
                    ) : (
                        <>
                            {fields.map((field, index) => (
                                <div key={index} className="grid grid-cols-3 gap-4 p-4 items-center">
                                    <div className="font-mono text-sm">
                                        {`{{${field.variable}}}`}
                                    </div>
                                    <div className="text-sm">
                                        {FIELD_TYPES.find(t => t.value === field.fieldType)?.label}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Button variant="ghost" size="icon">
                                            <Edit className="h-4 w-4" />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => deleteField(index)}
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </>
                    )}

                    {/* Add New Field Row */}
                    {isAdding && (
                        <div className="grid grid-cols-3 gap-4 p-4 items-center bg-muted/30">
                            <Input
                                placeholder="nome_variavel"
                                value={newField.variable}
                                onChange={(e) => setNewField({ ...newField, variable: e.target.value })}
                                className="bg-background"
                            />
                            <select
                                value={newField.fieldType}
                                onChange={(e) => setNewField({ ...newField, fieldType: e.target.value as CustomField['fieldType'] })}
                                className="h-10 rounded-md border bg-background px-3 text-sm"
                            >
                                {FIELD_TYPES.map((type) => (
                                    <option key={type.value} value={type.value}>
                                        {type.label}
                                    </option>
                                ))}
                            </select>
                            <div className="flex items-center gap-2">
                                <Button onClick={addField} size="sm">
                                    Salvar
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => setIsAdding(false)}>
                                    Cancelar
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
