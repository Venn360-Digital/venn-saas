'use client'

import { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Camera, User } from 'lucide-react'
import { toast } from 'sonner'
import { PhoneInput } from '@/components/shared/PhoneInput'
import { FormField } from '@/components/shared/FormField'
import { FormActions, SettingsCard } from '@/components/shared/TabsFrame'
import { formatPhone, phoneIssue } from '@/lib/phone'

interface UserProfile {
    id: string
    email: string
    name: string | null
    lastName: string | null
    phone: string | null
    avatar: string | null
}

interface PerfilTabProps {
    /** O id que liga o botão do fim do formulário ao `<form>`. */
    formId: string
    onSavingChange?: (saving: boolean) => void
}

export function PerfilTab({ formId, onSavingChange }: PerfilTabProps) {
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [profile, setProfile] = useState<UserProfile | null>(null)
    const [formData, setFormData] = useState({
        name: '',
        lastName: '',
        phone: '',
        avatar: '',
    })
    const [passwordData, setPasswordData] = useState({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
    })
    const [changingPassword, setChangingPassword] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        loadProfile()
    }, [])

    const loadProfile = async () => {
        try {
            const res = await fetch('/api/account/profile')
            if (res.ok) {
                const data = await res.json()
                setProfile(data)
                setFormData({
                    name: data.name || '',
                    lastName: data.lastName || '',
                    phone: formatPhone(data.phone),
                    avatar: data.avatar || '',
                })
            }
        } catch (error) {
            console.error('Error loading profile:', error)
            toast.error('Erro ao carregar perfil')
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
            const res = await fetch('/api/account/profile', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            })

            if (res.ok) {
                const data = await res.json()
                setProfile(data)
                toast.success('Perfil atualizado')
            } else {
                const error = await res.json()
                toast.error(error.error || 'Erro ao atualizar perfil')
            }
        } catch (error) {
            toast.error('Erro ao atualizar perfil')
        } finally {
            setSaving(false)
            onSavingChange?.(false)
        }
    }

    const handleChangePassword = async () => {
        if (passwordData.newPassword !== passwordData.confirmPassword) {
            toast.error('As senhas não coincidem')
            return
        }

        // Matches the API, which now enforces 8.
        if (passwordData.newPassword.length < 8) {
            toast.error('A nova senha deve ter pelo menos 8 caracteres')
            return
        }

        setChangingPassword(true)
        try {
            const res = await fetch('/api/account/profile/password', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    currentPassword: passwordData.currentPassword,
                    newPassword: passwordData.newPassword,
                })
            })

            if (res.ok) {
                toast.success('Senha alterada')
                setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' })
            } else {
                const error = await res.json()
                toast.error(error.error || 'Erro ao alterar senha')
            }
        } catch (error) {
            toast.error('Erro ao alterar senha')
        } finally {
            setChangingPassword(false)
        }
    }

    const handleAvatarClick = () => {
        fileInputRef.current?.click()
    }

    const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return

        // For now, create a local URL preview
        // In production, you would upload to storage and get a URL
        const reader = new FileReader()
        reader.onload = (event) => {
            const dataUrl = event.target?.result as string
            setFormData(prev => ({ ...prev, avatar: dataUrl }))
        }
        reader.readAsDataURL(file)
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
            className="space-y-4"
            onSubmit={(e) => {
                e.preventDefault()
                if (!saving) void handleSave()
            }}
        >
            <SettingsCard title="Foto" description="Aparece no seu perfil e ao lado do que você responde.">
                <div className="flex items-center gap-4">
                    <button
                        type="button"
                        onClick={handleAvatarClick}
                        aria-label="Trocar a foto do perfil"
                        className="group relative size-16 shrink-0 overflow-hidden rounded-xl bg-primary-subtle outline-none transition-opacity hover:opacity-90 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                        {formData.avatar ? (
                            <img src={formData.avatar} alt="" className="size-full object-cover" />
                        ) : (
                            <User className="absolute inset-0 m-auto size-7 text-primary-subtle-foreground" />
                        )}
                        <span className="absolute inset-x-0 bottom-0 flex h-5 items-center justify-center bg-foreground/70">
                            <Camera className="size-3 text-background" />
                        </span>
                    </button>
                    <div className="min-w-0">
                        <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5" onClick={handleAvatarClick}>
                            <Camera className="size-3.5" /> Trocar foto
                        </Button>
                        <p className="mt-1.5 text-xs text-muted-foreground">PNG ou JPG, até 2 MB.</p>
                    </div>
                </div>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleAvatarChange}
                />
            </SettingsCard>

            <SettingsCard title="Dados">
                <div className="grid gap-4 sm:grid-cols-2">
                    <FormField label="Nome" htmlFor="name" required>
                        <Input
                            id="name"
                            value={formData.name}
                            onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                            placeholder="Seu nome"
                            autoComplete="given-name"
                        />
                    </FormField>

                    <FormField label="Sobrenome" htmlFor="lastName">
                        <Input
                            id="lastName"
                            value={formData.lastName}
                            onChange={(e) => setFormData(prev => ({ ...prev, lastName: e.target.value }))}
                            placeholder="Seu sobrenome"
                            autoComplete="family-name"
                        />
                    </FormField>

                    <FormField label="WhatsApp" htmlFor="phone" hint="Com DDD. É por ele que a equipe te encontra.">
                        <PhoneInput
                            id="phone"
                            value={formData.phone}
                            onChange={(digits) => setFormData(prev => ({ ...prev, phone: digits }))}
                        />
                    </FormField>

                    <FormField
                        label="E-mail da conta"
                        htmlFor="account-email"
                        hint="É o seu login. Trocar pede confirmação no endereço novo."
                    >
                        <div className="flex gap-2">
                            <Input id="account-email" value={profile?.email || ''} disabled className="flex-1" />
                            <Button type="button" variant="outline" className="shrink-0">
                                Alterar
                            </Button>
                        </div>
                    </FormField>
                </div>
            </SettingsCard>

            <SettingsCard
                title="Senha"
                description="Trocar a senha encerra as outras sessões abertas."
                footer={
                    <>
                        <p className="text-xs text-muted-foreground">Mínimo de 8 caracteres.</p>
                        <Button
                            type="button"
                            onClick={handleChangePassword}
                            disabled={changingPassword || !passwordData.newPassword}
                            variant="outline"
                            size="sm"
                            className="h-8"
                        >
                            {changingPassword ? 'Alterando…' : 'Alterar senha'}
                        </Button>
                    </>
                }
            >
                <div className="grid gap-4 sm:grid-cols-3">
                    <FormField label="Senha atual" htmlFor="currentPassword">
                        <Input
                            id="currentPassword"
                            type="password"
                            value={passwordData.currentPassword}
                            onChange={(e) => setPasswordData(prev => ({ ...prev, currentPassword: e.target.value }))}
                            autoComplete="current-password"
                        />
                    </FormField>
                    <FormField label="Nova senha" htmlFor="newPassword">
                        <Input
                            id="newPassword"
                            type="password"
                            value={passwordData.newPassword}
                            onChange={(e) => setPasswordData(prev => ({ ...prev, newPassword: e.target.value }))}
                            autoComplete="new-password"
                        />
                    </FormField>
                    <FormField label="Confirmar" htmlFor="confirmPassword">
                        <Input
                            id="confirmPassword"
                            type="password"
                            value={passwordData.confirmPassword}
                            onChange={(e) => setPasswordData(prev => ({ ...prev, confirmPassword: e.target.value }))}
                            autoComplete="new-password"
                        />
                    </FormField>
                </div>
            </SettingsCard>

            {/* Gravar é do formulário e fica com ele: no cabeçalho da tela de
                guias o botão parecia valer para todas as guias. */}
            <FormActions hint={saving ? 'Salvando…' : undefined}>
                <Button type="submit" form={formId} size="sm" className="h-8" disabled={saving}>
                    Salvar perfil
                </Button>
            </FormActions>
        </form>
    )
}
