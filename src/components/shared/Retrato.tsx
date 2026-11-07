'use client'

import { useState } from 'react'

import { cn } from '@/lib/utils'

/**
 * A foto de quem está na conversa — e o nome enquanto ela não chega.
 *
 * Decisão do Andre: no cartão, **a foto substitui o nome**, do agente e do
 * responsável. A razão é de espaço, e é a mesma que tirou os colaboradores do
 * cartão: naquela faixa de 10px convivem o agente, a linha de entrada e o
 * responsável, e três nomes escritos ali se leem como uma frase só.
 *
 * O nome não desaparece de quem precisa dele: fica no `alt` (leitor de tela) e
 * no `title` (passar o mouse).
 *
 * ## O nome vem primeiro, e a imagem entra por cima
 *
 * Esta é a parte que mudou, e não é estética. A primeira versão perguntava ao
 * servidor "esta pessoa tem foto?" para decidir entre imagem e nome — e
 * responder isso obrigava **toda** consulta de lista a trazer a coluna
 * `avatar`, que guarda a foto inteira. Medido em produção: 275 kB em dois
 * usuários, atravessando o Neon a cada carga da lista de conversas, do painel
 * de equipe e de `/api/auth/me`, para produzir um booleano.
 *
 * Então o servidor parou de responder. O endereço do retrato **sempre existe**
 * (sai de `id` + `updatedAt`), e quem não tem foto recebe 404 — cacheado por
 * uma hora, para a lista não repreguntar. O componente desenha o nome e põe a
 * imagem **sobreposta**, revelada só quando carrega: sem piscada, sem imagem
 * quebrada, e sem ninguém precisar saber de antemão quem tem foto.
 *
 * `onError` não faz nada de propósito — não há para onde cair, porque o estado
 * de baixo já é o nome. Ele existe só para o React não reclamar de imagem que
 * falha, e para o `opacity` nunca ir a 1 num 404.
 */
export function Retrato({
    endereco,
    nome,
    className,
    classNameTexto,
}: {
    /** URL de `/api/retratos`. Sempre existe; 404 quando não há foto. */
    endereco: string
    /** Como chamar quem está na foto. Vira `alt`, `title` e o texto de baixo. */
    nome: string
    /** Classes da imagem. O tamanho vem de quem chama, porque varia por faixa. */
    className?: string
    /** Classes do texto que fica embaixo. */
    classNameTexto?: string
}) {
    const [carregou, setCarregou] = useState(false)

    return (
        <span className="relative inline-flex shrink-0 items-center" title={nome}>
            <span
                className={cn('truncate transition-opacity', classNameTexto)}
                // `aria-hidden` quando a foto aparece: o nome já está no `alt`
                // da imagem, e dois nomes seguidos num leitor de tela é ruído.
                aria-hidden={carregou || undefined}
                style={carregou ? { opacity: 0 } : undefined}
            >
                {nome}
            </span>
            {/* eslint-disable-next-line @next/next/no-img-element -- `next/image`
                não serve aqui: a rota já devolve `immutable` por um ano e o
                otimizador do Next não tem o que acrescentar a uma imagem de
                14px autorizada por sessão — passaria por um proxy a mais para
                chegar ao mesmo byte. */}
            <img
                src={endereco}
                alt={nome}
                loading="lazy"
                decoding="async"
                onLoad={() => setCarregou(true)}
                className={cn(
                    'absolute left-0 rounded-full object-cover transition-opacity',
                    carregou ? 'opacity-100' : 'opacity-0',
                    className
                )}
            />
        </span>
    )
}

/** Iniciais, para o disco. Duas no máximo — três já não se leem em 24px. */
export function iniciaisDo(nome: string): string {
    const partes = nome.trim().split(/\s+/).filter(Boolean)
    if (!partes.length) return '?'
    if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase()
    return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase()
}

/**
 * O retrato em disco, com as iniciais atrás — o avatar redondo de sempre.
 *
 * Mesma ideia do `Retrato`: as iniciais são o estado de baixo e a imagem entra
 * por cima quando carrega. A diferença é a forma — aqui o disco existe sempre,
 * com fundo e tamanho próprios, e é ele que o painel de equipe, a pilha do
 * cabeçalho e o seletor de menção desenham.
 *
 * Existe para esses três não repetirem a lógica do `onLoad`. Eles faziam
 * `retrato ? <img> : iniciais`, que era correto enquanto o servidor dizia se
 * havia foto; com o endereço sempre presente, aquele ternário mostraria imagem
 * quebrada para quem não tem foto. Ver `lib/retratos.ts`.
 */
export function RetratoEmDisco({
    endereco,
    nome,
    className,
}: {
    endereco: string
    nome: string
    /** Tamanho, borda e fundo do disco. */
    className?: string
}) {
    const [carregou, setCarregou] = useState(false)

    return (
        <span
            title={nome}
            className={cn(
                'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted font-bold text-muted-foreground',
                className
            )}
        >
            <span aria-hidden={carregou || undefined}>{iniciaisDo(nome)}</span>
            {/* eslint-disable-next-line @next/next/no-img-element -- ver `Retrato` */}
            <img
                src={endereco}
                alt={nome}
                loading="lazy"
                decoding="async"
                onLoad={() => setCarregou(true)}
                className={cn(
                    'absolute inset-0 size-full rounded-full object-cover transition-opacity',
                    carregou ? 'opacity-100' : 'opacity-0'
                )}
            />
        </span>
    )
}
