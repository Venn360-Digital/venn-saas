'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Plus, Copy, Trash2, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'

interface RuleCondition {
    type: 'message_contains' | 'user_intent' | 'time_elapsed' | 'custom'
    operator: 'equals' | 'contains' | 'greater_than' | 'less_than' | 'starts_with'
    value: string
}

/**
 * Carga da ação.
 *
 * Só `message` é produzido hoje; `value` é lido como fallback. Quando
 * `add_tag`, `move_pipeline` e `schedule_followup` forem implementados, isto
 * deve virar uma união discriminada por `RuleAction['type']` — modelar agora os
 * campos de ramos que não existem seria inventar contrato.
 */
interface RuleActionParams {
    message?: string
    value?: string
}

interface RuleAction {
    type: 'send_message' | 'notify_human' | 'add_tag' | 'move_pipeline' | 'schedule_followup'
    params: RuleActionParams
}

interface Rule {
    id?: string
    name: string
    isActive: boolean
    conditions: RuleCondition[]
    actions: RuleAction[]
}

interface CondicoesTabProps {
    agentId?: string | null
    rules: Rule[]
    onChange: (rules: Rule[]) => void
}

const CONDITION_TYPES = [
    { value: 'message_contains', label: 'Mensagem contém' },
    { value: 'user_intent', label: 'Intenção detectada' },
    { value: 'time_elapsed', label: 'Tempo decorrido' },
    { value: 'custom', label: 'Personalizado' },
]

const OPERATORS = [
    { value: 'equals', label: 'É igual a' },
    { value: 'contains', label: 'Contém' },
    { value: 'greater_than', label: 'Maior que' },
    { value: 'less_than', label: 'Menor que' },
    { value: 'starts_with', label: 'Começa com' },
]

const ACTION_TYPES = [
    { value: 'send_message', label: 'Enviar mensagem imediata' },
    { value: 'notify_human', label: 'Notificar atendente' },
    { value: 'add_tag', label: 'Adicionar tag' },
    { value: 'move_pipeline', label: 'Mover no pipeline' },
    { value: 'schedule_followup', label: 'Agendar follow-up' },
]

