'use client'

import { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Upload } from 'lucide-react'
import { toast } from 'sonner'
import { PhoneInput } from '@/components/shared/PhoneInput'

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
    /** The page renders the Salvar button in its header and submits this form by id. */
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
                    cnpj: data.cnpj || '',
                    address: data.address || '',
                    phone: data.phone || '',
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
    const formatCNPJ = (value: string) => {
        const digits = value.replace(/\D/g, '')
        if (digits.length <= 2) return digits
        if (digits.length <= 5) return `${digits.slice(0, 2)}.${digits.slice(2)}`
        if (digits.length <= 8) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5)}`
        if (digits.length <= 12) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8)}`
        return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12, 14)}`
    }


    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <span className="text-muted-foreground">Carregando...</span>
            </div>
        )
    }

    return (
        <form
            id={formId}
            className="max-w-2xl space-y-6"
            onSubmit={(e) => {
                e.preventDefault()
                if (!saving) void handleSave()
            }}
        >
            {/* Company Name (Read-only) */}
            <div>
                <Label className="text-sm text-muted-foreground">
                    Nome da empresa
                </Label>
                <Input
                    value={workspace?.name || ''}
                    disabled
                    className="mt-2 text-muted-foreground"
                />
                <p className="text-xs text-muted-foreground mt-1">
                    Este é o identificador do seu workspace e não pode ser alterado.
                </p>
            </div>

            {/* CNPJ */}
            <div>
                <Label htmlFor="cnpj" className="text-sm text-muted-foreground">
                    CNPJ
                </Label>
                <Input
                    id="cnpj"
                    value={formData.cnpj}
                    onChange={(e) => setFormData(prev => ({
                        ...prev,
                        cnpj: formatCNPJ(e.target.value)
                    }))}
                    placeholder="00.000.000/0000-00"
                    maxLength={18}
                    className="mt-2"
                />
            </div>

            {/* Address */}
            <div>
                <Label htmlFor="address" className="text-sm text-muted-foreground">
                    Endereço
                </Label>
                <Input
                    id="address"
                    value={formData.address}
                    onChange={(e) => setFormData(prev => ({ ...prev, address: e.target.value }))}
                    placeholder="Rua, número, bairro, cidade - UF"
                    className="mt-2"
                />
            </div>

            {/* Phone */}
            <div>
                <Label htmlFor="phone" className="text-sm text-muted-foreground">
                    Telefone
                </Label>
                <PhoneInput
                    id="phone"
                    value={formData.phone}
                    onChange={(digits) => setFormData(prev => ({ ...prev, phone: digits }))}
                    className="mt-2"
                />
            </div>

            {/* Logo */}
            <div>
                <Label className="text-sm text-muted-foreground">
                    Logo da empresa
                </Label>
                <p className="text-xs text-muted-foreground mt-1">
                    A logo da empresa substituirá a logo do OdontoBox360 no menu lateral. O tamanho máximo da imagem deve ser 160px de largura por 25px de altura.
                </p>
                <div
                    onClick={handleLogoClick}
                    className="mt-3 flex flex-col items-center justify-center h-32 border-2 border-dashed border-border rounded-lg bg-card cursor-pointer hover:border-border-strong transition-colors"
                >
                    {formData.logo ? (
                        <img
                            src={formData.logo}
                            alt="Logo"
                            className="max-h-20 max-w-[160px] object-contain"
                        />
                    ) : (
                        <>
                            <Upload className="h-8 w-8 text-muted-foreground mb-2" />
                            <span className="text-sm text-muted-foreground">Tamanho recomendado da imagem:</span>
                            <span className="text-sm text-muted-foreground">25px de altura por 160px de largura</span>
                        </>
                    )}
                </div>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleLogoChange}
                />
            </div>

        </form>
    )
}
