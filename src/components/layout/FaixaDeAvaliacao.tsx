import Link from 'next/link'
import { TriangleAlert } from 'lucide-react'

import type { Avaliacao } from '@/lib/avaliacao'
import { cn } from '@venn/ui/utils'

/**
 * A faixa de avaliação — proposta A, escolhida pelo Andre em 2026-11-04.
 *
 * Quarenta pixels presos abaixo da barra superior, em **toda** tela do painel,
 * do primeiro ao último dia. Das três propostas, é a que não depende de a
 * pessoa olhar para o lugar certo na hora certa: a de escalada só aparece
 * faltando três dias, e o cartão flutuante pode ser dispensado justamente por
 * quem precisava vê-lo.
 *
 * O que paga os 40px é a escalada de tom. Uma faixa que diz a mesma coisa da
 * mesma cor por sete dias vira papel de parede na terça-feira; esta muda de
 * roupa duas vezes antes de o prazo acabar, e a mudança é o que volta a chamar
 * atenção sem precisar de animação nem de alarme.
 *
 * Componente de **servidor**: recebe o estado já resolvido pelo layout e não
 * busca nada. É o que evita a faixa surgir depois do primeiro paint empurrando
 * a página inteira para baixo.
 *
 * ## Acessibilidade
 *
 * A trilha de segmentos é decorativa e leva `aria-hidden`; quem usa leitor de
 * tela recebe a mesma informação pela frase, que é escrita por extenso. A faixa
 * **não** é `role="alert"`: ela está presente desde o primeiro dia e um alerta
 * que se repete a cada navegação é ruído, não aviso.
 */
export function FaixaDeAvaliacao({ avaliacao }: { avaliacao: Avaliacao | null }) {
    if (!avaliacao) return null

    const { diasRestantes, diasTotais, encerrada } = avaliacao

    /**
     * Três tons, e o corte é por quanto a decisão ainda pode esperar.
     *
     * Três dias ou mais: informação. Dois ou um: a decisão passou a ter data.
     * Hoje, ou já encerrada: a operação está em risco ou já parou.
     */
    const tom = encerrada || diasRestantes === 0 ? 'ultimo' : diasRestantes <= 2 ? 'perto' : 'calmo'

    const cores = {
        calmo: 'border-primary-subtle-foreground/15 bg-primary-subtle text-primary-subtle-foreground',
        perto: 'border-warning-subtle-foreground/20 bg-warning-subtle text-warning-subtle-foreground',
        ultimo: 'border-destructive-subtle-foreground/20 bg-destructive-subtle text-destructive-subtle-foreground',
    }[tom]

    const botao = {
        calmo: 'bg-primary text-primary-foreground hover:bg-primary-hover',
        perto: 'bg-warning text-warning-foreground hover:brightness-110',
        ultimo: 'bg-destructive text-destructive-foreground hover:bg-destructive-hover',
    }[tom]

    return (
        <div
            className={cn(
                'flex h-10 shrink-0 items-center gap-3 overflow-y-hidden border-b px-4 md:px-6',
                cores
            )}
        >
            {encerrada ? (
                <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
            ) : (
                <TrilhaDeDias restantes={diasRestantes} totais={diasTotais} />
            )}

            <p className="min-w-0 truncate text-[13px]">{frase(avaliacao)}</p>

            <span className="flex-1" />

            <Link
                href="/gerenciamento/conta?tab=plano"
                className={cn(
                    'inline-flex h-7 shrink-0 items-center rounded-lg px-3.5 text-[12.5px] font-bold transition-colors',
                    botao
                )}
            >
                {encerrada === 'corte' ? 'Reativar assinatura' : 'Assinar agora'}
            </Link>
        </div>
    )
}

/**
 * A frase, por extenso, porque é ela que o leitor de tela anuncia.
 *
 * "Faltam 0 dias" não é português; o último dia é dito como último dia. E o
 * horário de encerramento é fixo em 23h59 porque é assim que `trialEndFrom` o
 * calcula — o sétimo dia inteiro, no fuso de São Paulo.
 */
function frase({ diasRestantes, encerrada }: Avaliacao): string {
    if (encerrada === 'trial') {
        return 'Avaliação encerrada — a conta está em somente leitura e o agente não responde.'
    }
    if (encerrada === 'corte') {
        return 'Assinatura inativa — a conta está em somente leitura e o agente não responde.'
    }
    if (diasRestantes === 0) return 'Último dia da avaliação gratuita — encerra hoje às 23h59.'
    if (diasRestantes === 1) return 'Falta 1 dia de avaliação gratuita.'
    return `Faltam ${diasRestantes} dias de avaliação gratuita.`
}

/**
 * Os sete dias como sete traços, os gastos apagados.
 *
 * Decorativa: diz em forma o que a frase ao lado diz em palavra. Serve para a
 * leitura de relance — ver quatro traços acesos custa menos que ler "faltam 4
 * dias" —, e é por isso que ela some quando a avaliação já acabou: não há
 * progresso para mostrar, e o que importa ali é o triângulo de alerta.
 */
function TrilhaDeDias({ restantes, totais }: { restantes: number; totais: number }) {
    return (
        <div className="hidden shrink-0 items-center gap-[3px] sm:flex" aria-hidden="true">
            {Array.from({ length: totais }, (_, i) => (
                <span
                    key={i}
                    className={cn(
                        'h-[5px] w-4 rounded-full',
                        i < restantes ? 'bg-current' : 'bg-current/30'
                    )}
                />
            ))}
        </div>
    )
}
