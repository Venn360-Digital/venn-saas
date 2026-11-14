import Link from 'next/link'

import type { EstadoDoConvite } from '@/lib/convite/estado'
import { Button } from '@venn/ui/button'
import { Logo } from '@/components/brand/Logo'

/**
 * O convite que não vale mais — e o que fazer agora.
 *
 * Quatro estados, quatro frases, e cada frase termina numa ação. A versão fácil
 * seria "link inválido" para todos: é o que não ajuda ninguém. Quem já aceitou
 * precisa saber que a conta existe e que o caminho é entrar; quem chegou tarde
 * precisa saber a quem pedir outro.
 *
 * O que nenhuma delas diz é o nome da clínica — um convite que não vale mais não
 * é lugar para contar onde ele valia.
 */

/**
 * `invalido` não é estado de convite — é a **ausência** de convite.
 *
 * `EstadoDoConvite` descreve uma linha que existe (`lib/convite/estado.ts`), e
 * token que não casa com linha nenhuma não tem estado. Então o tipo da tela é
 * mais largo que o do domínio de propósito, e a largura mora aqui em vez de
 * poluir o módulo puro com um valor que ele nunca produz.
 */
type Encerramento = Exclude<EstadoDoConvite, 'pendente'> | 'invalido'

const FRASE: Record<Encerramento, { titulo: string; corpo: string }> = {
    aceito: {
        titulo: 'Esse convite já foi usado',
        corpo: 'Seu acesso já existe. Entre com o seu e-mail e a senha que você escolheu.',
    },
    expirado: {
        titulo: 'Esse convite expirou',
        corpo: 'Peça outro a quem te convidou — leva um clique do lado de lá.',
    },
    revogado: {
        titulo: 'Esse convite foi cancelado',
        corpo: 'Se foi engano, peça outro a quem te convidou.',
    },
    invalido: {
        titulo: 'Esse link não é válido',
        corpo: 'Ele pode ter sido copiado pela metade. Confira o e-mail e abra o link inteiro.',
    },
}

export function ConviteEncerrado({ estado }: { estado: Encerramento }) {
    const { titulo, corpo } = FRASE[estado]

    return (
        <div className="flex min-h-svh items-center justify-center bg-background px-4 py-10">
            <div className="w-full max-w-sm">
                <div className="mb-8">
                    <Logo variant="wordmark" height={30} priority />
                </div>

                <h1 className="text-h1">{titulo}</h1>
                <p className="mt-1 mb-6 text-sm text-muted-foreground">{corpo}</p>

                {/* Só quem já aceitou tem para onde ir daqui; para os outros o
                    próximo passo é com outra pessoa, e um botão de login seria
                    um caminho que não resolve. */}
                {estado === 'aceito' ? (
                    <Button asChild className="w-full">
                        <Link href="/login">Entrar</Link>
                    </Button>
                ) : null}
            </div>
        </div>
    )
}
