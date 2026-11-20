import { AtSign } from 'lucide-react'

import { partirNota } from '../../lib/conversas/mencoes'
import { TextoDeWhatsApp } from './TextoDeWhatsApp'

/**
 * O texto de uma nota interna, com as menções em destaque.
 *
 * A menção é gravada como `@[Ana Paula](cku123…)` — o id dentro do texto, de
 * propósito (ver `lib/conversas/mencoes.ts`). Até 20/11/2026 nenhum componente
 * lia isso: o fio e o painel de notas mostravam a sintaxe crua, e a atendente
 * via o id do colega no meio da frase. `partirNota` já existia e não tinha
 * consumidor; agora tem dois.
 *
 * A menção vira um chip discreto — o `@` e o nome como estava quando a nota
 * foi escrita. O resto passa pelo `TextoDeWhatsApp`, para `*negrito*` numa
 * nota continuar valendo como em qualquer mensagem.
 */
export function TextoDeNota({ texto, className }: { texto: string; className?: string }) {
    const pedacos = partirNota(texto)
    if (pedacos.every((p) => p.tipo === 'texto')) {
        return <TextoDeWhatsApp texto={texto} className={className} />
    }

    return (
        <p className={className ?? 'whitespace-pre-wrap break-words'}>
            {pedacos.map((p, i) =>
                p.tipo === 'mencao' ? (
                    <span
                        key={i}
                        className="inline-flex items-center gap-0.5 rounded bg-primary-subtle px-1 py-px text-[0.92em] font-medium text-primary-subtle-foreground align-baseline"
                        title={`Marcou ${p.nome}`}
                    >
                        <AtSign className="size-3" aria-hidden="true" />
                        {p.nome}
                    </span>
                ) : (
                    <TextoDeWhatsApp key={i} texto={p.texto} className="inline whitespace-pre-wrap break-words" />
                )
            )}
        </p>
    )
}
