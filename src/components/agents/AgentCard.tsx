import { Agent } from '@prisma/client'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { RowActionItem, RowActions } from '@/components/shared/RowActions'
import { Pencil, Trash2, Bot } from 'lucide-react'
import { AGENT_WIDGET_DEFAULTS } from '@/lib/palette'

interface AgentCardProps {
    agent: Agent
    onEdit: (agent: Agent) => void
    onDelete: (id: string) => void
    onToggleStatus: (id: string, currentStatus: boolean) => void
}

export function AgentCard({ agent, onEdit, onDelete, onToggleStatus }: AgentCardProps) {
    return (
        <Card className="flex flex-col transition-all hover:shadow-md">
            <CardHeader className="flex flex-row items-start justify-between pb-2">
                <div className="flex items-center gap-3">
                    <div
                        className="flex h-10 w-10 items-center justify-center rounded-lg"
                        style={{ backgroundColor: agent.primaryColor || AGENT_WIDGET_DEFAULTS.primaryColor }}
                    >
                        {agent.avatar ? (
                            <img src={agent.avatar} alt={agent.name} className="h-full w-full rounded-lg object-cover" />
                        ) : (
                            <Bot className="h-6 w-6 text-foreground" />
                        )}
                    </div>
                    <div>
                        <CardTitle className="text-base font-semibold text-foreground">
                            {agent.name}
                        </CardTitle>
                        <p className="text-xs text-muted-foreground">{agent.llmModel}</p>
                    </div>
                </div>
                {/* An agent paused because the plan shrank cannot be switched
                    back on — the badge says why rather than being a control that
                    silently refuses. */}
                {agent.pausedByLimit ? (
                    <Badge
                        variant="warning"
                        title="Pausado por exceder o limite do plano. Mude de plano para reativá-lo."
                    >
                        Acima do plano
                    </Badge>
                ) : (
                    <Badge
                        variant={agent.isActive ? 'success' : 'neutral'}
                        className="cursor-pointer hover:opacity-80"
                        onClick={() => onToggleStatus(agent.id, agent.isActive)}
                    >
                        {agent.isActive ? 'Ativo' : 'Pausado'}
                    </Badge>
                )}
            </CardHeader>

            <CardContent className="flex-1 pb-4">
                <p className="line-clamp-2 text-sm text-muted-foreground">
                    {agent.description || 'Sem descrição definida.'}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                    {agent.voiceTone && (
                        <Badge variant="outline" className="text-xs">
                            Tom: {agent.voiceTone}
                        </Badge>
                    )}
                    <Badge variant="outline" className="border-info/30 bg-info-subtle text-xs text-info-subtle-foreground">
                        {agent.llmProvider}
                    </Badge>
                </div>
            </CardContent>

            {/* The same menu the tables use. Two unlabelled icon buttons were
                the only per-item actions in the app that still read as icons
                rather than as a named list. */}
            <CardFooter className="flex justify-end border-t bg-muted/10 pt-4">
                <RowActions label={`Ações do agente ${agent.name}`}>
                    <RowActionItem icon={Pencil} onClick={() => onEdit(agent)}>
                        Editar
                    </RowActionItem>
                    <RowActionItem
                        icon={Trash2}
                        destructive
                        onClick={() => onDelete(agent.id)}
                    >
                        Excluir
                    </RowActionItem>
                </RowActions>
            </CardFooter>
        </Card>
    )
}
