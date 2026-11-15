'use client'

import { useState } from 'react'
import { Copy, Loader2, Power, Trash2 } from 'lucide-react'

import { Button } from '@venn/ui/button'
import { ConfirmDialog } from '../../../shared/ConfirmDialog'
import { SettingsCard, SettingsRow } from '../../../shared/TabsFrame'
import { useVocab } from '../../../../hooks/useVocab'
import { comArtigo } from '../../../../lib/concordancia'

/**
 * As ações sobre o agente, na guia de ajustes da Tela 03.
 *
 * **O que destrói mora num cartão só dele.** Duplicar e pausar se desfazem com
 * outro clique; excluir não. Na versão anterior os três dividiam a mesma pilha,
 * com o excluir separado apenas por uma borda avermelhada — e a diferença entre
 * "pausei sem querer" e "apaguei a base de conhecimento inteira" não pode
 * depender de reparar numa borda.
 *
 * O excluir também deixou de confirmar com um segundo clique no mesmo botão:
 * dois cliques por reflexo apagavam o agente. Agora é o `ConfirmDialog` do
 * sistema, que diz o que se perde e exige o nome digitado.
 */

interface AcoesTabProps {
    agentId?: string | null
    agentName?: string
    isActive?: boolean
    onDuplicate: () => Promise<void>
    onToggleActive: () => Promise<void>
    onDelete: () => Promise<void>
    /** Se quem olha pode executar estas ações. Todas são de administrador. */
    canManage?: boolean
}

export function AcoesTab({
    agentId,
    agentName,
    isActive = true,
    onDuplicate,
    onToggleActive,
    onDelete,
    canManage = true,
}: AcoesTabProps) {
    const v = useVocab()

    const [duplicando, setDuplicando] = useState(false)
    const [alternando, setAlternando] = useState(false)
    const [excluindo, setExcluindo] = useState(false)
    const [confirmar, setConfirmar] = useState(false)

    const correr = async (
        acao: () => Promise<void>,
        marcar: (v: boolean) => void
    ) => {
        marcar(true)
        try {
            await acao()
        } finally {
            marcar(false)
        }
    }

    /**
     * Esta guia é feita só de ações, e todas são de administrador.
     *
     * Em vez de desenhar três botões mortos, a guia diz o que a pessoa veio
     * saber — se o agente está no ar — e onde ela pede o resto.
     */
    if (!canManage) {
        return (
            <SettingsCard
                title="Ações do agente"
                description={`Duplicar, pausar e excluir são do dono ou do administrador ${comArtigo(v, 'organizacao', 'de')}.`}
            >
                <SettingsRow
                    title={isActive ? 'Este agente está ativo' : 'Este agente está pausado'}
                    description={
                        isActive
                            ? 'Ele responde sozinho as mensagens que chegarem pelas linhas conectadas.'
                            : 'Ele não responde sozinho; o atendimento é todo da equipe.'
                    }
                />
            </SettingsCard>
        )
    }

    return (
        <div className="flex flex-col gap-4">
            <SettingsCard
                title="Ações reversíveis"
                description="Dá para desfazer com outro clique."
            >
                <div className="flex flex-col gap-4">
                    <SettingsRow
                        title="Duplicar agente"
                        description="Copia personalidade, base de conhecimento e regras. A cópia nasce sem canal conectado — dois agentes no mesmo WhatsApp responderiam juntos à mesma mensagem."
                        action={
                            <Button
                                variant="outline"
                                disabled={duplicando || !agentId}
                                onClick={() => void correr(onDuplicate, setDuplicando)}
                            >
                                {duplicando ? (
                                    <Loader2 className="size-4 animate-spin" />
                                ) : (
                                    <Copy className="size-4" />
                                )}
                                Duplicar
                            </Button>
                        }
                    />

                    <div className="border-t border-border pt-4">
                        <SettingsRow
                            title={isActive ? 'Pausar agente' : 'Ativar agente'}
                            description={
                                isActive
                                    ? 'Para de responder novas mensagens. As conversas continuam abertas e a equipe segue atendendo normalmente.'
                                    : 'Volta a responder as mensagens que chegarem.'
                            }
                            action={
                                <Button
                                    variant="outline"
                                    disabled={alternando || !agentId}
                                    onClick={() => void correr(onToggleActive, setAlternando)}
                                >
                                    {alternando ? (
                                        <Loader2 className="size-4 animate-spin" />
                                    ) : (
                                        <Power className="size-4" />
                                    )}
                                    {isActive ? 'Pausar' : 'Ativar'}
                                </Button>
                            }
                        />
                    </div>
                </div>
            </SettingsCard>

            {/* O cartão que destrói, separado — para o clique errado não
                acontecer por vizinhança. */}
            <SettingsCard
                className="border-destructive/30"
                title="Excluir agente"
                description="Esta ação não tem volta."
            >
                <SettingsRow
                    title="Apaga a base de conhecimento, as regras, os webhooks e as conexões de canal"
                    description="O WhatsApp deste agente será desconectado. As conversas e o histórico de mensagens continuam guardados, sem o agente."
                    action={
                        <Button
                            variant="destructive"
                            disabled={excluindo || !agentId}
                            onClick={() => setConfirmar(true)}
                        >
                            {excluindo ? (
                                <Loader2 className="size-4 animate-spin" />
                            ) : (
                                <Trash2 className="size-4" />
                            )}
                            Excluir
                        </Button>
                    }
                />
            </SettingsCard>

            <ConfirmDialog
                open={confirmar}
                onOpenChange={setConfirmar}
                title="Excluir agente"
                description={
                    `Esta ação é irreversível. "${agentName ?? 'Este agente'}" para de responder ` +
                    'imediatamente, e são apagados: a base de conhecimento inteira, as regras, ' +
                    'os webhooks e as conexões de canal — o WhatsApp dele será desconectado. ' +
                    'As conversas e o histórico de mensagens continuam guardados, sem o agente.'
                }
                confirmLabel="Excluir agente"
                destructive
                confirmPhrase={agentName}
                confirmPhraseLabel="Digite o nome do agente para confirmar"
                onConfirm={() => correr(onDelete, setExcluindo)}
            />
        </div>
    )
}
