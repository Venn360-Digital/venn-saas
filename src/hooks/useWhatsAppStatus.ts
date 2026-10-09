'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

/**
 * Quais destes números têm WhatsApp, e como abrir a conversa de um deles.
 *
 * Vive num hook porque três telas precisam da mesma resposta — a lista de
 * pacientes, o quadro de negócios e a lista de negócios — e porque a consulta
 * tem de ser em lote: vinte linhas na tela não podem significar vinte viagens
 * ao provedor.
 *
 * A consulta acontece **depois** que a lista pinta, e o acumulador guarda o que
 * já se sabe, de modo que paginar não repergunta pelos mesmos números. Falha de
 * rede não quebra nada: o ícone fica apagado e a tela segue.
 */
export function useWhatsAppStatus(phones: (string | null | undefined)[]) {
    const router = useRouter()
    const [status, setStatus] = useState<Record<string, boolean | null>>({})
    const [opening, setOpening] = useState<string | null>(null)

    // A chave da dependência é o conjunto de números, não o array: um novo array
    // com os mesmos números não deve disparar outra consulta.
    const key = phones.filter(Boolean).join(',')

    useEffect(() => {
        const pending = key.split(',').filter((phone) => phone && !(phone in status))
        if (pending.length === 0) return

        let cancelled = false
        fetch('/api/contacts/whatsapp-status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phones: pending }),
        })
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => {
                if (cancelled || !data?.status) return
                setStatus((prev) => ({ ...prev, ...data.status }))
            })
            .catch(() => { })
        return () => {
            cancelled = true
        }
        // `status` é o acumulador: entrar nas dependências faria o efeito se
        // reexecutar com a própria resposta.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key])

    /**
     * Abre o atendimento deste paciente.
     *
     * Mesma rota do Novo atendimento, então a regra é uma só: existe conversa,
     * abre a dele; não existe, cria. Sem caminho paralelo que um dia divergiria.
     */
    const open = useCallback(
        async (contact: { id?: string; name?: string | null; phone?: string | null }) => {
            if (!contact.phone) return
            setOpening(contact.id ?? contact.phone)
            try {
                const res = await fetch('/api/conversations/intake', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ mode: 'active', phone: contact.phone, name: contact.name ?? '' }),
                })
                const data = await res.json().catch(() => ({}))
                if (!res.ok) {
                    toast.error(data.error || 'Não foi possível abrir a conversa')
                    return
                }
                router.push(`/atendimento/conversas?conv=${data.conversationId}`)
            } catch {
                toast.error('Não foi possível abrir a conversa')
            } finally {
                setOpening(null)
            }
        },
        [router]
    )

    return { status, opening, open }
}
