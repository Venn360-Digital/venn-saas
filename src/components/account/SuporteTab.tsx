'use client'

import { useEffect, useState } from 'react'
import { LifeBuoy, Mail, MessageCircle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { BandLayout, SettingsBand, SettingsRow } from '@/components/shared/TabsFrame'
import { EmptyState } from '@/components/shared/EmptyState'

/**
 * Onde a clínica pede ajuda.
 *
 * Guia sangrada, como manda o DESIGN.md §5 (Tela 03): na Conta todas são.
 *
 * **Sem widget de terceiro de propósito.** Um balão de chat de outro fornecedor
 * dentro de um produto que já é uma tela de conversa confunde — a pessoa passa
 * o dia respondendo paciente num balão e encontraria um segundo balão, de outra
 * cor, para falar com a gente. E seria um fornecedor a mais no caminho de uma
 * ferramenta própria que já está no plano.
 *
 * Os canais vêm do ambiente. Sem nenhum configurado a guia diz isso em vez de
 * desenhar botões que não levam a lugar nenhum.
 */

const WHATSAPP = process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP?.replace(/\D/g, '') ?? ''
const EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? ''

/**
 * As perguntas que a conta de suporte vai receber mais — respondidas aqui para
 * não virarem conversa.
 *
 * Cada uma sai de uma regra real do produto, não de texto genérico de ajuda: é
 * o que faz a resposta servir. Quando uma pergunta nova aparecer três vezes no
 * WhatsApp, ela entra nesta lista.
 */
const DUVIDAS = [
    {
        p: 'O agente parou de responder. O que houve?',
        r: 'São três causas, nesta ordem de frequência: os créditos de IA acabaram (veja em Plano e créditos — o agente avisa o paciente uma vez e silencia), o agente foi pausado em Atendimento → Agentes, ou o número de WhatsApp desconectou. As conversas continuam chegando nos três casos, e a equipe segue respondendo normalmente.',
    },
    {
        p: 'Como conecto o WhatsApp?',
        r: 'Atendimento → Agentes → abra o agente → Canais → Conectar. Leia o QR Code com o aparelho que tem o número. Cada linha pertence a um agente, e um agente pode ter várias — uma por unidade, por exemplo.',
    },
    {
        p: 'O que é um crédito de IA?',
        r: 'Uma ação de IA entregue: uma resposta do agente, um resumo de conversa, uma transcrição de áudio. A franquia do plano renova 30 dias depois da contratação e não acumula — o que sobra é descartado. Crédito avulso comprado à parte vale 90 dias e só é gasto depois que o do plano acaba.',
    },
    {
        p: 'Por que não vejo as conversas de outra unidade?',
        r: 'A fila é do departamento da linha por onde a conversa entrou. Você vê as filas dos departamentos de que faz parte, mais a fila geral. Quem administra pode marcar mais departamentos para você em Conta → Usuários.',
    },
    {
        p: 'Como adiciono alguém da equipe?',
        r: 'Conta → Usuários → Novo usuário. Escolha a função (administrador, gestor ou atendente) e os departamentos cujas filas a pessoa vai atender. Atendente vê o próprio trabalho; gestor vê o de todos.',
    },
    {
        p: 'Posso marcar que a clínica atende num feriado?',
        r: 'Conta → Agenda da clínica. Os feriados nacionais já vêm bloqueando a agenda; desligue os que a clínica atende. Recesso, congresso e dedetização entram como fechamento próprio, com data e hora.',
    },
]

export function SuporteTab() {
    const [contexto, setContexto] = useState('')

    /**
     * Quem está pedindo ajuda, dito junto com o pedido.
     *
     * Sem isto a primeira resposta é sempre "de qual clínica você fala?" — uma
     * ida e volta inteira antes de começar. O texto vai no corpo da mensagem,
     * à vista: nada é mandado sem a pessoa apertar enviar.
     */
    useEffect(() => {
        let cancelado = false
        Promise.all([
            fetch('/api/me').then((r) => (r.ok ? r.json() : null)),
            fetch('/api/account/subscription').then((r) => (r.ok ? r.json() : null)),
        ])
            .then(([eu, assinatura]) => {
                if (cancelado) return
                const partes = [
                    eu?.name ? `Sou ${eu.name}` : null,
                    assinatura?.workspaceName ? `da ${assinatura.workspaceName}` : null,
                    assinatura?.planName ? `(${assinatura.planName})` : null,
                ].filter(Boolean)
                setContexto(partes.length ? `${partes.join(' ')}. ` : '')
            })
            .catch(() => { /* sem contexto, a mensagem vai mesmo assim */ })
        return () => { cancelado = true }
    }, [])

    const mensagem = `${contexto}Preciso de ajuda com `
    const linkWhatsApp = `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(mensagem)}`
    const linkEmail = `mailto:${EMAIL}?subject=${encodeURIComponent('Ajuda — OdontoBox360')}&body=${encodeURIComponent(mensagem)}`

    return (
        <BandLayout>
            <SettingsBand
                title="Fale com a gente"
                description="De segunda a sexta, das 9h às 18h. Fora disso, a mensagem fica registrada e é respondida na abertura."
            >
                {!WHATSAPP && !EMAIL ? (
                    <EmptyState
                        variant="inline"
                        icon={LifeBuoy}
                        title="Canais de suporte ainda não configurados"
                        description="Defina NEXT_PUBLIC_SUPPORT_WHATSAPP e NEXT_PUBLIC_SUPPORT_EMAIL no ambiente para que esta guia ofereça contato."
                    />
                ) : (
                    <div className="flex flex-col divide-y divide-border">
                        {WHATSAPP ? (
                            <div className="py-2.5 first:pt-0 last:pb-0">
                                <SettingsRow
                                    title="WhatsApp"
                                    description="O caminho mais rápido. A mensagem já vai com o nome da clínica e o plano, para a conversa começar do assunto."
                                    action={
                                        <Button asChild>
                                            <a href={linkWhatsApp} target="_blank" rel="noopener noreferrer">
                                                <MessageCircle className="size-4" />
                                                Abrir conversa
                                            </a>
                                        </Button>
                                    }
                                />
                            </div>
                        ) : null}
                        {EMAIL ? (
                            <div className="py-2.5 first:pt-0 last:pb-0">
                                <SettingsRow
                                    title="E-mail"
                                    description="Para o que precisa de anexo — print de tela, planilha, nota fiscal — ou de rastro escrito."
                                    action={
                                        <Button variant="outline" asChild>
                                            <a href={linkEmail}>
                                                <Mail className="size-4" />
                                                Escrever
                                            </a>
                                        </Button>
                                    }
                                />
                            </div>
                        ) : null}
                    </div>
                )}
            </SettingsBand>

            <SettingsBand
                title="Perguntas frequentes"
                description="O que mais perguntam, já respondido. Se resolver aqui, você não precisa esperar ninguém."
                last
            >
                <div className="flex flex-col divide-y divide-border">
                    {DUVIDAS.map((d) => (
                        <Collapsible key={d.p} className="py-2.5 first:pt-0 last:pb-0">
                            <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 text-left text-[13px] font-semibold hover:text-primary-subtle-foreground">
                                {d.p}
                                <span aria-hidden="true" className="shrink-0 text-muted-foreground">+</span>
                            </CollapsibleTrigger>
                            <CollapsibleContent className="pt-1.5 text-xs leading-relaxed text-muted-foreground">
                                {d.r}
                            </CollapsibleContent>
                        </Collapsible>
                    ))}
                </div>
            </SettingsBand>
        </BandLayout>
    )
}
