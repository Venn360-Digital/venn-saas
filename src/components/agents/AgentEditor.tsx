'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { Agent } from '@prisma/client'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/components/ui/form'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

const formSchema = z.object({
    name: z.string().min(2, 'Nome deve ter pelo menos 2 caracteres'),
    description: z.string().optional(),
    llmProvider: z.enum(['openai', 'gemini', 'claude']),
    llmModel: z.string().min(1, 'Selecione um modelo'),
    systemPrompt: z.string().min(10, 'Prompt deve ter pelo menos 10 caracteres'),
    temperature: z.number().min(0).max(2).default(0.7),
    primaryColor: z.string().optional(),
    voiceTone: z.string().optional(),
    language: z.string().default('pt-BR'),
    isActive: z.boolean().default(true),
})

/**
 * Entrada e saída do schema divergem por causa dos `.default()`: na entrada
 * `temperature`, `language` e `isActive` são opcionais; na saída, obrigatórios.
 * O useForm precisa dos dois para o resolver encaixar sem asserção.
 */
type FormInput = z.input<typeof formSchema>
type FormValues = z.output<typeof formSchema>

interface AgentEditorProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    agent?: Agent | null
    workspaceId: string // In MVP we pass this, later context/hook
    onSuccess: () => void
}

export function AgentEditor({
    open,
    onOpenChange,
    agent,
    workspaceId,
    onSuccess,
}: AgentEditorProps) {
    const [loading, setLoading] = useState(false)

    const defaultValues: FormValues = agent
        ? {
            name: agent.name,
            description: agent.description || '',
            llmProvider: agent.llmProvider as 'openai' | 'gemini' | 'claude',
            llmModel: agent.llmModel,
            systemPrompt: agent.systemPrompt,
            temperature: agent.temperature,
            primaryColor: agent.primaryColor,
            voiceTone: agent.voiceTone || '',
            language: agent.language,
            isActive: agent.isActive,
        }
        : {
            name: '',
            description: '',
            llmProvider: 'openai',
            llmModel: 'gpt-4o',
            systemPrompt: 'Você é um assistente útil e amigável.',
            temperature: 0.7,
            primaryColor: '#3B82F6',
            voiceTone: 'casual',
            language: 'pt-BR',
            isActive: true,
        }

    const form = useForm<FormInput, unknown, FormValues>({
        resolver: zodResolver(formSchema),
        defaultValues,
        values: defaultValues, // Reactive update when agent changes
    })

    const onSubmit = async (values: FormValues) => {
        setLoading(true)
        try {
            const url = agent ? `/api/agents/${agent.id}` : `/api/agents?workspaceId=${workspaceId}`
            const method = agent ? 'PATCH' : 'POST'

            const response = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(values),
            })

            if (!response.ok) {
                throw new Error('Falha ao salvar agente')
            }

            toast.success(agent ? 'Agente atualizado!' : 'Agente criado com sucesso!')
            onSuccess()
            onOpenChange(false)
            form.reset()
        } catch (error) {
            toast.error('Erro ao salvar agente. Tente novamente.')
            console.error(error)
        } finally {
            setLoading(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[600px]">
                <DialogHeader>
                    <DialogTitle>{agent ? 'Editar Agente' : 'Novo Agente'}</DialogTitle>
                    <DialogDescription>
                        Configure a personalidade e inteligência do seu agente.
                    </DialogDescription>
                </DialogHeader>

                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <FormField
                                control={form.control}
                                name="name"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Nome</FormLabel>
                                        <FormControl>
                                            <Input placeholder="Ex: Atendente Virtual" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="isActive"
                                render={({ field }) => (
                                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm mt-8">
                                        <div className="space-y-0.5">
                                            <FormLabel>Ativo</FormLabel>
                                        </div>
                                        <FormControl>
                                            <Switch
                                                checked={field.value}
                                                onCheckedChange={field.onChange}
                                            />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                        </div>

                        <FormField
                            control={form.control}
                            name="description"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Descrição (Interna)</FormLabel>
                                    <FormControl>
                                        <Input placeholder="Qual o propósito deste agente?" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <div className="grid grid-cols-2 gap-4">
                            <FormField
                                control={form.control}
                                name="llmProvider"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Provedor IA</FormLabel>
                                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                                            <FormControl>
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Selecione..." />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                <SelectItem value="openai">OpenAI (GPT)</SelectItem>
                                                <SelectItem value="gemini">Google Gemini</SelectItem>
                                                <SelectItem value="claude">Anthropic Claude</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="llmModel"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Modelo</FormLabel>
                                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                                            <FormControl>
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Selecione..." />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                <SelectItem value="gpt-4o">GPT-4o (Mais Inteligente)</SelectItem>
                                                <SelectItem value="gpt-3.5-turbo">GPT-3.5 Turbo (Rápido)</SelectItem>
                                                <SelectItem value="gemini-1.5-pro">Gemini 1.5 Pro</SelectItem>
                                                <SelectItem value="gemini-1.5-flash">Gemini 1.5 Flash</SelectItem>
                                                <SelectItem value="claude-3-5-sonnet-20241022">Claude 3.5 Sonnet</SelectItem>
                                                <SelectItem value="claude-3-opus-20240229">Claude 3 Opus</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        <FormField
                            control={form.control}
                            name="systemPrompt"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>System Prompt (Personalidade)</FormLabel>
                                    <FormControl>
                                        <Textarea
                                            placeholder="Instruções base para o agente..."
                                            className="min-h-[150px] font-mono text-sm"
                                            {...field}
                                        />
                                    </FormControl>
                                    <FormDescription>
                                        Defina como o agente deve se comportar, o que ele sabe e o que não sabe.
                                    </FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <div className="grid grid-cols-2 gap-4">
                            <FormField
                                control={form.control}
                                name="voiceTone"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Tom de Voz</FormLabel>
                                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                                            <FormControl>
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Selecione..." />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                <SelectItem value="formal">Formal</SelectItem>
                                                <SelectItem value="casual">Casual</SelectItem>
                                                <SelectItem value="friendly">Amigável</SelectItem>
                                                <SelectItem value="enthusiastic">Entusiasmado</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="temperature"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Criatividade (0-2)</FormLabel>
                                        <FormControl>
                                            <Input
                                                type="number"
                                                step="0.1"
                                                min="0"
                                                max="2"
                                                {...field}
                                                onChange={e => field.onChange(parseFloat(e.target.value))}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                                Cancelar
                            </Button>
                            <Button type="submit" disabled={loading}>
                                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                {agent ? 'Salvar Alterações' : 'Criar Agente'}
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    )
}
