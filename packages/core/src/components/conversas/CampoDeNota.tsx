'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AtSign } from 'lucide-react'

import { RetratoEmDisco } from '../shared/Retrato'
import { Textarea } from '@venn/ui/textarea'
import { cn } from '@venn/ui/utils'
import { gatilhoDeMencao, inserirMencao } from '../../lib/conversas/mencoes'
import { normalizeSearch } from '../../lib/search'

/**
 * O campo da nota interna, com o seletor de `@`.
 *
 * Marcar `@colega` numa nota é o **único** gesto que põe alguém a colaborar na
 * conversa — não há botão de assinar. Então este campo não é um detalhe de
 * conforto: sem o seletor, a pessoa teria de digitar `@[Nome](cku123…)` à mão,
 * com o id do colega, o que ninguém faz. O item 6 inteiro depende dele.
 *
 * ## O gatilho mora no módulo puro, não aqui
 *
 * `gatilhoDeMencao` e `inserirMencao` vivem em `lib/conversas/mencoes.ts`, ao
 * lado de quem **lê** a menção. É de propósito: o escritor e o leitor no mesmo
 * arquivo é o que impede este seletor de inserir um formato que o
 * `extrairMencoes` não reconheça — e aí a nota marcaria alguém na tela e
 * ninguém no banco.
 *
 * ## Listbox que o textarea dirige
 *
 * Mesmo desenho do menu de `/` do compositor, e pela mesma razão: `cmdk` quer
 * ser dono do próprio input, e aqui a superfície de digitação é o campo da
 * nota. Então é um `role="listbox"` com as setas e o Enter tratados no
 * `onKeyDown` do textarea.
 */

interface Pessoa {
    userId: string
    nome: string
    /** Endereço de `/api/retratos`. Sempre existe; 404 quando não há foto. */
    retrato: string
    papel: string
    souEu: boolean
}

export function CampoDeNota({
    value,
    onChange,
    onSubmit,
    rows = 3,
    placeholder = 'Nota visível só para a equipe. Use @ para chamar alguém…',
    disabled,
}: {
    value: string
    onChange: (texto: string) => void
    onSubmit?: () => void
    rows?: number
    placeholder?: string
    disabled?: boolean
}) {
    const ref = useRef<HTMLTextAreaElement>(null)
    const [equipe, setEquipe] = useState<Pessoa[] | null>(null)
    const [busca, setBusca] = useState<string | null>(null)
    const [indice, setIndice] = useState(0)

    /**
     * A equipe é buscada **no primeiro `@`**, não ao montar.
     *
     * A maioria das notas não marca ninguém, e carregar a equipe para cada nota
     * seria uma requisição por abertura de painel para nada. Buscar no primeiro
     * `@` custa a latência de uma lista pequena enquanto a pessoa ainda digita
     * o nome.
     */
    const carregar = useCallback(async () => {
        if (equipe) return
        try {
            const res = await fetch('/api/equipe')
            const dados = res.ok ? await res.json() : null
            setEquipe(dados?.pessoas ?? [])
        } catch {
            // Falhar aqui deixa a nota funcionando sem menção, que é melhor que
            // um campo que não aceita texto porque a lista não veio.
            setEquipe([])
        }
    }, [equipe])

    const candidatos = useMemo(() => {
        if (busca === null || !equipe) return []
        const termo = normalizeSearch(busca)
        return equipe
            // Eu mesmo fora: marcar-se a si mesmo não põe ninguém novo na
            // conversa — `quemPassaAColaborar` recusa, e oferecer na lista o que
            // a regra recusa é ensinar a desconfiar da lista.
            .filter((p) => !p.souEu)
            .filter((p) => !termo || normalizeSearch(p.nome).includes(termo))
            .slice(0, 6)
    }, [busca, equipe])

    const aberto = busca !== null && candidatos.length > 0

    useEffect(() => {
        setIndice(0)
    }, [busca])

    function aoDigitar(e: React.ChangeEvent<HTMLTextAreaElement>) {
        const texto = e.target.value
        onChange(texto)

        const cursor = e.target.selectionStart ?? texto.length
        const gatilho = gatilhoDeMencao(texto.slice(0, cursor))
        setBusca(gatilho)
        if (gatilho !== null) void carregar()
    }

    function escolher(pessoa: Pessoa) {
        const el = ref.current
        const cursor = el?.selectionStart ?? value.length
        const { texto, cursor: novoCursor } = inserirMencao(
            value,
            cursor,
            pessoa.nome,
            pessoa.userId
        )
        onChange(texto)
        setBusca(null)

        // O cursor tem de voltar para depois da menção, e só depois do render —
        // antes disso o textarea ainda tem o texto antigo e a posição seria
        // aplicada no lugar errado.
        requestAnimationFrame(() => {
            el?.focus()
            el?.setSelectionRange(novoCursor, novoCursor)
        })
    }

    function aoTeclar(e: React.KeyboardEvent<HTMLTextAreaElement>) {
        if (aberto) {
            if (e.key === 'ArrowDown') {
                e.preventDefault()
                setIndice((i) => (i + 1) % candidatos.length)
                return
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault()
                setIndice((i) => (i - 1 + candidatos.length) % candidatos.length)
                return
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault()
                escolher(candidatos[Math.min(indice, candidatos.length - 1)])
                return
            }
            if (e.key === 'Escape') {
                e.preventDefault()
                setBusca(null)
                return
            }
        }

        // Ctrl/Cmd+Enter salva: a nota é texto de várias linhas, então Enter
        // sozinho tem de continuar quebrando linha.
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            onSubmit?.()
        }
    }

    return (
        <div className="relative">
            {aberto ? (
                <div
                    role="listbox"
                    aria-label="Chamar alguém da equipe"
                    className="absolute bottom-full left-0 right-0 z-50 mb-1 max-h-[216px] overflow-y-auto rounded-lg border bg-popover p-1 shadow-md"
                >
                    <div className="flex items-center justify-between px-2 py-1.5">
                        <span className="flex items-center gap-1 text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
                            <AtSign className="size-3" aria-hidden="true" />
                            Chamar
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                            ↑↓ navegar · Enter escolher
                        </span>
                    </div>
                    {candidatos.map((p, i) => (
                        <button
                            key={p.userId}
                            type="button"
                            role="option"
                            aria-selected={i === indice}
                            onMouseEnter={() => setIndice(i)}
                            onClick={() => escolher(p)}
                            className={cn(
                                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                                i === indice ? 'bg-accent' : 'hover:bg-muted/50'
                            )}
                        >
                            <RetratoEmDisco
                                endereco={p.retrato}
                                nome={p.nome}
                                className="size-6 text-[9px]"
                            />
                            <span className="min-w-0 flex-1 truncate text-xs font-medium">
                                {p.nome}
                            </span>
                        </button>
                    ))}
                </div>
            ) : null}

            <Textarea
                ref={ref}
                value={value}
                onChange={aoDigitar}
                onKeyDown={aoTeclar}
                onBlur={() => setBusca(null)}
                rows={rows}
                placeholder={placeholder}
                disabled={disabled}
                aria-label="Nova nota interna"
            />
        </div>
    )
}
