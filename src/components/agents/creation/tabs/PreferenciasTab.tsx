'use client'

import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { SettingsCard, SettingsRow } from '@/components/shared/TabsFrame'
import { INTERACTION_LIMITS, type AgentPreferences } from '@/types/agent-preferences'

/**
 * As preferências da conversa, na guia de ajustes da Tela 03.
 *
 * Eram blocos desenhados à mão — `rounded-lg border bg-card p-4` repetido sete
 * vezes, com a própria ideia de linha e os próprios tamanhos de texto. Agora são
 * `SettingsCard` e `SettingsRow`, os mesmos da Conta: uma superfície só, um
 * ritmo só, e o fio entre linhas vindo do componente em vez de ser redesenhado.
 *
 * A forma dos dados vem de `@/types/agent-preferences`, que é a mesma que a API
 * valida e o worker lê. Esta tela já teve a sua própria cópia da interface, e foi
 * ela que deixou `responseSpeed` virar segundos aqui e um enum de texto no
 * worker — slider inerte por meses.
 *
 * Saiu o interruptor "assumir a conversa manualmente": assumir **sempre**
 * interrompe o agente, e o controle sugeria que desligá-lo o faria responder por
 * cima do atendente.
 */

interface PreferenciasTabProps {
    data: AgentPreferences
    onChange: (data: Partial<AgentPreferences>) => void
    /**
     * O `fieldset` de `CamposSomenteLeitura` cobre os campos; o Slider do Radix
     * desenha um `span[role=slider]`, que não é controle de formulário e escapa.
     * Esta prop é só para ele.
     */
    somenteLeitura?: boolean
}

export function PreferenciasTab({ data, onChange, somenteLeitura = false }: PreferenciasTabProps) {
    return (
        <div className="flex flex-col gap-4">
            <SettingsCard
                title="Como o Agente responde"
                description="O ritmo e o tom das respostas automáticas."
            >
                <div className="flex flex-col gap-4">
                    <SettingsRow
                        title="Exibir indicador de digitação"
                        description='Mostra "digitando…" no WhatsApp enquanto o Agente escreve a resposta.'
                        action={
                            <Switch
                                checked={data.showTypingIndicator}
                                aria-label="Exibir indicador de digitação"
                                onCheckedChange={(showTypingIndicator) => onChange({ showTypingIndicator })}
                            />
                        }
                    />

                    <div className="border-t border-border pt-4">
                        <SettingsRow
                            title="Velocidade de resposta"
                            description="Espera antes de responder, somada à pausa que o Agente já faz para o paciente terminar de escrever."
                            action={
                                <span className="num w-12 text-right text-[13px] font-semibold">
                                    {data.responseSpeed.toFixed(1)} s
                                </span>
                            }
                        />
                        <Slider
                            // Ver InstrucoesTab: o fieldset não alcança o Slider.
                            disabled={somenteLeitura}
                            className="mt-3"
                            value={[data.responseSpeed]}
                            onValueChange={([responseSpeed]) => onChange({ responseSpeed })}
                            max={10}
                            step={0.5}
                            aria-label="Velocidade de resposta"
                        />
                    </div>

                    <div className="border-t border-border pt-4">
                        <SettingsRow
                            title="Usar emojis nas respostas"
                            description="Deixa o Agente usar emojis com moderação, para a conversa soar menos automática."
                            action={
                                <Switch
                                    checked={data.useEmojis}
                                    aria-label="Usar emojis nas respostas"
                                    onCheckedChange={(useEmojis) => onChange({ useEmojis })}
                                />
                            }
                        />
                    </div>
                </div>
            </SettingsCard>

            <SettingsCard
                title="O que o Agente pode fazer"
                description="Os limites do atendimento automático."
            >
                <div className="flex flex-col gap-4">
                    <SettingsRow
                        title="Manter contexto da conversa"
                        description="Desligado, o Agente responde cada mensagem como se fosse a primeira — e consome menos créditos."
                        action={
                            <Switch
                                checked={data.keepContext}
                                aria-label="Manter contexto da conversa"
                                onCheckedChange={(keepContext) => onChange({ keepContext })}
                            />
                        }
                    />

                    <div className="border-t border-border pt-4">
                        <SettingsRow
                            title="Restringir temas permitidos"
                            description="O Agente responde só sobre a clínica e as próprias atribuições. Fora disso, recusa educadamente e retoma o atendimento."
                            action={
                                <Switch
                                    checked={data.restrictTopics}
                                    aria-label="Restringir temas permitidos"
                                    onCheckedChange={(restrictTopics) => onChange({ restrictTopics })}
                                />
                            }
                        />
                    </div>

                    {/* Campo livre, e não lista: trinta dias é o que a clínica
                        recebe, não o que ela tem de aceitar. Fechar conversa é
                        decisão de operação — quem atende só por indicação quer
                        um prazo longo, quem vive de tráfego pago quer curto. */}
                    <div className="border-t border-border pt-4">
                        <SettingsRow
                            title="Finalizar atendimento sem resposta"
                            description="Dias de silêncio até o atendimento ser encerrado sozinho. O paciente que voltar reabre a conversa, e o limite de interações recomeça. Zero mantém tudo aberto."
                            action={
                                <div className="flex items-center gap-2">
                                    <Input
                                        type="number"
                                        min={0}
                                        max={365}
                                        className="num w-[90px]"
                                        aria-label="Dias até finalizar o atendimento"
                                        value={String(data.autoCloseDays)}
                                        onChange={(e) => {
                                            // Campo vazio vira 0 em vez de NaN: digitar
                                            // apagando o número não pode gravar lixo.
                                            const n = parseInt(e.target.value, 10)
                                            onChange({
                                                autoCloseDays: Number.isNaN(n)
                                                    ? 0
                                                    : Math.min(365, Math.max(0, n)),
                                            })
                                        }}
                                    />
                                    <span className="text-sm text-muted-foreground">dias</span>
                                </div>
                            }
                        />
                    </div>

                    <div className="border-t border-border pt-4">
                        <SettingsRow
                            title="Limite de interações por atendimento"
                            description="Ao atingir o limite, o Agente para de responder, avisa o paciente e deixa a conversa para a equipe."
                            action={
                                <Select
                                    value={String(data.interactionLimit)}
                                    onValueChange={(v) => onChange({ interactionLimit: Number(v) })}
                                >
                                    <SelectTrigger className="w-[150px]" aria-label="Limite de interações">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {INTERACTION_LIMITS.map((limite) => (
                                            <SelectItem key={limite} value={String(limite)}>
                                                {limite} interações
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            }
                        />
                    </div>
                </div>
            </SettingsCard>
        </div>
    )
}
