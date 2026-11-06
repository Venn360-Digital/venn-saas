'use client'

import { useState } from 'react'

import { cn } from '@/lib/utils'

/**
 * A foto de quem está na conversa — e o nome quando não há foto.
 *
 * Decisão do Andre: no cartão, **a foto substitui o nome**, do agente e do
 * responsável. A razão é de espaço, e é a mesma que tirou os colaboradores do
 * cartão: naquela faixa de 10px convivem o agente, a linha de entrada e o
 * responsável, e três nomes escritos ali se leem como uma frase só.
 *
 * O nome não desaparece de quem precisa dele: vai no `alt` (leitor de tela) e
 * no `title` (passar o mouse). Trocar nome por foto só é ganho se o nome
 * continuar alcançável.
 *
 * ## A queda para trás é obrigatória, não defensiva
 *
 * `endereco` nulo é o caso **normal** — hoje nenhum dos dois agentes de produção
 * tem foto, e é o nome que aparece. E mesmo com endereço a imagem pode falhar:
 * a foto apagada entre a montagem da lista e a busca da imagem devolve 404. Nos
 * dois casos o nome entra no lugar, e por isso ele é sempre uma propriedade
 * obrigatória — um retrato que não sabe o nome de quem retrata não tem como
 * cair para trás.
 *
 * Os bytes nunca passam por aqui: `endereco` é uma URL de `/api/retratos`, que
 * é cacheada por um ano pelo navegador. Ver `lib/retratos.ts` para a medição que
 * tornou isso necessário.
 */
export function Retrato({
    endereco,
    nome,
    className,
    classNameTexto,
}: {
    /** URL de `/api/retratos`, ou `null` quando não há foto. */
    endereco: string | null
    /** Como chamar quem está na foto. Vira `alt`, `title` e o texto da queda. */
    nome: string
    /** Classes da imagem. O tamanho vem de quem chama, porque varia por faixa. */
    className?: string
    /** Classes do texto da queda para trás. */
    classNameTexto?: string
}) {
    const [falhou, setFalhou] = useState(false)

    if (!endereco || falhou) {
        return (
            <span className={cn('truncate', classNameTexto)} title={nome}>
                {nome}
            </span>
        )
    }

    return (
        // eslint-disable-next-line @next/next/no-img-element -- `next/image` não
        // serve aqui: a rota já devolve `immutable` por um ano e o otimizador do
        // Next não tem o que acrescentar a uma imagem de 14px autorizada por
        // sessão — passaria por um proxy a mais para chegar ao mesmo byte.
        <img
            src={endereco}
            alt={nome}
            title={nome}
            loading="lazy"
            decoding="async"
            onError={() => setFalhou(true)}
            className={cn('shrink-0 rounded-full object-cover', className)}
        />
    )
}
