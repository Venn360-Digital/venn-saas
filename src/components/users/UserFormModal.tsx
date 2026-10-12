'use client'

import { useState, useEffect } from 'react'
import { toast } from 'sonner'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { FormField } from '@/components/shared/FormField'
import { RecordDialog, SummaryCard } from '@/components/shared/RecordDialog'
import { StatusBadge, WORKSPACE_ROLE } from '@/components/shared/StatusBadge'
import { cn } from '@/lib/utils'
import { PhoneInput } from '@/components/shared/PhoneInput'
import { phoneIssue } from '@/lib/phone'

interface WorkspaceUser {
    id: string
    userId: string
    name: string
    lastName: string | null
    email: string
    phone: string | null
    role: string
    departmentId: string | null
    canTransfer: boolean
    isActive: boolean
    isFirstAdmin?: boolean
}

interface Department {
    id: string
    name: string
}

interface UserFormModalProps {
    isOpen: boolean
    onClose: () => void
    onSuccess: () => void
    user: WorkspaceUser | null
    departments: Department[]
}

type Role = 'ADMIN' | 'GESTOR' | 'ATENDENTE'

const EMPTY_FORM = {
    name: '',
    lastName: '',
    email: '',
    password: '',
    phone: '',
    departmentId: '',
    role: 'GESTOR' as Role,
    canTransfer: false,
    isActive: true,
}

function initials(name: string, lastName: string) {
    const first = name.trim()[0] ?? ''
    const last = lastName.trim()[0] ?? name.trim().split(' ')[1]?.[0] ?? ''
    return (first + last).toUpperCase() || 'U'
}

const ROLES: { value: Role; label: string; description: string }[] = [
    { value: 'ADMIN', label: 'Administrador', description: 'Acesso total, incluindo conta e usuários.' },
    { value: 'GESTOR', label: 'Gestor', description: 'Atendimento e vendas, sem gerenciamento.' },
    { value: 'ATENDENTE', label: 'Atendente', description: 'Apenas as próprias conversas.' },
]

