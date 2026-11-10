'use client'

import { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Camera, Save, ShieldCheck, User } from 'lucide-react'
import { toast } from 'sonner'
import { PhoneInput } from '@/components/shared/PhoneInput'
import { FormField } from '@/components/shared/FormField'
import { BandLayout, SettingsBand } from '@/components/shared/TabsFrame'
import { formatPhone, phoneIssue } from '@/lib/phone'
import { usePermissions } from '@/hooks/usePermissions'
import { ALCANCE_DO_PAPEL, ROTULO_DO_PAPEL } from '@/lib/papeis'
import { Badge } from '@/components/ui/badge'

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
    /**
     * O papel de quem está logado, mostrado ao lado da foto.
     *
     * Vem de `/api/me` pelo mesmo caminho que todo o resto do produto usa para
     * decidir o que exibir — não de um campo do perfil. O papel é da **relação**
     * entre a pessoa e a unidade, não da pessoa: a mesma conta pode ser
     * Administrador numa clínica e Atendente em outra, e é o papel na unidade
     * aberta que explica o que a tela deixa fazer.
     *
     * Enquanto `loading`, nada é dito. Chutar um papel aqui seria anunciar uma
     * permissão errada por meio segundo — e esta é uma tela onde a pessoa vem
     * justamente conferir o que ela é.
     */
    const permissoes = usePermissions()
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
        <BandLayout
            footer={
                <>
                    {saving ? <p className="mr-auto text-xs text-muted-foreground">Salvando…</p> : null}
                    <Button type="submit" form={formId} size="sm" className="h-8" disabled={saving}>
                        <Save className="size-4" />
                        Salvar perfil
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
                {/*
                  * **Um card só, e não três faixas** — pedido do Andre em
                  * 2026-11-09.
                  *
                  * A guia tinha "Foto", "Dados" e "Senha" como três faixas
                  * nomeadas, separadas por fio: três títulos em caixa alta
                  * para seis campos que são todos a mesma coisa — o cadastro
                  * de quem está logado. O agrupamento não informava nada que
                  * o próprio campo já não dissesse, e dividia uma tela curta
                  * em três blocos.
                  *
                  * Agora é uma faixa só, "Informações do usuário", com os
                  * grupos separados por respiro em vez de fio. A senha fica
                  * dentro dela: é campo do usuário como os outros, e o que a
                  * distingue — gravação à parte, pelo botão colado no último
                  * campo — continua dito onde acontece.
                  */}
                <SettingsBand title="Informações do usuário" last>
                    {/* **O título fora, os campos dentro de um cartão com
                        borda** — pedido do Andre em 2026-11-10, e o modelo é a
                        Conta da Clínica: `rounded-lg border-border p-4`, o
                        mesmo raio e a mesma borda de cada unidade. **Sem teto
                        de largura**: o cartão acompanha a tela, recuado só pela
                        margem que a `SettingsBand` aplica — igual às unidades
                        da conta, que é a referência que o Andre apontou em
                        2026-11-10 (DESIGN.md §5, "Cartão em guia").

                        A passada anterior juntou as três faixas numa (Foto,
                        Dados e Senha viraram "Informações do usuário") e
                        separou os grupos por respiro. Faltava a moldura: sem
                        ela os campos ficavam soltos sobre a superfície da
                        guia, enquanto a guia vizinha já desenhava cartão — as
                        duas gramáticas na mesma tela que ele apontou na Conta
                        da Clínica, aqui pela mesma razão. O título continua
                        **do lado de fora**, como rótulo da faixa, porque é ele
                        que diz o assunto; o cartão só agrupa. */}
                    <div className="rounded-lg border border-border p-4">
                    <div className="flex items-center gap-4">
                        <button
                            type="button"
                            onClick={handleAvatarClick}
                            aria-label="Trocar a foto do perfil"
                            className="group relative size-14 shrink-0 overflow-hidden rounded-xl bg-primary-subtle outline-none transition-opacity hover:opacity-90 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                        >
                            {formData.avatar ? (
                                <img src={formData.avatar} alt="" className="size-full object-cover" />
                            ) : (
                                <User className="absolute inset-0 m-auto size-6 text-primary-subtle-foreground" />
                            )}
                            <span className="absolute inset-x-0 bottom-0 flex h-4 items-center justify-center bg-foreground/70">
                                <Camera className="size-2.5 text-background" />
                            </span>
                        </button>
                        <div className="min-w-0">
                            <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5" onClick={handleAvatarClick}>
                                <Camera className="size-3.5" /> Trocar foto
                            </Button>
                            <p className="mt-1.5 text-xs text-muted-foreground">PNG ou JPG, até 2 MB.</p>
                        </div>

                        {/*
                          * A permissão, na linha da foto e à direita — pedido do
                          * Andre em 2026-11-05.
                          *
                          * `ml-auto` em vez de uma terceira coluna: o papel é a
                          * informação mais estável da tela (ninguém troca o
                          * próprio papel aqui, nem deve poder) e empurrá-lo para
                          * a borda o separa dos controles que a pessoa veio
                          * mexer. É leitura, não campo — por isso crachá e não
                          * `Input` desabilitado, que prometeria edição.
                          */}
                        {permissoes.role ? (
                            <div className="ml-auto min-w-0 text-right">
                                <p className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
                                    Sua permissão
                                </p>
                                <Badge variant="info" className="mt-1">
                                    <ShieldCheck className="size-3.5" aria-hidden="true" />
                                    {ROTULO_DO_PAPEL[permissoes.role]}
                                </Badge>
                                <p className="mt-1.5 max-w-[22rem] text-xs text-muted-foreground">
                                    {ALCANCE_DO_PAPEL[permissoes.role]}
                                </p>
                            </div>
                        ) : null}
                    </div>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleAvatarChange}
                    />

                    <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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

                        <FormField label="WhatsApp" htmlFor="phone" hint="Com DDD.">
                            <PhoneInput
                                id="phone"
                                value={formData.phone}
                                onChange={(digits) => setFormData(prev => ({ ...prev, phone: digits }))}
                            />
                        </FormField>

                        {/* Sem "Alterar" ao lado: o botão não tinha `onClick`
                            — prometia uma tela que não existe. Trocar o e-mail
                            é trocar o login, e isso passa por confirmar o
                            endereço novo; enquanto o fluxo não existir, o campo
                            só informa. */}
                        <FormField label="E-mail da conta" htmlFor="account-email" hint="É o seu login.">
                            <Input id="account-email" value={profile?.email || ''} disabled />
                        </FormField>
                    </div>

                    {/* A senha ganha um rótulo de grupo — não um fio — porque
                        é o único trecho da faixa com regra própria: grava
                        sozinha e encerra as outras sessões. */}
                    <p className="mt-6 text-xs text-muted-foreground">
                        Trocar a senha encerra as outras sessões abertas. Mínimo de 8 caracteres.
                    </p>
                    <div className="mt-2 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
                        {/* O botão colado no último campo, como o "Alterar" do
                            e-mail: trocar a senha é uma gravação à parte. */}
                        <FormField label="Confirmar" htmlFor="confirmPassword">
                            <div className="flex gap-2">
                                <Input
                                    id="confirmPassword"
                                    type="password"
                                    value={passwordData.confirmPassword}
                                    onChange={(e) => setPasswordData(prev => ({ ...prev, confirmPassword: e.target.value }))}
                                    autoComplete="new-password"
                                    className="flex-1"
                                />
                                <Button
                                    type="button"
                                    onClick={handleChangePassword}
                                    disabled={changingPassword || !passwordData.newPassword}
                                    variant="outline"
                                    className="shrink-0"
                                >
                                    {changingPassword ? 'Alterando…' : 'Alterar'}
                                </Button>
                            </div>
                        </FormField>
                    </div>
                    </div>
                </SettingsBand>
            </form>
        </BandLayout>
    )
}
