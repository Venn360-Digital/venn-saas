'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, Loader2, Plus, ShoppingCart } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { BandLayout, SettingsBand, SettingsRow } from '@/components/shared/TabsFrame'
import { FormField } from '@/components/shared/FormField'
import { RecordDialog } from '@/components/shared/RecordDialog'
import { UNIDADE_ADICIONAL, formatPrice } from '@/lib/plans'

/**
 * As unidades da conta — as clínicas de quem paga.
 *
 * Guia sangrada com rodapé preso, como manda o DESIGN.md §5 (Tela 03): "na
 * Conta, todas as guias são sangradas". Uma faixa só, porque há uma coisa aqui:
 * a lista. O teto vive no `aside` do título em vez de numa segunda faixa — uma
 * faixa inteira para dizer "1 de 3" seria moldura demais para um número.
 *
 * **Duas ações, nunca as duas ao mesmo tempo**: cabendo mais unidade, o rodapé
 * cria; esgotado o teto, o rodapé contrata. É a regra de uma ação primária por
 * tela, e também o desenho honesto do que acontece atrás — contratar sobe o
 * teto, criar dá nome à clínica. Juntar os dois inventaria uma clínica chamada
 * "Nova unidade" que alguém teria de ir renomear.
 */

interface Unidade {
    id: string
    name: string
    createdAt: string
    usuarios: number
    pacientes: number
    agentes: number
    participo: boolean
}

interface Dados {
    conta: string
    souMaster: boolean
    aberta: string
    plano: string | null
    unidades: { used: number; max: number; remaining: number; doPlano: number; adicionais: number }
    lista: Unidade[]
}

function desde(iso: string): string {
    return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(new Date(iso))
}

