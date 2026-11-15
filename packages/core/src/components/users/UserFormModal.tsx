'use client'

import { useState, useEffect } from 'react'
import { toast } from 'sonner'

import { Avatar, AvatarFallback } from '@venn/ui/avatar'
import { Checkbox } from '@venn/ui/checkbox'
import { Input } from '@venn/ui/input'
import { Label } from '@venn/ui/label'
import { Switch } from '@venn/ui/switch'
import { RadioGroup, RadioGroupItem } from '@venn/ui/radio-group'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@venn/ui/select'
import { FormField } from '../shared/FormField'
import { RecordDialog, SummaryCard } from '../shared/RecordDialog'
import { StatusBadge, WORKSPACE_ROLE } from '../shared/StatusBadge'
import { cn } from '@venn/ui/utils'
import { PhoneInput } from '../shared/PhoneInput'
import { phoneIssue } from '../../lib/phone'
import { ROTULO_DO_PAPEL } from '../../lib/papeis'
import { useVocab } from '../../hooks/useVocab'
import { comArtigo } from '../../lib/concordancia'

interface WorkspaceUser {
    id: string
    userId: string
    name: string
    lastName: string | null
    email: string
    phone: string | null
    role: string
    departments: { id: string; name: string }[]
    canTransfer: boolean
    recebeConversas: boolean
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
    phone: '',
    departmentIds: [] as string[],
    role: 'GESTOR' as Role,
    canTransfer: false,
    // O padrão real vem do papel, e é decidido quando a função muda (ver o
    // efeito logo abaixo). Aqui é só o valor inicial do formulário vazio.
    recebeConversas: true,
    isActive: true,
}

function initials(name: string, lastName: string) {
    const first = name.trim()[0] ?? ''
    const last = lastName.trim()[0] ?? name.trim().split(' ')[1]?.[0] ?? ''
    return (first + last).toUpperCase() || 'U'
}

/** Os papéis atribuíveis. O nome vem de `lib/papeis.ts`, que é a fonte única. */
const ROLES: { value: Role; label: string; description: string }[] = [
    { value: 'ADMIN', label: ROTULO_DO_PAPEL.ADMIN, description: 'Acesso total, incluindo conta e usuários.' },
    { value: 'GESTOR', label: ROTULO_DO_PAPEL.GESTOR, description: 'Atendimento e vendas, sem gerenciamento.' },
    { value: 'ATENDENTE', label: ROTULO_DO_PAPEL.ATENDENTE, description: 'Apenas as próprias conversas.' },
]

