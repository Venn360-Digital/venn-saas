'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { InlineField } from '@/components/shared/InlineField'
import { PanelField, PanelSection, RecordPanel, usePanelSave } from '@/components/shared/RecordPanel'
import { StatusBadge, WORKSPACE_ROLE } from '@/components/shared/StatusBadge'
import { formatPhone } from '@/lib/phone'

export interface UserPanelItem {
    id: string
    name: string
    lastName: string | null
    email: string
    phone: string | null
    avatar: string | null
    role: string
    departmentId: string | null
    departmentName: string | null
    canTransfer: boolean
    isActive: boolean
    isFirstAdmin: boolean
}

const ROLES = [
    { value: 'ADMIN', label: 'Administrador' },
    { value: 'GESTOR', label: 'Gestor' },
    { value: 'ATENDENTE', label: 'Atendente' },
]

function initials(name: string, lastName: string | null) {
    const first = name?.trim()?.[0] ?? ''
    const last = lastName?.trim()?.[0] ?? name?.trim()?.split(' ')?.[1]?.[0] ?? ''
    return (first + last).toUpperCase() || 'U'
}

/**
 * A ficha de quem acessa a clínica. O e-mail é só leitura (é o login), e a
 * senha a pessoa troca na própria conta. Função e desativação do primeiro
 * administrador ficam travadas — a API recusa, e dizer isso aqui poupa a volta.
 */
export function UserPanel({
    item,
    departments,
    canEdit,
    onClose,
    onPrev,
    onNext,
    onChanged,
    onDelete,
}: {
    item: UserPanelItem
    departments: { id: string; name: string }[]
    canEdit: boolean
    onClose: () => void
    onPrev?: () => void
    onNext?: () => void
    onChanged: () => void
    onDelete: (id: string) => void
}) {
    const { save, saved, local } = usePanelSave<UserPanelItem>(`/api/users/${item.id}`, onChanged)
    const u = { ...item, ...local }
    const isOwner = u.role === 'OWNER'
    const roleLocked = !canEdit || isOwner || u.isFirstAdmin
    const fullName = `${u.name} ${u.lastName ?? ''}`.trim()

    return (
        <RecordPanel
            label={`Ficha de ${fullName}`}
            avatar={
                <Avatar className="size-11 shrink-0">
                    <AvatarImage src={u.avatar ?? ''} alt="" />
                    <AvatarFallback className="bg-primary-subtle text-sm font-bold text-primary-subtle-foreground">
                        {initials(u.name, u.lastName)}
                    </AvatarFallback>
                </Avatar>
            }
            title={
                <span className="flex min-w-0 flex-col">
                    <span className="truncate">{fullName || 'Sem nome'}</span>
                    <span className="mt-0.5 flex items-center gap-1.5">
                        <StatusBadge value={u.role} map={WORKSPACE_ROLE} />
                        {!u.isActive ? <span className="text-[11px] font-medium text-muted-foreground">Inativo</span> : null}
                    </span>
                </span>
            }
            onClose={onClose}
            onPrev={onPrev}
            onNext={onNext}
            onDelete={canEdit && !u.isFirstAdmin ? () => onDelete(item.id) : undefined}
        >
            <PanelSection title="Dados" aside={<span className="text-[10px] text-muted-foreground">grava ao sair do campo</span>}>
                <PanelField label="Nome" htmlFor="user-panel-name" saved={saved === 'name'}>
                    <InlineField id="user-panel-name" value={u.name} disabled={!canEdit} onCommit={(name) => { if (name) void save('name', { name }) }} className="h-8 text-sm" />
                </PanelField>
                <PanelField label="Sobrenome" htmlFor="user-panel-lastname" saved={saved === 'lastName'}>
                    <InlineField id="user-panel-lastname" value={u.lastName ?? ''} disabled={!canEdit} onCommit={(lastName) => void save('lastName', { lastName })} className="h-8 text-sm" />
                </PanelField>
                <PanelField label="E-mail">
                    <span className="block truncate text-sm text-muted-foreground" title={u.email}>{u.email}</span>
                </PanelField>
                <PanelField label="Telefone" htmlFor="user-panel-phone" saved={saved === 'phone'}>
                    <InlineField
                        id="user-panel-phone"
                        value={u.phone ? formatPhone(u.phone) : ''}
                        disabled={!canEdit}
                        placeholder="(31) 99999-9999"
                        onCommit={(phone) => void save('phone', { phone: phone.replace(/\D/g, '') })}
                        className="num h-8 text-sm"
                    />
                </PanelField>
            </PanelSection>

            <PanelSection title="Acesso">
                <PanelField label="Departamento" saved={saved === 'departmentId'}>
                    <Select
                        value={u.departmentId ?? 'none'}
                        disabled={!canEdit}
                        onValueChange={(v) => {
                            const departmentId = v === 'none' ? null : v
                            const departmentName = departments.find((d) => d.id === departmentId)?.name ?? null
                            void save('departmentId', { departmentId, departmentName })
                        }}
                    >
                        <SelectTrigger size="sm" className="w-full" aria-label="Departamento">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="none">Sem departamento</SelectItem>
                            {departments.map((d) => (
                                <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </PanelField>
                <PanelField label="Função" saved={saved === 'role'}>
                    {isOwner ? (
                        <span className="text-sm text-muted-foreground">Proprietário</span>
                    ) : (
                        <Select value={u.role} disabled={roleLocked} onValueChange={(role) => void save('role', { role })}>
                            <SelectTrigger size="sm" className="w-full" aria-label="Função">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {ROLES.map((r) => (
                                    <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    )}
                </PanelField>
                <PanelField label="Transfere" htmlFor="user-panel-transfer" saved={saved === 'canTransfer'}>
                    <div className="flex items-center gap-2">
                        <Switch id="user-panel-transfer" checked={u.canTransfer} disabled={!canEdit} onCheckedChange={(canTransfer) => void save('canTransfer', { canTransfer })} />
                        <span className="text-xs text-muted-foreground">pode transferir conversas</span>
                    </div>
                </PanelField>
                <PanelField label="Ativo" htmlFor="user-panel-active" saved={saved === 'isActive'}>
                    <Switch id="user-panel-active" checked={u.isActive} disabled={!canEdit || u.isFirstAdmin} onCheckedChange={(isActive) => void save('isActive', { isActive })} />
                </PanelField>
            </PanelSection>
        </RecordPanel>
    )
}
