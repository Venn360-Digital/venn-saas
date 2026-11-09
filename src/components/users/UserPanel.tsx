'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { InlineField } from '@/components/shared/InlineField'
import { Input } from '@/components/ui/input'
import { PanelField, PanelSection, RecordPanel, usePanelSave } from '@/components/shared/RecordPanel'
import { StatusBadge, WORKSPACE_ROLE } from '@/components/shared/StatusBadge'
import { formatPhone } from '@/lib/phone'
import { ROTULO_DO_PAPEL } from '@/lib/papeis'

export interface UserPanelItem {
    id: string
    name: string
    lastName: string | null
    email: string
    phone: string | null
    avatar: string | null
    role: string
    /** De quais departamentos ele é — as filas que ele pode ver. */
    departments: { id: string; name: string }[]
    canTransfer: boolean
    /** Entra na distribuição automática e pode ficar responsável. */
    recebeConversas: boolean
    /** Minutos até cair para ausente; nulo usa o padrão da conta. */
    minutosParaAusente: number | null
    /** O padrão da conta, só para o `placeholder` dizer qual é. */
    minutosParaAusenteDaConta?: number | null
    isActive: boolean
    isFirstAdmin: boolean
}

/** Os papéis atribuíveis. O nome vem de `lib/papeis.ts`, que é a fonte única. */
const ROLES = [
    { value: 'ADMIN', label: ROTULO_DO_PAPEL.ADMIN },
    { value: 'GESTOR', label: ROTULO_DO_PAPEL.GESTOR },
    { value: 'ATENDENTE', label: ROTULO_DO_PAPEL.ATENDENTE },
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
    onEditFull,
    onDelete,
}: {
    item: UserPanelItem
    departments: { id: string; name: string }[]
    canEdit: boolean
    onClose: () => void
    onPrev?: () => void
    onNext?: () => void
    onChanged: () => void
    /** O lápis: o diálogo do Novo em modo de edição (é lá que a senha não entra). */
    onEditFull?: (id: string) => void
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
            onEditFull={canEdit && onEditFull ? () => onEditFull(item.id) : undefined}
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
                {/*
                  * Caixas, não um seletor: a pessoa pode ser de vários, e a
                  * lista inteira à vista é o que deixa óbvio quais filas ela
                  * alcança. Some quando a clínica não tem departamento nenhum —
                  * um campo que só oferece "nenhum" não decide nada.
                  */}
                {departments.length > 0 ? (
                    <PanelField label="Departamentos" saved={saved === 'departments'}>
                        <div className="flex flex-col gap-1.5 py-1">
                            {departments.map((d) => {
                                const marcado = u.departments.some((x) => x.id === d.id)
                                return (
                                    <label key={d.id} className="flex items-center gap-2 text-sm">
                                        <Checkbox
                                            checked={marcado}
                                            disabled={!canEdit}
                                            aria-label={d.name}
                                            onCheckedChange={() => {
                                                const next = marcado
                                                    ? u.departments.filter((x) => x.id !== d.id)
                                                    : [...u.departments, { id: d.id, name: d.name }]
                                                // O painel guarda a lista; o
                                                // corpo manda só os ids, que é
                                                // o que a rota grava.
                                                void save(
                                                    'departments',
                                                    { departments: next },
                                                    { departmentIds: next.map((x) => x.id) }
                                                )
                                            }}
                                        />
                                        {d.name}
                                    </label>
                                )
                            })}
                            {u.departments.length === 0 && u.role === 'ATENDENTE' ? (
                                <p className="text-xs text-muted-foreground">
                                    Sem departamento, ele vê só a fila geral — linhas sem dono.
                                </p>
                            ) : null}
                        </div>
                    </PanelField>
                ) : null}
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
                {/* Entre "Transfere" e "Ativo", que é a ordem do diálogo de
                    edição. A ficha tinha oito campos e o diálogo dez, e este
                    era um dos dois que faltavam: o `PATCH` já o aceitava, então
                    a distribuição de conversas só se mexia abrindo o diálogo. */}
                <PanelField label="Recebe conversas" htmlFor="user-panel-recebe" saved={saved === 'recebeConversas'}>
                    <div className="flex items-center gap-2">
                        <Switch id="user-panel-recebe" checked={u.recebeConversas} disabled={!canEdit} onCheckedChange={(recebeConversas) => void save('recebeConversas', { recebeConversas })} />
                        <span className="text-xs text-muted-foreground">entra na distribuição automática</span>
                    </div>
                </PanelField>
                <PanelField label="Ativo" htmlFor="user-panel-active" saved={saved === 'isActive'}>
                    <Switch id="user-panel-active" checked={u.isActive} disabled={!canEdit || u.isFirstAdmin} onCheckedChange={(isActive) => void save('isActive', { isActive })} />
                </PanelField>
                {/* **O último campo da ficha**, e chamado de "Ausência" —
                    pedido do Andre em 2026-11-09. Era "Paciência", logo depois
                    de "Recebe conversas": o nome descrevia a metáfora (quanto
                    o sistema espera antes de desistir da pessoa) e não o que o
                    campo produz, que é o status de ausência que a equipe vê no
                    painel. No fim da ficha porque é o ajuste mais fino dela —
                    quem abre a ficha vem mexer em função, fila e acesso.

                    É atributo da pessoa — a recepcionista que atende balcão
                    fica minutos fora da tela sem estar ausente — mas **editado
                    pela gestão**: entra em `estaDisponivel`, e se cada um
                    escolhesse o seu, quem pusesse 5 minutos receberia menos
                    trabalho. Vazio devolve ao padrão da conta (Conta →
                    Automações), e é por isso que o campo aceita ser
                    esvaziado. */}
                <PanelField label="Ausência" htmlFor="user-panel-ausente" saved={saved === 'minutosParaAusente'}>
                    <div className="flex items-center gap-2">
                        <Input
                            id="user-panel-ausente"
                            type="number"
                            min={0}
                            max={1440}
                            inputMode="numeric"
                            placeholder={u.minutosParaAusenteDaConta != null ? String(u.minutosParaAusenteDaConta) : 'padrão'}
                            defaultValue={u.minutosParaAusente ?? ''}
                            disabled={!canEdit}
                            className="h-8 w-20 text-sm"
                            onBlur={(e) => {
                                const cru = e.target.value.trim()
                                // Vazio é `null` — o pedido de voltar ao padrão
                                // da conta —, e não 0, que significa desligar a
                                // queda. São coisas diferentes e a rota as
                                // distingue.
                                const valor = cru === '' ? null : Number(cru)
                                if (valor !== null && (!Number.isInteger(valor) || valor < 0 || valor > 1440)) return
                                if (valor === (u.minutosParaAusente ?? null)) return
                                void save('minutosParaAusente', { minutosParaAusente: valor })
                            }}
                        />
                        <span className="text-xs text-muted-foreground">
                            min para status de ausência
                        </span>
                    </div>
                </PanelField>
            </PanelSection>
        </RecordPanel>
    )
}
