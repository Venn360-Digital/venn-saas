'use client'

import { CheckCircle2, MessageCircle } from 'lucide-react'

import { BRAND } from '@/config/brand'

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
 * **Sem cartão próprio.** Ele tinha borda, fundo e respiro de 20px — e isso era
 * certo quando o passo era um cartão solto numa página. Hoje o conteúdo já vive
 * dentro do cartão da moldura, e um cartão dentro do cartão cobra duas molduras
 * para dizer uma frase. O botão de ler o código mora no rodapé da moldura.
 */
export function Step3WhatsApp({ connected }: { connected: boolean }) {
    const Icone = connected ? CheckCircle2 : MessageCircle

    return (
        <div className="flex h-full flex-col items-center justify-center text-center">
            <div
                className={
                    connected
                        ? 'flex size-16 items-center justify-center rounded-full bg-success'
                        : 'flex size-16 items-center justify-center rounded-full bg-success-subtle'
                }
            >
                <Icone
                    className={
                        connected
                            ? 'size-8 text-success-foreground'
                            : 'size-8 text-success-subtle-foreground'
                    }
                    aria-hidden="true"
                />
            </div>

            <h2 className="mt-5 text-h4">
                {connected
                    ? 'WhatsApp conectado'
                    : `Conecte o número da ${BRAND.vocabulario.organizacao}`}
            </h2>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
                {connected
                    ? 'O aparelho está pareado. Dá para desconectar quando quiser, em Atendimento → Agentes.'
                    : 'Abra o WhatsApp no celular, vá em Aparelhos conectados e leia o código que vai aparecer.'}
            </p>
        </div>
    )
}