export function CondicoesTab({ agentId, rules, onChange }: CondicoesTabProps) {
    const addRule = () => {
        const newRule: Rule = {
            name: '',
            isActive: true,
            conditions: [{ type: 'user_intent', operator: 'equals', value: '' }],
            actions: [{ type: 'send_message', params: { message: '' } }],
        }
        onChange([...rules, newRule])
    }

    const updateRule = (index: number, updates: Partial<Rule>) => {
        const newRules = [...rules]
        newRules[index] = { ...newRules[index], ...updates }
        onChange(newRules)
    }

    const deleteRule = (index: number) => {
        onChange(rules.filter((_, i) => i !== index))
    }

    const duplicateRule = (index: number) => {
        const ruleToCopy = { ...rules[index], id: undefined, name: `${rules[index].name} (cópia)` }
        onChange([...rules, ruleToCopy])
    }

    const addCondition = (ruleIndex: number) => {
        const newRules = [...rules]
        newRules[ruleIndex].conditions.push({ type: 'user_intent', operator: 'equals', value: '' })
        onChange(newRules)
    }

    const updateCondition = (ruleIndex: number, condIndex: number, updates: Partial<RuleCondition>) => {
        const newRules = [...rules]
        newRules[ruleIndex].conditions[condIndex] = { ...newRules[ruleIndex].conditions[condIndex], ...updates }
        onChange(newRules)
    }

    const deleteCondition = (ruleIndex: number, condIndex: number) => {
        const newRules = [...rules]
        newRules[ruleIndex].conditions = newRules[ruleIndex].conditions.filter((_, i) => i !== condIndex)
        onChange(newRules)
    }

    const addAction = (ruleIndex: number) => {
        const newRules = [...rules]
        newRules[ruleIndex].actions.push({ type: 'send_message', params: { message: '' } })
        onChange(newRules)
    }

    const updateAction = (ruleIndex: number, actionIndex: number, updates: Partial<RuleAction>) => {
        const newRules = [...rules]
        newRules[ruleIndex].actions[actionIndex] = { ...newRules[ruleIndex].actions[actionIndex], ...updates }
        onChange(newRules)
    }

    const deleteAction = (ruleIndex: number, actionIndex: number) => {
        const newRules = [...rules]
        newRules[ruleIndex].actions = newRules[ruleIndex].actions.filter((_, i) => i !== actionIndex)
        onChange(newRules)
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <h2 className="text-2xl font-semibold">Condições e Ações do Agente</h2>
                <p className="text-muted-foreground mt-1">
                    Configure regras automáticas de IF (Condições) e THEN (Ações) para seu Agente
                </p>
            </div>

            {/* Add Rule Button */}
            <Button onClick={addRule} className="bg-primary hover:bg-primary/90">
                <Plus className="mr-2 h-4 w-4" />
                Adicionar nova regra
            </Button>

            {/* Empty State */}
            {rules.length === 0 && (
                <div className="rounded-lg border border-dashed border-muted-foreground/25 p-12 text-center">
                    <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                        <Zap className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <h3 className="text-lg font-medium">Nenhuma regra configurada</h3>
                    <p className="text-muted-foreground mt-1">
                        Crie regras automáticas para definir comportamentos específicos do seu Agente em diferentes situações
                    </p>
                </div>
            )}

            {/* Rules List */}
            <div className="space-y-4">
                {rules.map((rule, ruleIndex) => (
                    <div key={ruleIndex} className="rounded-lg border bg-card p-6 space-y-6">
                        {/* Rule Header */}
                        <div className="flex items-center gap-4">
                            <Input
                                placeholder="Ex: Cliente quer fechar pedido"
                                value={rule.name}
                                onChange={(e) => updateRule(ruleIndex, { name: e.target.value })}
                                className="flex-1 bg-muted/50"
                            />
                            <Switch
                                checked={rule.isActive}
                                onCheckedChange={(checked) => updateRule(ruleIndex, { isActive: checked })}
                            />
                            <Button variant="ghost" size="icon" onClick={() => duplicateRule(ruleIndex)}>
                                <Copy className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => deleteRule(ruleIndex)}>
                                <Trash2 className="h-4 w-4" />
                            </Button>
                        </div>

                        {/* Conditions Section */}
                        <div className="space-y-3">
                            <Label className="text-sm font-medium">SE (Condições)</Label>
                            {rule.conditions.map((condition, condIndex) => (
                                <div key={condIndex} className="flex items-center gap-3">
                                    <select
                                        value={condition.type}
                                        onChange={(e) => updateCondition(ruleIndex, condIndex, { type: e.target.value as RuleCondition['type'] })}
                                        className="h-10 rounded-md border bg-muted/50 px-3 text-sm flex-1"
                                    >
                                        {CONDITION_TYPES.map((type) => (
                                            <option key={type.value} value={type.value}>{type.label}</option>
                                        ))}
                                    </select>
                                    <select
                                        value={condition.operator}
                                        onChange={(e) => updateCondition(ruleIndex, condIndex, { operator: e.target.value as RuleCondition['operator'] })}
                                        className="h-10 rounded-md border bg-muted/50 px-3 text-sm w-32"
                                    >
                                        {OPERATORS.map((op) => (
                                            <option key={op.value} value={op.value}>{op.label}</option>
                                        ))}
                                    </select>
                                    <Input
                                        placeholder="Valor"
                                        value={condition.value}
                                        onChange={(e) => updateCondition(ruleIndex, condIndex, { value: e.target.value })}
                                        className="flex-1 bg-muted/50"
                                    />
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => deleteCondition(ruleIndex, condIndex)}
                                        disabled={rule.conditions.length === 1}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            ))}
                            <Button variant="link" className="text-primary p-0 h-auto" onClick={() => addCondition(ruleIndex)}>
                                + Adicionar condição
                            </Button>
                        </div>

                        {/* Actions Section */}
                        <div className="space-y-3">
                            <Label className="text-sm font-medium">ENTÃO (Ações)</Label>
                            {rule.actions.map((action, actionIndex) => (
                                <div key={actionIndex} className="flex items-center gap-3">
                                    <select
                                        value={action.type}
                                        onChange={(e) => updateAction(ruleIndex, actionIndex, { type: e.target.value as RuleAction['type'] })}
                                        className="h-10 rounded-md border bg-muted/50 px-3 text-sm flex-1"
                                    >
                                        {ACTION_TYPES.map((type) => (
                                            <option key={type.value} value={type.value}>{type.label}</option>
                                        ))}
                                    </select>
                                    <Input
                                        placeholder="Configuração"
                                        value={action.params.message || action.params.value || ''}
                                        onChange={(e) => updateAction(ruleIndex, actionIndex, { params: { message: e.target.value } })}
                                        className="flex-1 bg-muted/50"
                                    />
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => deleteAction(ruleIndex, actionIndex)}
                                        disabled={rule.actions.length === 1}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            ))}
                            <Button variant="link" className="text-primary p-0 h-auto" onClick={() => addAction(ruleIndex)}>
                                + Adicionar ação
                            </Button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}
