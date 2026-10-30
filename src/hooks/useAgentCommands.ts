'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { marcarSujo } from '@/components/agents/creation/unsaved'
import { RuleData } from '@/types/agent-creation'
import { idsParaApagar } from '@/lib/rules/sincronizar'
import {
    DEFAULT_AGENT_PREFERENCES,
    readAgentPreferences,
    type AgentPreferences,
} from '@/types/agent-preferences'

export function useAgentCommands(agentId?: string | null) {
    const router = useRouter()
    const [isSaving, setIsSaving] = useState(false)

    // Estado das regras
    const [rules, setRules] = useState<RuleData[]>([])

    /**
     * Os ids que vieram do servidor — é por eles que se sabe o que **apagar**.
     *
     * Sem esta lista, a remoção na tela era invisível para a gravação: o salvar
     * percorre o array atual, então o que saiu dele não gerava chamada nenhuma e
     * a regra continuava no banco, ativa, rodando a cada mensagem. É o mesmo
     * arranjo que o salvar dos documentos de treinamento usa para só enviar o
     * que mudou.
     *
     * `useRef` e não estado: ninguém renderiza por causa dela, e mudá-la não
     * pode disparar redesenho da tela.
     */
    const idsNoServidor = useRef<string[]>([])

    // Estado das preferências
    const [preferencias, setPreferencias] = useState<AgentPreferences>(DEFAULT_AGENT_PREFERENCES)

    // Carregar dados do agente (preferências e regras)
    const loadCommands = async (id: string) => {
        try {
            // Carregar regras
            const rulesResponse = await fetch(`/api/agents/${id}/rules`)
            if (rulesResponse.ok) {
                const rulesData: RuleData[] = await rulesResponse.json()
                setRules(rulesData.map((r) => ({
                    id: r.id,
                    name: r.name,
                    isActive: r.isActive,
                    priority: r.priority ?? 0,
                    conditions: r.conditions,
                    actions: r.actions,
                })))
                idsNoServidor.current = rulesData
                    .map((r) => r.id)
                    .filter((id): id is string => Boolean(id))
            }

            // Carregar preferências do agente. `readAgentPreferences` descarta
            // valor inválido e preenche o que falta, então um agente gravado por
            // uma versão anterior da tela abre sem campo vazio nem `NaN`.
            const agentResponse = await fetch(`/api/agents/${id}`)
            if (agentResponse.ok) {
                const agent = await agentResponse.json()
                setPreferencias(readAgentPreferences(agent.preferences))
            }
        } catch (error) {
            console.error('Error loading commands:', error)
        }
    }

    // Salvar regras e preferências
    const saveCommands = async (id: string) => {
        setIsSaving(true)
        try {
            // Salvar preferências no agente
            const agentResponse = await fetch(`/api/agents/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ preferences: preferencias }),
            })

            if (!agentResponse.ok) {
                throw new Error('Failed to save preferences')
            }

            /**
             * Falha de uma regra não derruba as outras — e não é engolida.
             *
             * Era o pior dos dois mundos: o `PATCH` não tinha o retorno
             * conferido, então uma regra que falhava ao salvar saía em silêncio e
             * a tela dizia "Configurações salvas". Agora cada chamada é contada,
             * todas são tentadas, e o aviso no fim diz quantas ficaram para trás.
             */
            const falhas: string[] = []

            /**
             * **Apagar vem primeiro.** Enquanto a regra existe no banco ela
             * roda, e roda antes do agente: adiar a remoção para depois de
             * gravar as outras deixa a regra removida valendo por mais uma
             * janela de chamadas.
             */
            for (const ruleId of idsParaApagar(idsNoServidor.current, rules)) {
                try {
                    const r = await fetch(`/api/agents/${id}/rules/${ruleId}`, { method: 'DELETE' })
                    if (!r.ok) falhas.push('não foi possível excluir uma regra')
                } catch {
                    falhas.push('não foi possível excluir uma regra')
                }
            }

            // Salvar/atualizar regras
            const idsGravados: string[] = []
            for (const rule of rules) {
                if (rule.id) {
                    // Atualizar regra existente
                    const response = await fetch(`/api/agents/${id}/rules/${rule.id}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            name: rule.name,
                            isActive: rule.isActive,
                            priority: rule.priority ?? 0,
                            conditions: rule.conditions,
                            actions: rule.actions,
                        }),
                    })

                    if (response.ok) {
                        idsGravados.push(rule.id)
                    } else {
                        // Segue no servidor: continua na lista do que existe lá.
                        idsGravados.push(rule.id)
                        falhas.push(`"${rule.name || 'regra'}" não foi salva`)
                    }
                } else {
                    // Criar nova regra
                    const response = await fetch(`/api/agents/${id}/rules`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            name: rule.name || 'Nova Regra',
                            isActive: rule.isActive,
                            priority: rule.priority ?? 0,
                            conditions: rule.conditions,
                            actions: rule.actions,
                        }),
                    })

                    if (response.ok) {
                        const newRule = await response.json()
                        idsGravados.push(newRule.id)
                        // Atualizar a regra com o ID retornado
                        setRules(prev => prev.map(r =>
                            r === rule ? { ...r, id: newRule.id } : r
                        ))
                    } else {
                        falhas.push(`"${rule.name || 'Nova Regra'}" não foi criada`)
                    }
                }
            }

            /**
             * A lista do que existe no servidor é reescrita **a cada gravação**.
             *
             * Sem isto, salvar duas vezes seguidas tentaria apagar de novo o que
             * já foi apagado (404 ruidoso), e uma regra recém-criada não entraria
             * na conta do salvar seguinte.
             */
            idsNoServidor.current = idsGravados

            if (falhas.length > 0) {
                console.error('[useAgentCommands] falhas ao salvar regras:', falhas)
                toast.error(
                    falhas.length === 1
                        ? falhas[0]
                        : `${falhas.length} regras não foram salvas; recarregue e confira`
                )
                return false
            }

            marcarSujo(false)
            toast.success('Configurações salvas')
            return true
        } catch (error) {
            console.error('Error saving commands:', error)
            toast.error('Erro ao salvar configurações')
            return false
        } finally {
            setIsSaving(false)
        }
    }

    return {
        rules,
        setRules,
        preferencias,
        setPreferencias,
        loadCommands,
        saveCommands,
        isSaving,
    }
}
