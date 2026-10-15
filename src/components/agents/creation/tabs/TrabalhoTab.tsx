'use client'

import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { TrabalhoData } from '@/types/agent-creation'

interface TrabalhoTabProps {
    data: TrabalhoData
    onChange: (data: Partial<TrabalhoData>) => void
}

/**
 * O setor não é uma escolha: o OdontoBox360 atende clínicas odontológicas.
 *
 * O seletor oferecia treze setores — Tecnologia, Varejo, Transporte — herdados
 * de um produto genérico. Escolher "Alimentação" aqui só servia para o agente
 * de uma clínica se descrever errado no prompt. O valor é fixo e aparece na
 * tela porque é informação que o Agente usa, não porque há o que decidir.
 */
export const SETOR_PADRAO = 'Clínica odontológica'

export function TrabalhoTab({ data, onChange }: TrabalhoTabProps) {
    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-[15px] font-bold">Funções e atribuições no trabalho</h2>
                <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                    Essas instruções serão seguidas em todas as interações do agente de IA
                </p>
            </div>

            <div className="space-y-4">
                {/* Os dois textos longos lado a lado: o que o Agente faz e o
                    que a clínica é. Empilhados, só eles valiam 280px de altura. */}
                <div className="grid items-start gap-4 lg:grid-cols-2">
                    {/* Funções e atribuições */}
                    <div className="space-y-2">
                        <Label htmlFor="jobDescription">Funções e atribuições</Label>
                        <Textarea
                            id="jobDescription"
                            placeholder="Digite as funções principais..."
                            value={data.jobDescription || ''}
                            onChange={(e) => onChange({ jobDescription: e.target.value })}
                            className="min-h-[120px]"
                        />
                    </div>
                    {/* Descrição da empresa */}
                    <div className="space-y-2">
                        <Label htmlFor="companyDescription">Fale sobre a sua empresa</Label>
                        <Textarea
                            id="companyDescription"
                            placeholder="Brevemente, fale sobre o que você vende, descreva seus serviços, destaque os principais benefícios e informe quem é seu público-alvo de forma simples e direta."
                            value={data.companyDescription || ''}
                            onChange={(e) => onChange({ companyDescription: e.target.value })}
                            className="min-h-[120px]"
                        />
                    </div>
                </div>

                {/* Quem é a empresa: nome e setor são respostas de uma linha. */}
                <div className="grid gap-4 sm:grid-cols-2">
                    {/* Nome da empresa */}
                    <div className="space-y-2">
                        <Label htmlFor="companyName">Nome da empresa</Label>
                        <p className="text-xs text-muted-foreground">
                            Para qual empresa o Agente irá trabalhar?
                        </p>
                        <Input
                            id="companyName"
                            placeholder="Ex: Bot de Atendimento"
                            value={data.companyName || ''}
                            onChange={(e) => onChange({ companyName: e.target.value })}
                        />
                    </div>

                    {/* Setor da empresa — fixo */}
                    <div className="space-y-2">
                        <Label htmlFor="companySector">Setor da empresa</Label>
                        <p className="text-xs text-muted-foreground">
                            Definido pelo produto, e informado ao Agente.
                        </p>
                        <Input id="companySector" value={SETOR_PADRAO} readOnly disabled />
                    </div>
                </div>

                {/* Onde a clínica fica, nas duas formas em que perguntam:
                    o endereço na rua e o endereço na web. `items-start` para o
                    campo curto não esticar na altura do longo. */}
                <div className="grid items-start gap-4 sm:grid-cols-2">
                    {/*
                      * O endereço do site, não o conteúdo dele.
                      *
                      * Este campo entra no prompt como um dado de identidade da
                      * clínica — do mesmo naipe de "nome" e "setor" —, para o agente
                      * poder informar o endereço a quem perguntar. A página **não** é
                      * lida aqui. Quem ensina o conteúdo ao agente é a seção
                      * Websites do Cérebro, que baixa a página e a indexa. Sem dizer
                      * isto na tela, ter "site" em dois lugares faz a clínica supor
                      * que preencher aqui já treina o agente.
                      */}
                    <div className="space-y-2">
                        <Label htmlFor="companyWebsite">Site da empresa (se houver)</Label>
                        <p className="text-xs text-muted-foreground">
                            Só o endereço, para o Agente saber informá-lo. Para que ele
                            aprenda o conteúdo das páginas, adicione-as em Cérebro → Websites.
                        </p>
                        <Input
                            id="companyWebsite"
                            type="url"
                            placeholder="Ex: https://suaclinica.com.br"
                            value={data.companyWebsite || ''}
                            onChange={(e) => onChange({ companyWebsite: e.target.value })}
                        />
                    </div>
                    {/* Endereço da unidade */}
                    <div className="space-y-2">
                        <Label htmlFor="companyAddress">Endereço completo</Label>
                        <p className="text-xs text-muted-foreground">
                            Logradouro, número, complemento, bairro, cidade, estado e CEP da
                            unidade que este Agente atende. É o que ele responde a quem
                            pergunta onde vocês ficam.
                        </p>
                        <Textarea
                            id="companyAddress"
                            placeholder="Ex: Av. Afonso Pena, 1500, sala 302 — Centro, Belo Horizonte/MG, 30130-005"
                            value={data.companyAddress || ''}
                            onChange={(e) => onChange({ companyAddress: e.target.value })}
                            className="min-h-[80px] resize-none"
                        />
                    </div>
                </div>

            </div>
        </div>
    )
}