export function UnidadesTab() {
    const [dados, setDados] = useState<Dados | null>(null)
    const [carregando, setCarregando] = useState(true)
    const [criando, setCriando] = useState(false)
    const [nome, setNome] = useState('')
    const [erro, setErro] = useState<string | null>(null)
    const [salvando, setSalvando] = useState(false)
    const [contratando, setContratando] = useState(false)
    const [trocando, setTrocando] = useState<string | null>(null)

    const carregar = useCallback(async () => {
        try {
            const res = await fetch('/api/account/workspaces')
            if (res.ok) setDados(await res.json())
        } finally {
            setCarregando(false)
        }
    }, [])

    useEffect(() => {
        void carregar()
    }, [carregar])

    async function criar() {
        setSalvando(true)
        setErro(null)
        try {
            const res = await fetch('/api/account/workspaces', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: nome }),
            })
            const corpo = await res.json().catch(() => ({}))
            if (!res.ok) {
                setErro(corpo.error ?? 'Não foi possível criar a unidade')
                return
            }
            setCriando(false)
            setNome('')
            toast.success(`Unidade ${corpo.name} criada.`)
            await carregar()
        } finally {
            setSalvando(false)
        }
    }

    async function contratar() {
        setContratando(true)
        try {
            const res = await fetch('/api/account/subscription', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'buy-unit' }),
            })
            const corpo = await res.json().catch(() => ({}))
            if (!res.ok) {
                toast.error(corpo.error ?? 'Não foi possível contratar a unidade')
                return
            }
            toast.success(corpo.message)
            await carregar()
        } finally {
            setContratando(false)
        }
    }

    /**
     * Abrir outra unidade é a mesma troca do seletor da marca, e recarrega a
     * tela inteira pela mesma razão: trocar de clínica troca conversas,
     * pacientes, agenda e agentes de uma vez.
     */
    async function abrir(id: string) {
        setTrocando(id)
        try {
            const res = await fetch('/api/workspace/switch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ workspaceId: id }),
            })
            if (!res.ok) {
                const corpo = await res.json().catch(() => ({}))
                toast.error(corpo.error ?? 'Não foi possível abrir a unidade')
                setTrocando(null)
                return
            }
            window.location.reload()
        } catch {
            setTrocando(null)
        }
    }

    const u = dados?.unidades
    const cabeMais = (u?.remaining ?? 0) > 0

    return (
        <BandLayout
            footer={
                dados?.souMaster ? (
                    cabeMais ? (
                        <Button onClick={() => { setNome(''); setErro(null); setCriando(true) }}>
                            <Plus className="size-4" />
                            Nova unidade
                        </Button>
                    ) : (
                        <Button onClick={() => void contratar()} disabled={contratando}>
                            {contratando ? <Loader2 className="size-4 animate-spin" /> : <ShoppingCart className="size-4" />}
                            Contratar unidade por {formatPrice(UNIDADE_ADICIONAL.price)}
                        </Button>
                    )
                ) : undefined
            }
        >
            <SettingsBand
                className="flex min-h-0 flex-1 flex-col"
                title="Unidades da conta"
                description={
                    u
                        ? `${dados?.plano ?? 'Seu plano'} inclui ${u.doPlano} unidade${u.doPlano === 1 ? '' : 's'}` +
                          (u.adicionais > 0
                              ? `, e você contratou ${u.adicionais} adicional${u.adicionais === 1 ? '' : 'is'}.`
                              : '.') +
                          ' Cada unidade tem pacientes, agenda e conversas próprios — os agentes e números do plano são divididos entre elas.'
                        : 'Cada unidade tem pacientes, agenda e conversas próprios.'
                }
                aside={
                    u ? (
                        <span className="num text-xs font-semibold text-muted-foreground">
                            {u.used} de {u.max}
                        </span>
                    ) : undefined
                }
                last
            >
                {carregando ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Loader2 className="size-4 animate-spin" /> Carregando…
                    </div>
                ) : (
                    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
                        <div className="flex flex-col divide-y divide-border">
                            {dados?.lista.map((unidade) => {
                                const aberta = unidade.id === dados.aberta
                                return (
                                    <div key={unidade.id} className="py-2.5 first:pt-0 last:pb-0">
                                        <SettingsRow
                                            title={
                                                <span className="flex items-center gap-2">
                                                    {unidade.name}
                                                    {aberta ? (
                                                        <Badge variant="outline" className="gap-1">
                                                            <Check className="size-3" /> aberta
                                                        </Badge>
                                                    ) : null}
                                                </span>
                                            }
                                            description={`Desde ${desde(unidade.createdAt)} · ${unidade.usuarios} usuário${unidade.usuarios === 1 ? '' : 's'} · ${unidade.pacientes} paciente${unidade.pacientes === 1 ? '' : 's'} · ${unidade.agentes} agente${unidade.agentes === 1 ? '' : 's'}`}
                                            action={
                                                aberta ? undefined : unidade.participo ? (
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        disabled={trocando === unidade.id}
                                                        onClick={() => void abrir(unidade.id)}
                                                    >
                                                        {trocando === unidade.id ? (
                                                            <Loader2 className="size-3.5 animate-spin" />
                                                        ) : null}
                                                        Abrir
                                                    </Button>
                                                ) : (
                                                    /* Dizer por que não há botão. Sem a frase, a
                                                       linha parece quebrada. */
                                                    <span className="text-xs text-muted-foreground">
                                                        Você não participa
                                                    </span>
                                                )
                                            }
                                        />
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                )}
            </SettingsBand>

            <RecordDialog
                open={criando}
                onOpenChange={setCriando}
                title="Nova unidade"
                description="A clínica nasce vazia, com você dentro. O que já existe aqui não é copiado."
                submitLabel="Criar unidade"
                submitting={salvando}
                submitDisabled={nome.trim().length < 2}
                hideAgain
                onSubmit={() => void criar()}
            >
                <FormField label="Nome da unidade" required error={erro ?? undefined}>
                    <Input
                        value={nome}
                        onChange={(e) => setNome(e.target.value)}
                        placeholder="Clínica Centro"
                        maxLength={80}
                        autoFocus
                    />
                </FormField>
            </RecordDialog>
        </BandLayout>
    )
}
