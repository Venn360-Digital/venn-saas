'use client'

import { useState, useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { FormField } from '@/components/shared/FormField'
import { cn } from '@/lib/utils'
import { PhoneInput } from '@/components/shared/PhoneInput'
import { formatPhone, phoneIssue } from '@/lib/phone'

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
    const [formData, setFormData] = useState({
        name: '',
        lastName: '',
        email: '',
        password: '',
        phone: '',
        departmentId: '',
        role: 'GESTOR' as Role,
        canTransfer: false,
        isActive: true,
    })

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
                phone: formatPhone(user.phone),
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
            setFormData({
                name: '',
                lastName: '',
                email: '',
                password: '',
                phone: '',
                departmentId: '',
                role: 'GESTOR',
                canTransfer: false,
                isActive: true,
            })
        }
    }, [user, isOpen])

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        const phoneProblem = phoneIssue(formData.phone)
        if (phoneProblem) {
            toast.error(phoneProblem)
            return
        }
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
                onSuccess()
            } else {
                toast.error(data.error ?? 'Não foi possível salvar o usuário')
            }
        } catch (error) {
            console.error('[USER_FORM] save', error)
            toast.error('Não foi possível salvar o usuário')
        } finally {
            setLoading(false)
        }
    }

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            {/* Was a hand-rolled `fixed inset-0` overlay: no focus trap, no escape
                key, no labelled dialog role. The primitive handles all three. */}
            <DialogContent className="max-h-[90svh] max-w-lg overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{isEditing ? 'Editar usuário' : 'Novo usuário'}</DialogTitle>
                    <DialogDescription>
                        {isEditing
                            ? 'Atualize os dados e as permissões desta pessoa.'
                            : 'A pessoa recebe acesso assim que você salvar.'}
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-5">
                    <div className="grid gap-4 sm:grid-cols-2">
                        <FormField label="Nome" htmlFor="user-name" required>
                            <Input
                                id="user-name"
                                value={formData.name}
                                onChange={(e) =>
                                    setFormData({ ...formData, name: e.target.value })
                                }
                                required
                                autoComplete="given-name"
                            />
                        </FormField>

                        <FormField label="Sobrenome" htmlFor="user-lastname">
                            <Input
                                id="user-lastname"
                                value={formData.lastName}
                                onChange={(e) =>
                                    setFormData({ ...formData, lastName: e.target.value })
                                }
                                autoComplete="family-name"
                            />
                        </FormField>
                    </div>

                    {!isEditing ? (
                        <div className="grid gap-4 sm:grid-cols-2">
                            <FormField label="E-mail" htmlFor="user-email" required>
                                <Input
                                    id="user-email"
                                    type="email"
                                    value={formData.email}
                                    onChange={(e) =>
                                        setFormData({ ...formData, email: e.target.value })
                                    }
                                    placeholder="nome@clinica.com.br"
                                    required
                                    autoComplete="email"
                                />
                            </FormField>

                            <FormField
                                label="Senha"
                                htmlFor="user-password"
                                required
                                hint="Mínimo de 8 caracteres"
                            >
                                <Input
                                    id="user-password"
                                    type="password"
                                    value={formData.password}
                                    onChange={(e) =>
                                        setFormData({ ...formData, password: e.target.value })
                                    }
                                    minLength={8}
                                    required
                                    autoComplete="new-password"
                                />
                            </FormField>
                        </div>
                    ) : null}

                    <div className="grid gap-4 sm:grid-cols-2">
                        <FormField label="Telefone" htmlFor="user-phone">
                            <PhoneInput
                                id="user-phone"
                                value={formData.phone}
                                onChange={(digits) => setFormData({ ...formData, phone: digits })}
                            />
                        </FormField>

                        <FormField label="Departamento" htmlFor="user-department">
                            <Select
                                value={formData.departmentId || 'none'}
                                onValueChange={(v) =>
                                    setFormData({
                                        ...formData,
                                        departmentId: v === 'none' ? '' : v,
                                    })
                                }
                            >
                                <SelectTrigger id="user-department">
                                    <SelectValue placeholder="Sem departamento" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="none">Sem departamento</SelectItem>
                                    {departments.map((d) => (
                                        <SelectItem key={d.id} value={d.id}>
                                            {d.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </FormField>
                    </div>

                    <div className="space-y-2">
                        <Label>Função</Label>
                        {/* Was three bare <input type="radio"> styled with
                            accent-color, which cannot be themed beyond the dot and
                            gave no keyboard grouping. */}
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
                                            selected
                                                ? 'border-primary bg-primary-subtle'
                                                : 'border-border hover:border-border-strong',
                                            isProtectedMember && 'cursor-not-allowed opacity-60'
                                        )}
                                    >
                                        <RadioGroupItem
                                            id={`role-${role.value}`}
                                            value={role.value}
                                            className="mt-0.5"
                                        />
                                        <span className="min-w-0">
                                            <span className="block text-sm font-medium">
                                                {role.label}
                                            </span>
                                            <span className="block text-xs text-muted-foreground">
                                                {role.description}
                                            </span>
                                        </span>
                                    </Label>
                                )
                            })}
                        </RadioGroup>
                        {isProtectedMember ? (
                            <p className="text-xs text-muted-foreground">
                                O administrador principal não pode mudar de função.
                            </p>
                        ) : null}
                    </div>

                    <div className="space-y-3 rounded-lg border border-border p-4">
                        <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                                <Label htmlFor="user-transfer">Pode transferir conversas</Label>
                                <p className="text-xs text-muted-foreground">
                                    Permite passar um atendimento para outra pessoa.
                                </p>
                            </div>
                            <Switch
                                id="user-transfer"
                                checked={formData.canTransfer}
                                onCheckedChange={(v) =>
                                    setFormData({ ...formData, canTransfer: v })
                                }
                            />
                        </div>

                        <div className="flex items-start justify-between gap-4 border-t border-border pt-3">
                            <div className="min-w-0">
                                <Label htmlFor="user-deactivate">Desativar usuário</Label>
                                <p className="text-xs text-muted-foreground">
                                    {isProtectedMember
                                        ? 'O administrador principal não pode ser desativado.'
                                        : 'Desativar encerra o acesso da pessoa a esta clínica e a tira das filas e das transferências. As conversas e mensagens dela permanecem no sistema.'}
                                </p>
                            </div>
                            {/* On is active, off is deactivated. */}
                            <Switch
                                id="user-deactivate"
                                checked={formData.isActive}
                                disabled={isProtectedMember}
                                onCheckedChange={(v) => setFormData({ ...formData, isActive: v })}
                            />
                        </div>
                    </div>

                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={onClose}
                            disabled={loading}
                        >
                            Cancelar
                        </Button>
                        <Button type="submit" disabled={loading}>
                            {loading ? <Loader2 className="animate-spin" /> : null}
                            {isEditing ? 'Salvar' : 'Criar usuário'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}

export default UserFormModal
