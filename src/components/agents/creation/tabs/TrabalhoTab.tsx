'use client'

import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { TrabalhoData } from '@/types/agent-creation'

interface TrabalhoTabProps {
    data: TrabalhoData
    onChange: (data: Partial<TrabalhoData>) => void
}

const setores = [
    'Tecnologia',
    'Saúde',
    'Educação',
    'Varejo',
    'Serviços Financeiros',
    'Indústria',
    'Construção',
    'Alimentação',
    'Transporte',
    'Imobiliário',
    'Consultoria',
    'Marketing',
    'Outro',
]

export function TrabalhoTab({ data, onChange }: TrabalhoTabProps) {
    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-2xl font-bold">Funções e atribuições no trabalho</h2>
                <p className="text-sm text-muted-foreground mt-1">
                    Essas instruções serão seguidas em todas as interações do agente de IA
                </p>
            </div>

            <div className="space-y-4">
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

                {/* Setor da empresa */}
                <div className="space-y-2">
                    <Label htmlFor="companySector">Setor da empresa</Label>
                    <Select
                        value={data.companySector}
                        onValueChange={(value) => onChange({ companySector: value })}
                    >
                        <SelectTrigger id="companySector">
                            <SelectValue placeholder="Selecionar" />
                        </SelectTrigger>
                        <SelectContent>
                            {setores.map((setor) => (
                                <SelectItem key={setor} value={setor.toLowerCase()}>
                                    {setor}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

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
        </div>
    )
}
