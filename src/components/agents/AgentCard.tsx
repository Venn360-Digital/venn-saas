import { Agent } from '@prisma/client'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Bot, Copy, Eye, Loader2, Pencil, Trash2 } from 'lucide-react'

interface AgentCardProps {
    agent: Agent
    onEdit: (agent: Agent) => void
    onDuplicate: (agent: Agent) => void
    onDelete: (agent: Agent) => void
    onToggleStatus: (id: string, currentStatus: boolean) => void
    /** Enquanto a cópia é criada, para o botão não aceitar um segundo clique. */
    duplicating?: boolean
    /**
     * Se quem olha pode mexer no agente.
     *
     * Configurar agente é de dono e administrador. Sem isto, o atendente via
     * interruptor, Duplicar e Excluir no cartão e cada clique voltava 403 — a
     * tela oferecia o que a API recusa. Ver é liberado; mexer, não.
     */
    canManage?: boolean
}

/** Botão de ação do rodapé: só ícone, com dica e nome acessível (DESIGN.md §5). */
function CardAction({
    icon: Icon,
    label,
    onClick,
    destructive,
    busy,
}: {
    icon: typeof Pencil
    label: string
    onClick: () => void
    destructive?: boolean
    busy?: boolean
}) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={label}
                    disabled={busy}
                    onClick={onClick}
                    className={destructive ? 'text-destructive hover:text-destructive' : undefined}
                >
                    {busy ? <Loader2 className="size-4 animate-spin" /> : <Icon className="size-4" />}
                </Button>
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
        </Tooltip>
    )
}

export function AgentCard({
    agent,
    onEdit,
    onDuplicate,
    onDelete,
    onToggleStatus,
    duplicating,
    canManage = true,
}: AgentCardProps) {
    return (
        <Card className="flex flex-col transition-all hover:shadow-md">
            <CardHeader className="flex flex-row items-start justify-between pb-2">
                <div className="flex min-w-0 items-center gap-3">
                    <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
                        {agent.avatar ? (
                            // Origem no Storage, fora do alcance do next/image sem
                            // configurar remotePatterns.
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={agent.avatar} alt="" className="size-full object-cover" />
                        ) : (
                            <Bot className="size-5 text-muted-foreground" />
                        )}
                    </div>
                    <div className="min-w-0">
                        <CardTitle className="truncate text-base font-semibold text-foreground">
                            {agent.name}
                        </CardTitle>
                        <p className="truncate text-xs text-muted-foreground">{agent.llmModel}</p>
                    </div>
                </div>

                {/*
                  * O estado é um interruptor, não uma pílula clicável.
                  *
                  * A pílula dizia o estado e também o mudava ao clique, sem
                  * nenhum sinal de que fosse clicável — quem queria ler acabava
                  * desligando o agente. Ligado é Ativo, desligado é Pausado.
                  *
                  * Agente pausado por exceder o plano não ganha interruptor: a
                  * API recusa religá-lo, e um controle que só sabe recusar é
                  * pior que um aviso que explica.
                  */}
                {agent.pausedByLimit ? (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Badge variant="warning" className="shrink-0">
                                Acima do plano
                            </Badge>
                        </TooltipTrigger>
                        <TooltipContent>
                            Pausado por exceder o limite do plano. Mude de plano para reativá-lo.
                        </TooltipContent>
                    </Tooltip>
                ) : canManage ? (
                    <div className="flex shrink-0 items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                            {agent.isActive ? 'Ativo' : 'Pausado'}
                        </span>
                        <Switch
                            checked={agent.isActive}
                            aria-label={`${agent.isActive ? 'Pausar' : 'Ativar'} o agente ${agent.name}`}
                            onCheckedChange={() => onToggleStatus(agent.id, agent.isActive)}
                        />
                    </div>
                ) : (
                    // Sem interruptor, o estado continua sendo dito — é o que
                    // interessa a quem só lê.
                    <Badge variant={agent.isActive ? 'success' : 'outline'} className="shrink-0">
                        {agent.isActive ? 'Ativo' : 'Pausado'}
                    </Badge>
                )}
            </CardHeader>

            <CardContent className="flex-1 pb-4">
                <p className="line-clamp-2 text-sm text-muted-foreground">
                    {agent.description || 'Sem descrição definida.'}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                    {agent.companyName && (
                        <Badge variant="outline" className="text-xs">
                            {agent.companyName}
                        </Badge>
                    )}
                    <Badge variant="outline" className="border-info/30 bg-info-subtle text-xs text-info-subtle-foreground">
                        {agent.llmProvider}
                    </Badge>
                </div>
            </CardContent>

            {/*
              * As três ações à vista, não atrás de um menu.
              *
              * Eram duas dentro de um `⋯`, e Duplicar vivia escondido lá dentro
              * do próprio agente, em Gerenciamento → Ações — longe de onde a
              * pessoa está quando quer uma cópia.
              */}
            <CardFooter className="flex justify-end gap-1 border-t bg-muted/10 pt-4">
                <CardAction
                    icon={canManage ? Pencil : Eye}
                    label={canManage ? 'Editar agente' : 'Ver a configuração'}
                    onClick={() => onEdit(agent)}
                />
                {canManage ? (
                    <>
                        <CardAction
                            icon={Copy}
                            label="Duplicar agente"
                            busy={duplicating}
                            onClick={() => onDuplicate(agent)}
                        />
                        <CardAction
                            icon={Trash2}
                            label="Excluir agente"
                            destructive
                            onClick={() => onDelete(agent)}
                        />
                    </>
                ) : null}
            </CardFooter>
        </Card>
    )
}
