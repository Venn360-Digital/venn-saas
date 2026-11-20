'use client'

import { Switch } from '@venn/ui/switch'
import { Slider } from '@venn/ui/slider'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@venn/ui/select'
import { Input } from '@venn/ui/input'
import { Textarea } from '@venn/ui/textarea'
import { SettingsCard, SettingsRow } from '../../../shared/TabsFrame'
import { EmojiPicker } from '../../../shared/EmojiPicker'
import {
    INTERACTION_LIMITS,
    MAX_CHARS_DO_AVISO,
    MAX_LINHAS_DO_AVISO,
    linhasDoAviso,
    type AgentPreferences,
} from '../../../../types/agent-preferences'
import { useVocab } from '../../../../hooks/useVocab'
import { comArtigo } from '../../../../lib/concordancia'

/**
 * As preferências da conversa, na guia de ajustes da Tela 03.
 *
 * Eram blocos desenhados à mão — `rounded-lg border bg-card p-4` repetido sete
 * vezes, com a própria ideia de linha e os próprios tamanhos de texto. Agora são
 * `SettingsCard` e `SettingsRow`, os mesmos da Conta: uma superfície só, um
 * ritmo só, e o fio entre linhas vindo do componente em vez de ser redesenhado.
 *
 * A forma dos dados vem de `../../../../types/agent-preferences`, que é a mesma que a API
 * valida e o worker lê. Esta tela já teve a sua própria cópia da interface, e foi
 * ela que deixou `responseSpeed` virar segundos aqui e um enum de texto no
 * worker — slider inerte por meses.
 *
 * Saiu o interruptor "assumir a conversa manualmente": assumir **sempre**
 * interrompe o agente, e o controle sugeria que desligá-lo o faria responder por
 * cima do atendente.
 *
 * Saiu também "Manter contexto da conversa", e por motivo mais forte: desligado,
 * ele podia deixar a resposta **sem base de conhecimento nenhuma** — ver a nota
 * em `../../../../types/agent-preferences`. Oferecia economia de crédito que não existe
 * (vinte mensagens de WhatsApp são ~600 a 1.000 tokens) em troca de piorar o
 * atendimento em silêncio. Opção que não deveria ser escolhível não é opção.
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
    const v = useVocab()

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
                            description={`Espera antes de responder, somada à pausa que o Agente já faz para ${comArtigo(v, 'pessoa')} terminar de escrever.`}
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
                        title="Restringir temas permitidos"
                        description={`O Agente responde só sobre ${comArtigo(v, 'organizacao')} e as próprias atribuições. Fora disso, recusa educadamente e retoma o atendimento.`}
                        action={
                            <Switch
                                checked={data.restrictTopics}
                                aria-label="Restringir temas permitidos"
                                onCheckedChange={(restrictTopics) => onChange({ restrictTopics })}
                            />
                        }
                    />

                    {/* Campo livre, e não lista: trinta dias é o que a clínica
                        recebe, não o que ela tem de aceitar. Fechar conversa é
                        decisão de operação — quem atende só por indicação quer
                        um prazo longo, quem vive de tráfego pago quer curto. */}
                    <div className="border-t border-border pt-4">
                        <SettingsRow
                            title="Finalizar atendimento sem resposta"
                            description={`Dias de silêncio até o atendimento ser encerrado sozinho. ${comArtigo(v, 'Pessoa')} que voltar reabre a conversa, e o limite de interações recomeça. Zero mantém tudo aberto.`}
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

                    {/* A régua de inatividade, em dois campos porque são duas
                        decisões: quando insistir, e quando desistir. Em minutos
                        porque é a mesma conversa — quem perguntou o preço e
                        parou está com o celular na mão agora. Zero desliga cada
                        um por conta própria: dá para cutucar sem nunca encerrar. */}
                    <div className="border-t border-border pt-4">
                        <SettingsRow
                            title={`Perguntar se ${comArtigo(v, 'pessoa')} ainda está na conversa`}
                            description={`Minutos de silêncio até o Agente perguntar se ${comArtigo(v, 'pessoa')} ainda está por aí. Só vale quando a última mensagem foi nossa, e entre 7h e 20h. Zero não pergunta.`}
                            action={
                                <div className="flex items-center gap-2">
                                    <Input
                                        type="number"
                                        min={0}
                                        max={10080}
                                        className="num w-[90px]"
                                        aria-label="Minutos até perguntar se ainda está na conversa"
                                        value={String(data.inactivityNudgeMinutes)}
                                        onChange={(e) => {
                                            const n = parseInt(e.target.value, 10)
                                            onChange({
                                                inactivityNudgeMinutes: Number.isNaN(n)
                                                    ? 0
                                                    : Math.min(10080, Math.max(0, n)),
                                            })
                                        }}
                                    />
                                    <span className="text-sm text-muted-foreground">minutos</span>
                                </div>
                            }
                        />
                        {/* O texto da cutucada, escrito pela clínica. Vazio usa
                            o do sistema — a régua funciona sem ninguém
                            escrever nada. */}
                        <TextoDoAviso
                            id="pref-nudge-text"
                            rotulo="Mensagem da pergunta"
                            valor={data.inactivityNudgeText}
                            padrao="Oi! O senhor/a senhora ainda está por aí? Como posso ajudar?"
                            disabled={data.inactivityNudgeMinutes === 0}
                            onChange={(inactivityNudgeText) => onChange({ inactivityNudgeText })}
                        />
                    </div>

                    <div className="border-t border-border pt-4">
                        <SettingsRow
                            title="Despedir-se e encerrar por inatividade"
                            description="Minutos depois da pergunta acima até o Agente se despedir e encerrar o atendimento. Zero deixa a conversa aberta."
                            action={
                                <div className="flex items-center gap-2">
                                    <Input
                                        type="number"
                                        min={0}
                                        max={43200}
                                        className="num w-[90px]"
                                        aria-label="Minutos até despedir-se e encerrar"
                                        disabled={data.inactivityNudgeMinutes === 0}
                                        value={String(data.inactivityCloseMinutes)}
                                        onChange={(e) => {
                                            const n = parseInt(e.target.value, 10)
                                            onChange({
                                                inactivityCloseMinutes: Number.isNaN(n)
                                                    ? 0
                                                    : Math.min(43200, Math.max(0, n)),
                                            })
                                        }}
                                    />
                                    <span className="text-sm text-muted-foreground">minutos</span>
                                </div>
                            }
                        />
                        <TextoDoAviso
                            id="pref-farewell-text"
                            rotulo="Mensagem de encerramento"
                            valor={data.inactivityFarewellText}
                            padrao="Devido à falta de interação, vou encerrar o atendimento por aqui. Se tiver qualquer dúvida, pode me chamar novamente — é só mandar uma mensagem."
                            disabled={data.inactivityNudgeMinutes === 0 || data.inactivityCloseMinutes === 0}
                            onChange={(inactivityFarewellText) => onChange({ inactivityFarewellText })}
                        />
                    </div>

                    <div className="border-t border-border pt-4">
                        <SettingsRow
                            title="Limite de interações por atendimento"
                            description={`Ao atingir o limite, o Agente para de responder, avisa ${comArtigo(v, 'pessoa')} e deixa a conversa para a equipe.`}
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

