'use client'

import { CheckCircle2, MessageCircle } from 'lucide-react'

/**
 * Parear o WhatsApp aqui, no meio do cadastro.
 *
 * O pareamento precisa de um workspace e de um agente, que só existiriam no
 * fim — então clicar em conectar cria os dois na hora e abre o QR. O cadastro
 * termina normalmente depois, e é o aceite do passo 5 que o fecha.
 *
 * Quem abandonar aqui deixa um cadastro pela metade, e isso é tratado: sem o
 * aceite registrado, a próxima visita volta para o onboarding em vez de entrar
 * no painel.
 *
 * O botão de ler o código mora no rodapé da moldura, com as outras ações. Este
 * passo gastava 12rem de respiro vertical (`py-12`) e um disco de 96px para
 * dizer uma frase; o disco está em 56px e o respiro saiu.
 */
export function Step3WhatsApp({ connected }: { connected: boolean }) {
    const Icone = connected ? CheckCircle2 : MessageCircle

    return (
        <div className="flex items-start gap-4 rounded-lg border border-border bg-card p-5">
            <div
                className={
                    connected
                        ? 'flex size-14 shrink-0 items-center justify-center rounded-full bg-success'
                        : 'flex size-14 shrink-0 items-center justify-center rounded-full bg-success-subtle'
                }
            >
                <Icone
                    className={
                        connected
                            ? 'size-7 text-success-foreground'
                            : 'size-7 text-success-subtle-foreground'
                    }
                    aria-hidden="true"
                />
            </div>

            <div className="min-w-0 space-y-1">
                <h2 className="text-sm font-semibold">
                    {connected ? 'WhatsApp conectado' : 'Conectar WhatsApp'}
                </h2>
                <p className="text-sm text-muted-foreground">
                    {connected
                        ? 'O aparelho está pareado. Dá para desconectar quando quiser, em Atendimento → Agentes.'
                        : 'Abra o WhatsApp no celular, vá em Aparelhos conectados e leia o código que vai aparecer. Dá para conectar depois, em Atendimento → Agentes.'}
                </p>
            </div>
        </div>
    )
}
