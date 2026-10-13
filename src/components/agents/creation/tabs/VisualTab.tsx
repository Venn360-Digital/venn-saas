'use client'

import { useEffect, useMemo, useRef } from 'react'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import { VisualData } from '@/types/agent-creation'
import { cn } from '@/lib/utils'

/**
 * A aba Visual, reduzida ao que existe.
 *
 * Saíram os quatro seletores de cor e o preview que eles pintavam: `visualConfig`
 * só teria efeito no widget do site, que não existe, e a decisão foi o widget
 * nascer na paleta do sistema em vez de cada clínica pintar o seu. Eram quatro
 * controles que não mudavam nada em nenhum canal.
 *
 * Ficou a imagem — que agora é mesmo gravada. A tela antes lia o arquivo como
 * data URL e mandava no PATCH, onde o campo era descartado pela validação; o
 * arquivo agora é guardado no estado e sobe para `/api/agents/[id]/avatar`
 * depois que o agente existe, porque o caminho no Storage é escopado por agente.
 */

interface VisualTabProps {
    data: VisualData
    onChange: (data: Partial<VisualData>) => void
}

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp']
const MAX_BYTES = 2 * 1024 * 1024

export function VisualTab({ data, onChange }: VisualTabProps) {
    const fileInputRef = useRef<HTMLInputElement>(null)

    /**
     * O preview do arquivo recém-escolhido é um blob URL, não um data URL: a
     * imagem não precisa virar texto para ser exibida.
     *
     * Derivado do arquivo, não guardado em estado — um `setState` dentro do
     * efeito renderizaria duas vezes a cada escolha. O efeito abaixo só existe
     * para revogar: sem isso, cada troca de imagem deixa um objeto preso na
     * memória da aba.
     */
    const localPreview = useMemo(
        () => (data.avatarFile ? URL.createObjectURL(data.avatarFile) : null),
        [data.avatarFile]
    )

    useEffect(() => {
        if (!localPreview) return
        return () => URL.revokeObjectURL(localPreview)
    }, [localPreview])

    const preview = localPreview ?? data.avatar ?? null

    const handleSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0]
        // Limpa o input para que escolher o mesmo arquivo de novo volte a disparar.
        event.target.value = ''
        if (!file) return

        if (!ALLOWED_TYPES.includes(file.type)) {
            toast.error('Formato não suportado. Envie PNG, JPG ou WEBP.')
            return
        }

        if (file.size > MAX_BYTES) {
            toast.error('Imagem maior que 2 MB. Envie uma versão menor.')
            return
        }

        onChange({ avatarFile: file })
    }

    const handleRemove = () => {
        onChange({ avatarFile: null, avatar: '' })
    }

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-2xl font-bold">Personalize o seu Agente</h2>
                <p className="text-sm text-muted-foreground mt-1">
                    A imagem identifica o Agente para a sua equipe dentro do OdontoBox360
                </p>
            </div>

            <div className="space-y-3">
                <div>
                    <Label>Imagem do Agente</Label>
                    <p className="text-xs text-muted-foreground">
                        Aparece na lista de agentes e nas conversas, para quem atende.
                        Nos canais conectados o paciente continua vendo a foto da conta
                        de WhatsApp, Instagram ou Facebook da clínica — essa imagem não
                        substitui a do canal.
                    </p>
                </div>

                <div className="flex items-center gap-4">
                    <div
                        className={cn(
                            'flex h-20 w-20 items-center justify-center overflow-hidden rounded-full border-2 border-dashed',
                            preview ? 'border-transparent' : 'border-muted-foreground/25'
                        )}
                    >
                        {preview ? (
                            // Imagem de origem variável (Storage ou blob local), fora
                            // do alcance do next/image sem configurar remotePatterns.
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                                src={preview}
                                alt="Imagem do agente"
                                className="h-full w-full object-cover"
                            />
                        ) : (
                            <span className="text-3xl text-muted-foreground">A</span>
                        )}
                    </div>

                    <div className="flex items-center gap-2">
                        <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
                            <Upload className="mr-2 h-4 w-4" />
                            {preview ? 'Alterar imagem' : 'Enviar imagem'}
                        </Button>

                        {preview && (
                            <Button variant="ghost" onClick={handleRemove}>
                                <X className="mr-2 h-4 w-4" />
                                Remover
                            </Button>
                        )}
                    </div>

                    <input
                        ref={fileInputRef}
                        type="file"
                        accept={ALLOWED_TYPES.join(',')}
                        className="hidden"
                        onChange={handleSelect}
                    />
                </div>

                <p className="text-xs text-muted-foreground">
                    PNG, JPG ou WEBP, até 2 MB. A imagem é enviada quando você salva o Agente.
                </p>
            </div>
        </div>
    )
}
