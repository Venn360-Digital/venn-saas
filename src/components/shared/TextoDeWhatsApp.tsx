import { analisarTextoDeWhatsApp, type NoDeTexto } from '@/lib/texto-whatsapp'

/**
 * O texto de uma mensagem, com a marcação do WhatsApp aplicada.
 *
 * A casca do analisador de `lib/texto-whatsapp`: ele decide o que é marcação,
 * aqui só se escolhe a classe de cada nó. Nenhuma string de HTML passa por
 * aqui — os nós viram elementos React, então texto de paciente não tem como
 * virar marcação do navegador.
 *
 * As classes são deliberadamente discretas. Numa bolha de chat, negrito é para
 * destacar uma palavra numa frase; se o destaque pesar como título, a conversa
 * fica gritada. Daí `font-semibold` e não `font-bold`, e a monoespaçada com
 * fundo de 10% em vez de caixa própria.
 */
export function TextoDeWhatsApp({ texto, className }: { texto: string; className?: string }) {
    return (
        <p className={className ?? 'whitespace-pre-wrap break-words'}>
            <Nos nos={analisarTextoDeWhatsApp(texto)} />
        </p>
    )
}

function Nos({ nos }: { nos: NoDeTexto[] }) {
    return (
        <>
            {nos.map((no, i) => (
                <No key={i} no={no} />
            ))}
        </>
    )
}

function No({ no }: { no: NoDeTexto }) {
    switch (no.tipo) {
        case 'texto':
            return <>{no.texto}</>
        case 'negrito':
            return (
                <strong className="font-semibold">
                    <Nos nos={no.filhos} />
                </strong>
            )
        case 'italico':
            return (
                <em className="italic">
                    <Nos nos={no.filhos} />
                </em>
            )
        case 'tachado':
            return (
                <s className="line-through opacity-80">
                    <Nos nos={no.filhos} />
                </s>
            )
        case 'mono':
            return (
                <code className="font-mono text-[0.92em] bg-foreground/10 rounded px-1 py-px">
                    {no.texto}
                </code>
            )
        case 'blocoMono':
            return (
                <code className="font-mono text-[0.92em] bg-foreground/10 rounded px-1.5 py-1 block my-1 overflow-x-auto">
                    {no.texto}
                </code>
            )
        /**
         * A citação é a barrinha à esquerda, como no WhatsApp. `block` e não
         * `blockquote`: o pai é um `<p>`, e `<blockquote>` dentro de `<p>` é
         * HTML inválido — o navegador fecha o parágrafo sozinho e o resto da
         * mensagem sai do lugar.
         */
        case 'citacao':
            return (
                <span className="block border-l-2 border-current/30 pl-2 my-0.5 opacity-90">
                    <Nos nos={no.filhos} />
                </span>
            )
    }
}
