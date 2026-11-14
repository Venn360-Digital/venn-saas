'use client'

import { useState } from 'react'
import { Check, ChevronsUpDown, Hospital } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@venn/ui/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@venn/ui/dropdown-menu'
import { cn } from '@venn/ui/utils'
import { trocarDeUnidade, useUnidades, type UnidadeAberta } from '../../hooks/useUnidades'

/**
 * Em qual clínica o sistema está — e, com mais de uma, o seletor.
 *
 * No cabeçalho e não na marca da sidebar (onde ele viveu meio dia, na fase 3).
 * Três razões para a troca: a marca recolhe para um ícone de 32px e o seletor
 * ia embora com ela; a marca já é o link para o início, e um elemento que é link
 * **e** menu não anuncia o que faz; e o cabeçalho é onde mora o estado da sessão
 * — som, avisos, tema, quem está logado. "Em que clínica estou" é estado de
 * sessão, não identidade do produto.
 *
 * **Com uma unidade, nome e nada mais.** Não é botão, não abre nada, não tem
 * seta: um menu de um item só ensina que não há escolha. E mesmo sozinho o nome
 * vale a tinta — é ele que diferencia "a clínica" do "sistema" para quem olha a
 * tela pela primeira vez.
 */
export function UnitSwitcher({ inicial }: { inicial?: UnidadeAberta | null }) {
    const { dados, carregando } = useUnidades(inicial)
    const [trocando, setTrocando] = useState(false)

    // Nada enquanto não se sabe: um nome que aparece e muda logo depois lê como
    // defeito. O cabeçalho não reserva espaço para isso — os ícones à direita
    // ficam onde estão.
    if (carregando || !dados.name) return null

    /**
     * O nome da clínica no azul da marca, nos dois temas — pedido do Andre, e
     * de fato destaca sem gritar.
     *
     * O token é `primary-subtle-foreground` e **não** `primary`: o teal cru
     * (#06B6D4) dá 2,5:1 sobre o fundo claro, abaixo do piso de 4,5:1 para
     * texto, e o DESIGN.md §2 já mediu isso quando proibiu branco sobre teal.
     * Este é o mesmo azul em forma de texto — #0A5566 no claro (7,8:1) e
     * #7FDCEC no escuro (10,9:1). É o da guia ativa, então o destaque já é
     * vocabulário da casa, não cor nova.
     */
    const CLASSE_NOME =
        'max-w-[11rem] truncate text-sm font-semibold text-primary-subtle-foreground md:max-w-[16rem]'

    /**
     * O fio é daqui, e não do cabeçalho.
     *
     * Deixado lá, ele desenhava um risco solto à esquerda do volume nas telas em
     * que este componente não devolve nada — carregando, ou sem clínica.
     */
    const FIO = <span aria-hidden="true" className="mx-2 h-5 w-px bg-border sm:mx-3" />

    if (dados.unidades.length < 2) {
        return (
            <>
                <span className="flex items-center gap-1.5 pl-1 text-primary-subtle-foreground">
                    <Hospital className="size-4 shrink-0" aria-hidden="true" />
                    <span className={CLASSE_NOME}>{dados.name}</span>
                </span>
                {FIO}
            </>
        )
    }

    const trocar = async (id: string) => {
        if (id === dados.id || trocando) return
        setTrocando(true)
        const erro = await trocarDeUnidade(id)
        if (erro) {
            toast.error(erro)
            setTrocando(false)
        }
        // Sem erro a página já está recarregando: deixar `trocando` ligado
        // mantém o menu travado até a tela nova chegar.
    }

    return (
        <>
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    disabled={trocando}
                    aria-label={`Clínica atual: ${dados.name}. Trocar de clínica`}
                    className="gap-1.5 px-2 text-primary-subtle-foreground hover:bg-primary-subtle hover:text-primary-subtle-foreground"
                >
                    <Hospital className="size-4 shrink-0" aria-hidden="true" />
                    <span className={CLASSE_NOME}>{dados.name}</span>
                    <ChevronsUpDown className="size-3.5 shrink-0 opacity-70" aria-hidden="true" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
                    {dados.conta ?? 'Unidades'}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {dados.unidades.map((u) => (
                    <DropdownMenuItem key={u.id} onClick={() => void trocar(u.id)} className="gap-2">
                        <Check className={cn('size-4 shrink-0', u.id !== dados.id && 'opacity-0')} />
                        <span className="truncate">{u.name}</span>
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
        {FIO}
        </>
    )
}