/**
 * O texto de um aviso automático da régua de inatividade.
 *
 * Três linhas no máximo, `*negrito*` do WhatsApp e emoji — é uma mensagem de
 * WhatsApp, e a tela diz isso em vez de deixar a pessoa descobrir no envio. O
 * `placeholder` é o texto do sistema: vazio significa "use esse", então quem
 * nunca escreveu continua vendo o que vai sair.
 *
 * A conta de linhas é a mesma do schema (`linhasDoAviso`): a tela avisa no
 * mesmo ponto em que a API recusaria.
 */
function TextoDoAviso({
    id,
    rotulo,
    valor,
    padrao,
    disabled,
    onChange,
}: {
    id: string
    rotulo: string
    valor: string
    padrao: string
    disabled?: boolean
    onChange: (texto: string) => void
}) {
    const linhas = linhasDoAviso(valor)
    const linhasDemais = linhas > MAX_LINHAS_DO_AVISO
    const longo = valor.length > MAX_CHARS_DO_AVISO

    const inserirEmoji = (emoji: string) => {
        const el = document.getElementById(id) as HTMLTextAreaElement | null
        const inicio = el?.selectionStart ?? valor.length
        const fim = el?.selectionEnd ?? valor.length
        onChange(valor.slice(0, inicio) + emoji + valor.slice(fim))
        requestAnimationFrame(() => {
            el?.focus()
            el?.setSelectionRange(inicio + emoji.length, inicio + emoji.length)
        })
    }

    return (
        <div className="mt-3 space-y-1.5">
            <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
                {rotulo}
            </label>
            <div className="relative">
                <Textarea
                    id={id}
                    value={valor}
                    rows={3}
                    disabled={disabled}
                    placeholder={padrao}
                    maxLength={MAX_CHARS_DO_AVISO + 50}
                    aria-invalid={linhasDemais || longo ? true : undefined}
                    onChange={(e) => onChange(e.target.value)}
                    className="min-h-[76px] resize-none pr-11 text-sm"
                />
                <EmojiPicker
                    onSelect={inserirEmoji}
                    disabled={disabled}
                    className="absolute bottom-1 right-1 size-8 text-muted-foreground hover:text-foreground"
                />
            </div>
            <p className={linhasDemais || longo ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
                {linhasDemais
                    ? `No máximo ${MAX_LINHAS_DO_AVISO} linhas — está com ${linhas}.`
                    : longo
                      ? `O texto passou de ${MAX_CHARS_DO_AVISO} caracteres.`
                      : `Até ${MAX_LINHAS_DO_AVISO} linhas. *Negrito* entre asteriscos e emojis valem. Vazio usa o texto padrão.`}
            </p>
        </div>
    )
}
