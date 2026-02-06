'use client'

import { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Camera, User } from 'lucide-react'
import { toast } from 'sonner'

interface UserProfile {
    id: string
    email: string
    name: string | null
    lastName: string | null
    phone: string | null
    avatar: string | null
}

export function PerfilTab() {
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
                    phone: data.phone || '',
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
        setSaving(true)
        try {
            const res = await fetch('/api/account/profile', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            })

            if (res.ok) {
                const data = await res.json()
                setProfile(data)
                toast.success('Perfil atualizado com sucesso!')
            } else {
                const error = await res.json()
                toast.error(error.error || 'Erro ao atualizar perfil')
            }
        } catch (error) {
            toast.error('Erro ao atualizar perfil')
        } finally {
            setSaving(false)
        }
    }

    const handleChangePassword = async () => {
        if (passwordData.newPassword !== passwordData.confirmPassword) {
            toast.error('As senhas não coincidem')
            return
        }

        if (passwordData.newPassword.length < 6) {
            toast.error('A nova senha deve ter pelo menos 6 caracteres')
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
                toast.success('Senha alterada com sucesso!')
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
                <span className="text-gray-400">Carregando...</span>
            </div>
        )
    }

    return (
        <div className="max-w-2xl space-y-8">
            {/* Avatar */}
            <div>
                <Label className="text-sm text-gray-400 mb-3 block">
                    (Avatar) Imagem do perfil do usuário
                </Label>
                <div
                    onClick={handleAvatarClick}
                    className="relative h-24 w-24 cursor-pointer rounded-lg bg-purple-600 flex items-center justify-center overflow-hidden group hover:opacity-90 transition-opacity"
                >
                    {formData.avatar ? (
                        <img
                            src={formData.avatar}
                            alt="Avatar"
                            className="h-full w-full object-cover"
                        />
                    ) : (
                        <User className="h-10 w-10 text-white" />
                    )}
                    <div className="absolute bottom-0 right-0 h-6 w-6 bg-purple-500 rounded-full flex items-center justify-center border-2 border-[#0A0E27]">
                        <Camera className="h-3 w-3 text-white" />
                    </div>
                </div>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleAvatarChange}
                />
            </div>

            {/* Name fields */}
            <div className="grid grid-cols-2 gap-4">
                <div>
                    <Label htmlFor="name" className="text-sm text-gray-400">
                        Nome
                    </Label>
                    <Input
                        id="name"
                        value={formData.name}
                        onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                        placeholder="Seu nome"
                        className="mt-2 bg-[#0A0E27] border-gray-700"
                    />
                </div>
                <div>
                    <Label htmlFor="lastName" className="text-sm text-gray-400">
                        Sobrenome
                    </Label>
                    <Input
                        id="lastName"
                        value={formData.lastName}
                        onChange={(e) => setFormData(prev => ({ ...prev, lastName: e.target.value }))}
                        placeholder="Seu sobrenome"
                        className="mt-2 bg-[#0A0E27] border-gray-700"
                    />
                </div>
            </div>

            {/* WhatsApp */}
            <div>
                <Label htmlFor="phone" className="text-sm text-gray-400">
                    Número do WhatsApp
                </Label>
                <div className="mt-2 flex gap-2">
                    <div className="flex items-center gap-2 px-3 py-2 bg-[#0A0E27] border border-gray-700 rounded-md text-sm">
                        <span>🇧🇷</span>
                        <span className="text-gray-400">Brazil (+55)</span>
                    </div>
                    <Input
                        id="phone"
                        value={formData.phone}
                        onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                        placeholder="(00) 99999-9999"
                        className="flex-1 bg-[#0A0E27] border-gray-700"
                    />
                </div>
            </div>

            {/* Email */}
            <div>
                <Label className="text-sm text-gray-400">
                    E-mail da conta
                </Label>
                <p className="text-xs text-gray-500 mt-1">
                    Para alterar o e-mail da conta, digite o novo e clique em 'Alterar e-mail da conta'
                </p>
                <div className="mt-2 flex gap-2">
                    <Input
                        value={profile?.email || ''}
                        disabled
                        className="flex-1 bg-[#0A0E27] border-gray-700 text-gray-400"
                    />
                    <Button variant="outline" className="border-gray-700 text-gray-300">
                        Alterar e-mail da conta
                    </Button>
                </div>
            </div>

            {/* Change Password Section */}
            <div className="border-t border-gray-800 pt-6">
                <h3 className="text-lg font-medium mb-4">Alterar senha</h3>
                <div className="space-y-4">
                    <div>
                        <Label htmlFor="currentPassword" className="text-sm text-gray-400">
                            Senha atual
                        </Label>
                        <Input
                            id="currentPassword"
                            type="password"
                            value={passwordData.currentPassword}
                            onChange={(e) => setPasswordData(prev => ({ ...prev, currentPassword: e.target.value }))}
                            placeholder="Digite sua senha atual"
                            className="mt-2 bg-[#0A0E27] border-gray-700"
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <Label htmlFor="newPassword" className="text-sm text-gray-400">
                                Nova senha
                            </Label>
                            <Input
                                id="newPassword"
                                type="password"
                                value={passwordData.newPassword}
                                onChange={(e) => setPasswordData(prev => ({ ...prev, newPassword: e.target.value }))}
                                placeholder="Digite a nova senha"
                                className="mt-2 bg-[#0A0E27] border-gray-700"
                            />
                        </div>
                        <div>
                            <Label htmlFor="confirmPassword" className="text-sm text-gray-400">
                                Confirmar nova senha
                            </Label>
                            <Input
                                id="confirmPassword"
                                type="password"
                                value={passwordData.confirmPassword}
                                onChange={(e) => setPasswordData(prev => ({ ...prev, confirmPassword: e.target.value }))}
                                placeholder="Confirme a nova senha"
                                className="mt-2 bg-[#0A0E27] border-gray-700"
                            />
                        </div>
                    </div>
                    <Button
                        onClick={handleChangePassword}
                        disabled={changingPassword || !passwordData.newPassword}
                        variant="outline"
                        className="border-gray-700"
                    >
                        {changingPassword ? 'Alterando...' : 'Alterar senha'}
                    </Button>
                </div>
            </div>

            {/* Save Button */}
            <div className="flex justify-end pt-4">
                <Button
                    onClick={handleSave}
                    disabled={saving}
                    className="bg-purple-600 hover:bg-purple-700"
                >
                    {saving ? 'Salvando...' : 'Atualizar Perfil'}
                </Button>
            </div>
        </div>
    )
}
