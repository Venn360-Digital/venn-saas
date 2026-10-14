'use client'

import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Slider } from '@/components/ui/slider'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { OPENAI_MODELS } from '@/lib/llm/models'
import { InstrucoesData } from '@/types/agent-creation'

/**
 * A instrução livre do agente, o modelo e a temperatura.
 *
 * Os três existiam no banco e não tinham tela. O único lugar que os editava era
 * um diálogo que **nunca foi alcançável** — o estado que o abria não era
 * chamado de lugar nenhum —, então na prática a clínica não podia escrever uma
 * instrução própria, nem trocar de modelo, nem mexer na criatividade da
 * resposta. Todo agente nascia em `gpt-4o` a 0,7 e ficava lá.
 *
 * A instrução aqui é **só o que é específico da clínica**. Nome, empresa,
 * endereço, função, tom, idioma e base de conhecimento são montados pelo worker
 * a partir dos campos das outras abas — repetir isso aqui faria o modelo receber
 * a mesma informação duas vezes, que era exatamente o defeito do prompt gerado
 * por modelo que existia antes.
 */

interface InstrucoesTabProps {
    data: InstrucoesData
    onChange: (data: Partial<InstrucoesData>) => void
}

/** O teto do controle. O banco aceita até 2, que já não é conversa, é sorteio. */
const TEMPERATURA_MAX = 1.5

function descreveTemperatura(valor: number): string {
    if (valor <= 0.2) return 'Quase sempre a mesma resposta para a mesma pergunta. Bom para preço e regra.'
    if (valor <= 0.5) return 'Pouca variação. Previsível, com alguma naturalidade.'
    if (valor <= 0.9) return 'Equilíbrio entre naturalidade e consistência.'
    if (valor <= 1.2) return 'Respostas mais variadas. Cuidado: mais chance de inventar o que não sabe.'
    return 'Muito imprevisível. Não recomendado para atendimento de clínica.'
}

export function InstrucoesTab({ data, onChange }: InstrucoesTabProps) {
    const temperatura = data.temperature ?? 0.7

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-2xl font-bold">Instruções do Agente</h2>
                <p className="text-sm text-muted-foreground mt-1">
                    O que ele deve seguir além do que já está nas outras abas
                </p>
            </div>

            <div className="space-y-6">
                {/* Instrução livre */}
                <div className="space-y-2">
                    <Label htmlFor="systemPrompt">Instrução livre</Label>
                    <p className="text-xs text-muted-foreground">
                        Regras de conduta que só a sua clínica tem. O Agente já recebe
                        automaticamente o nome e o endereço da clínica, suas atribuições, o tom
                        de voz, o idioma e a base de conhecimento — não precisa repetir nada
                        disso aqui.
                    </p>
                    <Textarea
                        id="systemPrompt"
                        className="min-h-[180px]"
                        placeholder={
                            'Ex: Nunca prometa prazo de tratamento sem avaliação presencial. ' +
                            'Se perguntarem sobre dor, acolha e ofereça encaixe no mesmo dia.'
                        }
                        value={data.systemPrompt ?? ''}
                        onChange={(e) => onChange({ systemPrompt: e.target.value })}
                    />
                    <p className="text-xs text-muted-foreground">
                        Mínimo de 10 caracteres. Deixe como está se não tiver nada a acrescentar.
                    </p>
                </div>

                {/* Modelo */}
                <div className="space-y-2">
                    <Label htmlFor="llmModel">Modelo</Label>
                    <p className="text-xs text-muted-foreground">
                        O mais capaz entende melhor pedido confuso e mensagem desencontrada; o
                        mais barato dá conta da pergunta de rotina. Em resposta curta os dois
                        consomem 1 crédito — a economia aparece em conversa longa e em base de
                        conhecimento grande.
                    </p>
                    <Select
                        value={data.llmModel}
                        onValueChange={(llmModel) => onChange({ llmModel })}
                    >
                        <SelectTrigger id="llmModel">
                            <SelectValue placeholder="Escolher modelo" />
                        </SelectTrigger>
                        <SelectContent>
                            {OPENAI_MODELS.map((modelo) => (
                                <SelectItem key={modelo.id} value={modelo.id}>
                                    {modelo.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                {/* Temperatura */}
                <div className="space-y-3 rounded-lg border bg-card p-4">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <Label className="text-base font-medium">Criatividade das respostas</Label>
                            <p className="text-sm text-muted-foreground">
                                Quanto o Agente pode variar a forma de responder
                            </p>
                        </div>
                        <span className="num shrink-0 text-sm font-medium">
                            {temperatura.toFixed(1)}
                        </span>
                    </div>

                    <Slider
                        value={[temperatura]}
                        onValueChange={([temperature]) => onChange({ temperature })}
                        min={0}
                        max={TEMPERATURA_MAX}
                        step={0.1}
                        aria-label="Criatividade das respostas"
                    />

                    <p className="text-xs text-muted-foreground">{descreveTemperatura(temperatura)}</p>
                </div>
            </div>
        </div>
    )
}
