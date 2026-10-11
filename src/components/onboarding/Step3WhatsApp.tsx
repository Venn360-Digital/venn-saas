'use client'

import { Button } from '@/components/ui/button'
import { ArrowRight, ArrowLeft, Loader2, MessageCircle } from 'lucide-react'

interface Step3WhatsAppProps {
    /** `true` depois que o aparelho pareou nesta sessão. */
    connected: boolean
    /** Provisiona o necessário e abre o código de pareamento. */
    onConnect: () => void
    connecting: boolean
    onNext: () => void
    onBack: () => void
}

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
 */
export function Step3WhatsApp({ connected, onConnect, connecting, onNext, onBack }: Step3WhatsAppProps) {
    return (
        <div className="rounded-2xl border border-border bg-card p-8">
            <div className="mb-8">
                <h2 className="mb-2 text-2xl font-bold">WhatsApp</h2>
                <p className="text-muted-foreground">Conecte sua conta do WhatsApp</p>
            </div>

            <div className="py-12 text-center">
                <div className="mb-6 flex justify-center">
                    <div
                        className={
                            connected
                                ? 'flex h-24 w-24 items-center justify-center rounded-full bg-success'
                                : 'flex h-24 w-24 items-center justify-center rounded-full bg-success-subtle'
                        }
                    >
                        <MessageCircle
                            className={
                                connected
                                    ? 'h-12 w-12 text-success-foreground'
                                    : 'h-12 w-12 text-success-subtle-foreground'
                            }
                        />
                    </div>
                </div>

                <h3 className="mb-4 text-xl font-bold">
                    {connected ? 'WhatsApp conectado' : 'Conectar WhatsApp'}
                </h3>
                <p className="mx-auto mb-8 max-w-md text-muted-foreground">
                    {connected
                        ? 'O aparelho está pareado. Dá para desconectar quando quiser, em Atendimento → Agentes.'
                        : 'Abra o WhatsApp no celular, vá em Aparelhos conectados e leia o código. Dá para conectar depois, em Atendimento → Agentes.'}
                </p>

                {connected ? null : (
                    <Button onClick={onConnect} disabled={connecting} className="gap-2">
                        {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        {connecting ? 'Preparando…' : 'Ler o código'}
                    </Button>
                )}
            </div>

            <div className="mt-8 flex items-center justify-between border-t border-border pt-6">
                <Button
                    onClick={onBack}
                    variant="outline"
                    className="border-border bg-transparent text-foreground hover:bg-accent"
                >
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Voltar
                </Button>
                <Button onClick={onNext} variant={connected ? 'default' : 'outline'}>
                    {connected ? 'Continuar' : 'Pular por agora'}
                    <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
            </div>
        </div>
    )
}
