'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, LogOut } from 'lucide-react'

import { Button } from '@venn/ui/button'

/**
 * A tarja de "você está dentro da conta de um cliente".
 *
 * ## Por que ela é grande e fica no topo de tudo
 *
 * O risco desta funcionalidade inteira não é técnico, é humano: **esquecer que
 * está lá dentro**. Quem esquece responde um paciente achando que testa, muda
 * uma configuração achando que é a própria conta, e descobre horas depois. Uma
 * pista discreta não serve — a tarja ocupa uma faixa inteira, empurra o
 * aplicativo para baixo e não se dispensa.
 *
 * É o mesmo raciocínio do DESIGN.md sobre o que destrói morar em cartão
 * próprio: a diferença entre dois estados não pode depender de reparar numa
 * cor.
 *
 * ## O que ela promete, e por que a promessa é verdadeira
 *
 * "Tudo o que você fizer é gravado." É: a sessão continua sendo a do operador
 * — não há troca de identidade, só de unidade —, então toda linha que ele
 * gravar leva o `userId` dele. O recorte de tempo está em `platform_access_log`.
 *
 * ## O relógio
 *
 * A sessão dura uma hora e o cookie expira sozinho. O contador existe para a
 * saída não ser uma surpresa no meio de um formulário meio preenchido.
 */

interface Estado {
    ativa: boolean
    unidade: string | null
    conta: string | null
    modo: 'leitura' | 'total'
    expiraEm: string | null
}

export function TarjaDeAcesso() {
    const [estado, setEstado] = useState<Estado | null>(null)
    const [saindo, setSaindo] = useState(false)
    const [agora, setAgora] = useState(() => Date.now())

    useEffect(() => {
        let vivo = true
        void fetch('/api/plataforma/assumida')
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => {
                if (vivo && d?.ativa) setEstado(d)
            })
            .catch(() => {
                /* sem tarja: o pior caso é não mostrar, e aí nada muda */
            })
        return () => {
            vivo = false
        }
    }, [])

    // O relógio só anda quando há tarja: um `setInterval` por minuto em toda
    // tela do produto, para quase ninguém, seria custo sem retorno.
    useEffect(() => {
        if (!estado?.ativa) return
        const t = setInterval(() => setAgora(Date.now()), 30_000)
        return () => clearInterval(t)
    }, [estado?.ativa])

    if (!estado?.ativa) return null

    const faltam = estado.expiraEm
        ? Math.max(0, Math.round((new Date(estado.expiraEm).getTime() - agora) / 60_000))
        : null

    const sair = async () => {
        setSaindo(true)
        await fetch('/api/plataforma/assumir', { method: 'DELETE' }).catch(() => {})
        // Recarga inteira: o layout do painel é renderizado no servidor e
        // carrega dado de sessão. Ver DESIGN.md §6.
        window.location.assign('/plataforma')
    }

    return (
        <div
            role="status"
            className="flex h-11 shrink-0 items-center gap-3 border-b border-warning-subtle bg-warning-subtle px-4 shadow-[inset_0_3px_0_var(--warning)] md:px-6"
        >
            <AlertTriangle
                className="size-4 shrink-0 text-warning-subtle-foreground"
                aria-hidden="true"
            />
            <p className="min-w-0 truncate text-[13px] text-warning-subtle-foreground">
                Você está dentro de <strong className="font-semibold">{estado.conta}</strong>
                {estado.unidade ? ` — ${estado.unidade}` : ''}
                {estado.modo === 'total' ? (
                    <> com poder de gravar. Tudo o que você fizer fica registrado com o seu nome.</>
                ) : (
                    <> em somente leitura. Nada do que você abrir aqui pode ser gravado.</>
                )}
            </p>

            {faltam !== null ? (
                <span className="num ml-auto shrink-0 text-xs text-warning-subtle-foreground">
                    sai em {faltam} min
                </span>
            ) : (
                <span className="ml-auto" />
            )}

            <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 shrink-0 border-warning-subtle-foreground/40 text-warning-subtle-foreground"
                disabled={saindo}
                onClick={() => void sair()}
            >
                <LogOut className="size-4" />
                Sair desta conta
            </Button>
        </div>
    )
}