export function UserFormModal({
    isOpen,
    onClose,
    onSuccess,
    user,
    departments,
}: UserFormModalProps) {
    const [loading, setLoading] = useState(false)
    const [formData, setFormData] = useState(EMPTY_FORM)
    const [errors, setErrors] = useState<{ name?: string; email?: string; password?: string; phone?: string }>({})

    const isEditing = !!user
    // The founding member cannot be demoted or deactivated, here or in the API.
    const isProtectedMember = !!user?.isFirstAdmin

    useEffect(() => {
        if (user) {
            setFormData({
                name: user.name || '',
                lastName: user.lastName || '',
                email: user.email || '',
                password: '',
                phone: user.phone ?? '',
                departmentId: user.departmentId || '',
                role: (user.role === 'ADMIN' || user.role === 'OWNER'
                    ? 'ADMIN'
                    : user.role === 'ATENDENTE'
                      ? 'ATENDENTE'
                      : 'GESTOR') as Role,
                canTransfer: user.canTransfer,
                isActive: user.isActive,
            })
        } else {
            setFormData(EMPTY_FORM)
        }
        setErrors({})
    }, [user, isOpen])

    /** `again` = Criar e novo: grava, limpa e fica aberto. */
    async function handleSubmit(again: boolean) {
        const next: typeof errors = {}
        if (!formData.name.trim()) next.name = 'Informe o nome.'
        if (!isEditing) {
            if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(formData.email.trim())) next.email = 'Informe um e-mail válido: é o login da pessoa.'
            if (formData.password.length < 8) next.password = 'A senha precisa de pelo menos 8 caracteres.'
        }
        const phoneProblem = formData.phone ? phoneIssue(formData.phone) : null
        if (phoneProblem) next.phone = phoneProblem
        if (Object.keys(next).length) { setErrors(next); return }
        setLoading(true)

        try {
            const payload: Record<string, unknown> = {
                name: formData.name,
                lastName: formData.lastName,
                phone: formData.phone,
                departmentId: formData.departmentId || null,
                role: formData.role,
                canTransfer: formData.canTransfer,
                isActive: formData.isActive,
            }

            // Credentials are only set at creation; changing them later goes
            // through the account screen.
            if (!isEditing) {
                payload.email = formData.email
                payload.password = formData.password
            }

            const response = await fetch(
                isEditing ? `/api/users/${user.id}` : '/api/users',
                {
                    method: isEditing ? 'PATCH' : 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                }
            )

            const data = await response.json()

            if (response.ok) {
                toast.success(isEditing ? 'Usuário atualizado' : 'Usuário criado')
                setErrors({})
                if (again && !isEditing) setFormData(EMPTY_FORM)
                else onSuccess()
            } else {
                const msg: string = data.error ?? 'Não foi possível salvar o usuário'
                if (/e-?mail/i.test(msg)) setErrors({ email: msg })
                else toast.error(msg)
            }
        } catch (error) {
            console.error('[USER_FORM] save', error)
            toast.error('Não foi possível salvar o usuário')
        } finally {
            setLoading(false)
        }
    }

    const roleInfo = ROLES.find((r) => r.value === formData.role)
    const deptName = departments.find((d) => d.id === formData.departmentId)?.name
    const fullName = `${formData.name} ${formData.lastName}`.trim()

    return (
        <RecordDialog
            open={isOpen}
            onOpenChange={(open) => !open && onClose()}
            title={isEditing ? 'Editar usuário' : 'Novo usuário'}
            description={isEditing ? 'Atualize os dados e as permissões desta pessoa.' : 'A pessoa recebe acesso assim que você criar.'}
            submitLabel={isEditing ? 'Salvar usuário' : 'Criar usuário'}
            hideAgain={isEditing}
            onSubmit={handleSubmit}
            submitting={loading}
            summary={
                <>
                    <SummaryCard>
                        <Avatar className="size-8 shrink-0">
                            <AvatarFallback className="bg-primary-subtle text-xs text-primary-subtle-foreground">{initials(formData.name, formData.lastName)}</AvatarFallback>
                        </Avatar>
                        <span className="min-w-0">
                            <span className="block truncate text-[12.5px] font-semibold">{fullName || 'Nome da pessoa'}</span>
                            <span className="block truncate text-[11px] text-muted-foreground">{formData.email.trim() || 'e-mail de acesso'}</span>
                        </span>
                    </SummaryCard>
                    <div className="flex flex-wrap items-center gap-1.5">
                        <StatusBadge value={formData.role} map={WORKSPACE_ROLE} />
                        {deptName ? <span className="inline-flex h-[22px] items-center rounded-full bg-muted px-2 text-[11px] text-muted-foreground">{deptName}</span> : null}
                        {!formData.isActive ? <span className="text-[11px] text-muted-foreground">Inativo</span> : null}
                    </div>
                    {roleInfo ? <p className="text-[11px] leading-relaxed text-muted-foreground">{roleInfo.label}: {roleInfo.description.toLowerCase()}</p> : null}
                </>
            }
        >
            <FormField label="Nome" htmlFor="user-name" required error={errors.name}>
                <Input
                    id="user-name"
                    value={formData.name}
                    onChange={(e) => { setFormData({ ...formData, name: e.target.value }); if (errors.name) setErrors((p) => ({ ...p, name: undefined })) }}
                    aria-invalid={errors.name ? true : undefined}
                    autoComplete="given-name"
                    autoFocus
                />
            </FormField>

            <FormField label="Sobrenome" htmlFor="user-lastname">
                <Input
                    id="user-lastname"
                    value={formData.lastName}
                    onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                    autoComplete="family-name"
                />
            </FormField>

            {!isEditing ? (
                <>
                    <FormField label="E-mail" htmlFor="user-email" required error={errors.email}>
                        <Input
                            id="user-email"
                            type="email"
                            value={formData.email}
                            onChange={(e) => { setFormData({ ...formData, email: e.target.value }); if (errors.email) setErrors((p) => ({ ...p, email: undefined })) }}
                            placeholder="nome@clinica.com.br"
                            aria-invalid={errors.email ? true : undefined}
                            autoComplete="email"
                        />
                    </FormField>

                    <FormField label="Senha" htmlFor="user-password" required error={errors.password} hint="Mínimo de 8 caracteres">
                        <Input
                            id="user-password"
                            type="password"
                            value={formData.password}
                            onChange={(e) => { setFormData({ ...formData, password: e.target.value }); if (errors.password) setErrors((p) => ({ ...p, password: undefined })) }}
                            aria-invalid={errors.password ? true : undefined}
                            autoComplete="new-password"
                        />
                    </FormField>
                </>
            ) : null}

            <FormField label="Telefone" htmlFor="user-phone" error={errors.phone}>
                <PhoneInput
                    id="user-phone"
                    value={formData.phone}
                    onChange={(digits) => { setFormData({ ...formData, phone: digits }); if (errors.phone) setErrors((p) => ({ ...p, phone: undefined })) }}
                />
            </FormField>

            <FormField label="Departamento" htmlFor="user-department">
                <Select
                    value={formData.departmentId || 'none'}
                    onValueChange={(v) => setFormData({ ...formData, departmentId: v === 'none' ? '' : v })}
                >
                    <SelectTrigger id="user-department" className="w-full">
                        <SelectValue placeholder="Sem departamento" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="none">Sem departamento</SelectItem>
                        {departments.map((d) => (
                            <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </FormField>

            <div className="col-span-2 space-y-2">
                <Label>
                    Função<span className="text-destructive-subtle-foreground" aria-hidden="true">*</span>
                </Label>
                <RadioGroup
                    value={formData.role}
                    onValueChange={(v) => setFormData({ ...formData, role: v as Role })}
                    disabled={isProtectedMember}
                    className="grid gap-2 sm:grid-cols-3"
                >
                    {ROLES.map((role) => {
                        const selected = formData.role === role.value
                        return (
                            <Label
                                key={role.value}
                                htmlFor={`role-${role.value}`}
                                className={cn(
                                    'flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 transition-colors',
                                    selected ? 'border-primary-subtle-foreground bg-primary-subtle' : 'border-border hover:border-border-strong',
                                    isProtectedMember && 'cursor-not-allowed opacity-60'
                                )}
                            >
                                <RadioGroupItem id={`role-${role.value}`} value={role.value} className="mt-0.5" />
                                <span className="min-w-0">
                                    <span className="block text-sm font-medium">{role.label}</span>
                                    <span className="block text-xs text-muted-foreground">{role.description}</span>
                                </span>
                            </Label>
                        )
                    })}
                </RadioGroup>
                {isProtectedMember ? (
                    <p className="text-xs text-muted-foreground">O administrador principal não pode mudar de função.</p>
                ) : null}
            </div>

            <div className="col-span-2 space-y-3 rounded-lg border border-border p-4">
                <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                        <Label htmlFor="user-transfer">Pode transferir conversas</Label>
                        <p className="text-xs text-muted-foreground">Permite passar um atendimento para outra pessoa.</p>
                    </div>
                    <Switch id="user-transfer" checked={formData.canTransfer} onCheckedChange={(v) => setFormData({ ...formData, canTransfer: v })} />
                </div>

                <div className="flex items-start justify-between gap-4 border-t border-border pt-3">
                    <div className="min-w-0">
                        <Label htmlFor="user-deactivate">Acesso ativo</Label>
                        <p className="text-xs text-muted-foreground">
                            {isProtectedMember
                                ? 'O administrador principal não pode ser desativado.'
                                : 'Desligar encerra o acesso da pessoa a esta clínica e a tira das filas e das transferências. As conversas e mensagens dela permanecem.'}
                        </p>
                    </div>
                    <Switch id="user-deactivate" checked={formData.isActive} disabled={isProtectedMember} onCheckedChange={(v) => setFormData({ ...formData, isActive: v })} />
                </div>
            </div>
        </RecordDialog>
    )
}

export default UserFormModal