export function UserFormModal({
    isOpen,
    onClose,
    onSuccess,
    user,
    departments,
}: UserFormModalProps) {
    const v = useVocab()

    const [loading, setLoading] = useState(false)
    const [formData, setFormData] = useState(EMPTY_FORM)
    const [errors, setErrors] = useState<{ name?: string; email?: string; phone?: string }>({})

    const isEditing = !!user
    // The founding member cannot be demoted or deactivated, here or in the API.
    const isProtectedMember = !!user?.isFirstAdmin

    useEffect(() => {
        if (user) {
            setFormData({
                name: user.name || '',
                lastName: user.lastName || '',
                email: user.email || '',
                phone: user.phone ?? '',
                departmentIds: user.departments.map((d) => d.id),
                role: (user.role === 'ADMIN' || user.role === 'OWNER'
                    ? 'ADMIN'
                    : user.role === 'ATENDENTE'
                      ? 'ATENDENTE'
                      : 'GESTOR') as Role,
                canTransfer: user.canTransfer,
                recebeConversas: user.recebeConversas ?? true,
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
            if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(formData.email.trim())) next.email = 'Informe um e-mail válido: é para lá que o convite vai.'
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
                departmentIds: formData.departmentIds,
                role: formData.role,
                canTransfer: formData.canTransfer,
                recebeConversas: formData.recebeConversas,
                isActive: formData.isActive,
            }

            if (!isEditing) payload.email = formData.email

            /**
             * Criar manda **convite**, não cria usuário.
             *
             * `POST /api/users` responde 410 desde o convite LGPD: senha é dado
             * de autenticação do titular, e quem a escolhe tem de ser ele. O
             * convite grava o que a pessoa **vai ser** e o `User` nasce no
             * aceite, com a senha que ela escolheu.
             *
             * `isActive` não vai no convite: convite pendente não é acesso
             * desativado, é acesso que ainda não existe. Editar continua em
             * `/api/users/[id]`, que mexe em quem já aceitou.
             */
            if (!isEditing) {
                delete payload.isActive
            }

            const response = await fetch(
                isEditing ? `/api/users/${user.id}` : '/api/convites',
                {
                    method: isEditing ? 'PATCH' : 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                }
            )

            const data = await response.json()

            if (response.ok) {
                toast.success(
                    isEditing ? 'Usuário atualizado' : `Convite enviado para ${formData.email}`
                )
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
    const deptNames = departments.filter((d) => formData.departmentIds.includes(d.id)).map((d) => d.name)
    const fullName = `${formData.name} ${formData.lastName}`.trim()

    return (
        <RecordDialog
            open={isOpen}
            onOpenChange={(open) => !open && onClose()}
            title={isEditing ? 'Editar usuário' : 'Convidar para a equipe'}
            description={
                isEditing
                    ? 'Atualize os dados e as permissões desta pessoa.'
                    : 'A pessoa recebe um link por e-mail e escolhe a própria senha.'
            }
            submitLabel={isEditing ? 'Salvar usuário' : 'Enviar convite'}
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
                        {deptNames.map((nome) => <span key={nome} className="inline-flex h-[22px] items-center rounded-full bg-muted px-2 text-[11px] text-muted-foreground">{nome}</span>)}
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
                    {/* O campo Senha **saiu desta tela**, e não foi para outra.
                        Senha é dado de autenticação do titular: quem a escolhe
                        é ele, na tela do convite. O que sobra aqui é o endereço
                        para onde o link vai — e por isso a dica diz isso, em
                        vez de deixar a pessoa procurar o campo que faltou. */}
                    <FormField
                        label="E-mail"
                        htmlFor="user-email"
                        required
                        error={errors.email}
                        hint="O convite vai para este endereço, e vale 7 dias"
                    >
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
                </>
            ) : null}

            <FormField label="Telefone" htmlFor="user-phone" error={errors.phone}>
                <PhoneInput
                    id="user-phone"
                    value={formData.phone}
                    onChange={(digits) => { setFormData({ ...formData, phone: digits }); if (errors.phone) setErrors((p) => ({ ...p, phone: undefined })) }}
                />
            </FormField>

            {/*
              * Caixas, e nenhuma quando a clínica não tem departamentos: um
              * campo cuja única opção é "sem departamento" ocupa uma linha do
              * formulário para não decidir nada.
              */}
            {departments.length > 0 ? (
                <FormField
                    label="Departamentos"
                    hint="As filas que esta pessoa vê. Nenhuma marcada, ela vê só a fila geral."
                >
                    <div className="flex flex-col gap-1.5 pt-1">
                        {departments.map((d) => (
                            <label key={d.id} className="flex items-center gap-2 text-sm">
                                <Checkbox
                                    checked={formData.departmentIds.includes(d.id)}
                                    aria-label={d.name}
                                    onCheckedChange={(marcado) =>
                                        setFormData({
                                            ...formData,
                                            departmentIds: marcado
                                                ? [...formData.departmentIds, d.id]
                                                : formData.departmentIds.filter((x) => x !== d.id),
                                        })
                                    }
                                />
                                {d.name}
                            </label>
                        ))}
                    </div>
                </FormField>
            ) : null}

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

                {/* A marca é por pessoa, e o papel só sugere o padrão. A regra
                    "só atendente recebe" quebraria a clínica de uma pessoa só,
                    em que o dono atende: ninguém seria elegível e toda conversa
                    ficaria sem responsável. */}
                <div className="flex items-start justify-between gap-4 border-t border-border pt-3">
                    <div className="min-w-0">
                        <Label htmlFor="user-recebe">Recebe conversas</Label>
                        <p className="text-xs text-muted-foreground">
                            Entra na atribuição automática e pode ficar responsável por uma
                            conversa. Quem só acompanha deixa desligado.
                        </p>
                    </div>
                    <Switch
                        id="user-recebe"
                        checked={formData.recebeConversas}
                        onCheckedChange={(v) => setFormData({ ...formData, recebeConversas: v })}
                    />
                </div>

                <div className="flex items-start justify-between gap-4 border-t border-border pt-3">
                    <div className="min-w-0">
                        <Label htmlFor="user-deactivate">Acesso ativo</Label>
                        <p className="text-xs text-muted-foreground">
                            {isProtectedMember
                                ? 'O administrador principal não pode ser desativado.'
                                : `Desligar encerra o acesso da pessoa a ${comArtigo(v, 'organizacao', 'este')} e a tira das filas e das transferências. As conversas e mensagens dela permanecem.`}
                        </p>
                    </div>
                    <Switch id="user-deactivate" checked={formData.isActive} disabled={isProtectedMember} onCheckedChange={(v) => setFormData({ ...formData, isActive: v })} />
                </div>
            </div>
        </RecordDialog>
    )
}

export default UserFormModal
