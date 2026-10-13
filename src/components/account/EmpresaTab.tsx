'use client'

import { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Upload } from 'lucide-react'
import { toast } from 'sonner'
import { PhoneInput } from '@/components/shared/PhoneInput'
import { FormField } from '@/components/shared/FormField'
import { MaskedInput } from '@/components/shared/MaskedInput'
import { BandLayout, SettingsBand } from '@/components/shared/TabsFrame'
import { MASKS, onlyDigits } from '@/lib/masks'
import { formatPhone, phoneIssue } from '@/lib/phone'

interface WorkspaceData {
    id: string
    name: string
    slug: string
    cnpj: string | null
    address: string | null
    phone: string | null
    logo: string | null
}

interface EmpresaTabProps {
    /** O id que liga o botão do fim do formulário ao `<form>`. */
    formId: string
    onSavingChange?: (saving: boolean) => void
}

export function EmpresaTab({ formId, onSavingChange }: EmpresaTabProps) {
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [workspace, setWorkspace] = useState<WorkspaceData | null>(null)
    const [formData, setFormData] = useState({
        cnpj: '',
        address: '',
        phone: '',
        logo: '',
    })
    const fileInputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        loadWorkspace()
    }, [])

    const loadWorkspace = async () => {
        try {
            const res = await fetch('/api/account/workspace')
            if (res.ok) {
                const data = await res.json()
                setWorkspace(data)
                setFormData({
                    // Guardado como dígitos; a pontuação é da tela.
                    cnpj: onlyDigits(data.cnpj),
                    address: data.address || '',
                    phone: formatPhone(data.phone),
                    logo: data.logo || '',
                })
            }
        } catch (error) {
            console.error('Error loading workspace:', error)
            toast.error('Erro ao carregar dados da empresa')
        } finally {
            setLoading(false)
        }
    }

    const handleSave = async () => {
        const phoneProblem = phoneIssue(formData.phone)
        if (phoneProblem) {
            toast.error(phoneProblem)
            return
        }
        setSaving(true)
        onSavingChange?.(true)
        try {
            const res = await fetch('/api/account/workspace', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            })

            if (res.ok) {
                const data = await res.json()
                setWorkspace(data)
                toast.success('Dados da empresa atualizados')
            } else {
                const error = await res.json()
                toast.error(error.error || 'Erro ao atualizar dados')
            }
        } catch (error) {
            toast.error('Erro ao atualizar dados da empresa')
        } finally {
            setSaving(false)
            onSavingChange?.(false)
        }
    }

    const handleLogoClick = () => {
        fileInputRef.current?.click()
    }

    const handleLogoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return

        // For now, create a local URL preview
        // In production, you would upload to storage and get a URL
        const reader = new FileReader()
        reader.onload = (event) => {
            const dataUrl = event.target?.result as string
            setFormData(prev => ({ ...prev, logo: dataUrl }))
        }
        reader.readAsDataURL(file)
    }

    // Format CNPJ as user types


    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <span className="text-muted-foreground">Carregando...</span>
            </div>
        )
    }

    return (
        <BandLayout
            footer={
                <>
                    {saving ? <p className="mr-auto text-xs text-muted-foreground">Salvando…</p> : null}
                    <Button type="submit" form={formId} size="sm" className="h-8" disabled={saving}>
                        Salvar dados da empresa
                    </Button>
                </>
            }
        >
            <form
                id={formId}
                onSubmit={(e) => {
                    e.preventDefault()
                    if (!saving) void handleSave()
                }}
            >
                <SettingsBand title="Identificação" description="Como a clínica aparece nos documentos e na cobrança.">
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        <FormField
                            label="Nome da empresa"
                            htmlFor="company-name"
                            hint="É o identificador do workspace e não muda por aqui."
                        >
                            <Input id="company-name" value={workspace?.name || ''} disabled />
                        </FormField>

                        <FormField label="CNPJ" htmlFor="cnpj">
                            <MaskedInput
                                id="cnpj"
                                mask={MASKS.cnpj}
                                value={formData.cnpj}
                                onChange={(digits) => setFormData(prev => ({ ...prev, cnpj: digits }))}
                            />
                        </FormField>
                    </div>
                </SettingsBand>

                <SettingsBand title="Contato" description="Onde a clínica fica e por onde falam com ela.">
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr]">
                        <FormField label="Endereço" htmlFor="address">
                            <Input
                                id="address"
                                value={formData.address}
                                onChange={(e) => setFormData(prev => ({ ...prev, address: e.target.value }))}
                                placeholder="Rua, número, bairro, cidade — UF"
                            />
                        </FormField>

                        <FormField label="Telefone" htmlFor="phone" hint="Com DDD.">
                            <PhoneInput
                                id="phone"
                                value={formData.phone}
                                onChange={(digits) => setFormData(prev => ({ ...prev, phone: digits }))}
                            />
                        </FormField>
                    </div>
                </SettingsBand>

                <SettingsBand
                    title="Logo"
                    description="Substitui a logo do OdontoBox360 no menu lateral. Até 160 × 25 px."
                    last
                >
                    {/* A área de soltar não precisa da largura da tela: sem
                        moldura, um alvo de ponta a ponta viraria uma faixa
                        vazia de 1400px. */}
                    <button
                        type="button"
                        onClick={handleLogoClick}
                        className="flex h-24 w-full max-w-md flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-border bg-background outline-none transition-colors hover:border-border-strong focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                        {formData.logo ? (
                            <img src={formData.logo} alt="Logo da empresa" className="max-h-16 max-w-[160px] object-contain" />
                        ) : (
                            <>
                                <Upload className="size-6 text-muted-foreground" />
                                <span className="text-sm text-muted-foreground">Escolher a imagem</span>
                                <span className="text-xs text-muted-foreground">PNG com fundo transparente fica melhor</span>
                            </>
                        )}
                    </button>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleLogoChange}
                    />
                </SettingsBand>
            </form>
        </BandLayout>
    )
}
