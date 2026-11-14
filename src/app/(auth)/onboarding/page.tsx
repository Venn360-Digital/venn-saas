'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ArrowRight, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@venn/ui/button'
import { getSession } from '@venn/core/lib/auth/cliente'
import { TERMS_VERSION } from '@venn/core/lib/terms'
import { WhatsAppQRModal } from '@venn/core/components/agents/creation/WhatsAppQRModal'
import { OnboardingShell } from '@venn/core/components/onboarding/OnboardingShell'
import {
    IlustracaoAgente,
    IlustracaoPlano,
    IlustracaoTermos,
    IlustracaoWhatsApp,
    IlustracaoWorkspace,
} from '@venn/core/components/onboarding/Ilustracoes'
import { Step1Workspace, slugDoNome } from '@venn/core/components/onboarding/Step1Workspace'
import { Step2Plan } from '@venn/core/components/onboarding/Step2Plan'
import { Step3WhatsApp } from '@venn/core/components/onboarding/Step3WhatsApp'
import { Step4Agent } from '@venn/core/components/onboarding/Step4Agent'
import { Step5Terms } from '@venn/core/components/onboarding/Step5Terms'

const TOTAL = 5

/**
 * O cadastro: cinco passos numa moldura de altura fixa.
 *
 * ## O que esta página passou a ser dona
 *
 * O estado dos campos e as **ações**. Antes cada passo guardava os próprios
 * campos e desenhava o próprio par de botões no fim do próprio cartão: cinco
 * rodapés, cinco larguras, e o do passo 5 abaixo de um termo de 22rem — só
 * alcançável por rolagem. Agora o passo é só o corpo, e quem decide o que o
 * botão faz, e se ele pode ser apertado, é esta página, que é a única que sabe
 * em que passo está.
 *
 * O efeito colateral que importa: com um estado só por campo, o espelhamento do
 * nome no endereço deixou de ter dois lugares para divergir — que era o defeito
 * de "a URL repete só a primeira letra".
 */
export default function OnboardingPage() {
    const router = useRouter()

    const [passo, setPasso] = useState(1)
    /**
     * Para que lado o conteúdo entra na próxima troca.
     *
     * Mora aqui porque só esta página sabe se o clique foi Continuar ou Voltar —
     * a moldura recebe o número do passo e não teria como saber de onde ele veio.
     */
    const [direcao, setDirecao] = useState<1 | -1>(1)
    const [carregando, setCarregando] = useState(true)
    const [enviando, setEnviando] = useState(false)

    const [nomeDoWorkspace, setNomeDoWorkspace] = useState('')
    const [plano, setPlano] = useState('pro')
    /**
     * Mensal ou anual, escolhido no passo do plano.
     *
     * Não cobra nada agora — a avaliação é de graça —, mas viaja para a
     * assinatura e volta como padrão na tela de contratação: quem escolheu
     * "anual, −10%" aqui não deve encontrar preços mensais no dia de assinar.
     */
    const [ciclo, setCiclo] = useState<'monthly' | 'annual'>('monthly')
    const [nomeDoAgente, setNomeDoAgente] = useState('')
    const [aceito, setAceito] = useState(false)

    /** O agente provisionado no passo 3, dono do pareamento. */
    const [agenteDoPareamento, setAgenteDoPareamento] = useState<string | null>(null)
    const [qrAberto, setQrAberto] = useState(false)
    const [preparando, setPreparando] = useState(false)
    const [whatsAppConectado, setWhatsAppConectado] = useState(false)

    const slug = slugDoNome(nomeDoWorkspace)

    const conferirCadastro = useCallback(async () => {
        try {
            const { data: sessao } = await getSession()
            if (!sessao?.user) {
                router.push('/login')
                return
            }

            // Perguntado ao servidor, em vez de consultar a tabela do navegador.
            // O endpoint também filtra por `isActive`, o que a consulta direta
            // não fazia — membro desativado deixou de pular o cadastro.
            const res = await fetch('/api/auth/check-workspace')
            const { hasWorkspace } = await res.json()

            if (hasWorkspace) {
                router.push('/dashboard')
                return
            }

            setCarregando(false)
        } catch (error) {
            console.error('[ONBOARDING] check', error)
            setCarregando(false)
        }
    }, [router])

    useEffect(() => {
        // A regra é baseada no compilador e não acompanha função assíncrona:
        // `conferirCadastro` só mexe em estado depois do primeiro `await`, e
        // perguntar ao servidor em que ponto o cadastro está é exatamente o que
        // um efeito existe para fazer. Mesma situação, e mesma decisão, do
        // `Topbar`.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void conferirCadastro()
    }, [conferirCadastro])

    /**
     * O que o pareamento exige, criado na hora.
     *
     * O QR se liga a um agente, e o agente a um workspace — nenhum dos dois
     * existiria ainda no passo 3. Esta chamada cria os dois **sem o aceite**: o
     * cadastro continua, e o aceite do passo 5 é que o fecha (a mesma rota, ao
     * ver o workspace já existindo, registra o aceite em vez de criar outro).
     *
     * O custo dessa antecipação é um cadastro pela metade se a pessoa
     * desaparecer aqui. Está coberto: sem aceite registrado, a próxima visita
     * volta para o cadastro em vez de entrar no painel.
     */
    const pararWhatsApp = async () => {
        setPreparando(true)
        try {
            const res = await fetch('/api/onboarding', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    workspaceName: nomeDoWorkspace,
                    workspaceSlug: slug,
                    plan: plano,
                    cycle: ciclo,
                    // O nome do agente é opcional no passo 4 e o pareamento não
                    // pode esperar por ele. O passo 5 renomeia este agente com o
                    // que for digitado lá.
                    agentName: nomeDoAgente.trim() || 'Atendimento',
                }),
            })
            const corpo = await res.json()
            if (!res.ok || !corpo.agentId) {
                throw new Error(corpo.error || 'Não foi possível preparar a conexão')
            }
            setAgenteDoPareamento(corpo.agentId)
            setQrAberto(true)
        } catch (error) {
            console.error('[ONBOARDING] connect', error)
            toast.error(
                error instanceof Error ? error.message : 'Não foi possível preparar a conexão'
            )
        } finally {
            setPreparando(false)
        }
    }

    /**
     * Cria o workspace. Mora aqui e não num passo porque nada deve existir antes
     * do aceite — a aceitação viaja na mesma requisição que cria o resto.
     *
     * `agentId` vai no corpo: é o agente que o passo 3 criou com o nome de
     * reserva, e é por este id que o servidor sabe **qual** agente renomear com
     * o nome digitado no passo 4. Sem isso, a clínica que pareou o WhatsApp
     * terminava o cadastro com um agente chamado "Atendimento".
     */
    const concluir = async () => {
        setEnviando(true)
        try {
            const res = await fetch('/api/onboarding', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    workspaceName: nomeDoWorkspace,
                    workspaceSlug: slug,
                    plan: plano,
                    cycle: ciclo,
                    agentName: nomeDoAgente.trim(),
                    agentId: agenteDoPareamento,
                    acceptedTermsVersion: TERMS_VERSION,
                }),
            })

            const corpo = await res.json()
            if (!res.ok) throw new Error(corpo.error || 'Não foi possível criar o workspace')

            toast.success('Tudo pronto')
            router.push('/dashboard')
            router.refresh()
        } catch (error) {
            console.error('[ONBOARDING]', error)
            toast.error(
                error instanceof Error ? error.message : 'Não foi possível criar o workspace'
            )
        } finally {
            setEnviando(false)
        }
    }

    if (carregando) {
        return (
            <div className="fixed inset-0 flex items-center justify-center bg-background">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
        )
    }

    const voltar = (
        <Button
            type="button"
            variant="outline"
            onClick={() => {
                setDirecao(-1)
                setPasso((p) => Math.max(1, p - 1))
            }}
        >
            <ArrowLeft className="mr-1.5 size-4" />
            Voltar
        </Button>
    )

    const seguir = (rotulo = 'Continuar', travado = false) => (
        <Button
            type="button"
            onClick={() => {
                setDirecao(1)
                setPasso((p) => Math.min(TOTAL, p + 1))
            }}
            disabled={travado}
        >
            {rotulo}
            <ArrowRight className="ml-1.5 size-4" />
        </Button>
    )

    /**
     * Cada passo declara o seu quadro: nome, largura, a frase do rodapé e as
     * ações. Ler os cinco de uma vez é o que deixa ver que eles são a mesma
     * tela com conteúdos diferentes — era o que cinco cartões com cinco rodapés
     * próprios escondiam.
     */
    const quadro =
        passo === 1 ? (
            <OnboardingShell
                passo={1}
                total={TOTAL}
                titulo="Workspace"
                ilustracao={<IlustracaoWorkspace />}
                direcao={direcao}
                dica={slug ? undefined : 'Informe o nome para continuar.'}
                acoes={seguir('Continuar', !slug)}
            >
                <Step1Workspace nome={nomeDoWorkspace} onNomeChange={setNomeDoWorkspace} />
            </OnboardingShell>
        ) : passo === 2 ? (
            <OnboardingShell
                passo={2}
                total={TOTAL}
                titulo="Plano"
                ilustracao={<IlustracaoPlano />}
                direcao={direcao}
                dica="Nenhuma cobrança agora. O cartão só é pedido no fim da avaliação."
                acoes={
                    <>
                        {voltar}
                        {seguir('Continuar', !plano)}
                    </>
                }
            >
                <Step2Plan
                    data={{ plan: plano, cycle: ciclo }}
                    updateData={({ plan, cycle }) => {
                        if (plan !== undefined) setPlano(plan)
                        if (cycle !== undefined) setCiclo(cycle)
                    }}
                />
            </OnboardingShell>
        ) : passo === 3 ? (
            <OnboardingShell
                passo={3}
                total={TOTAL}
                titulo="WhatsApp"
                ilustracao={<IlustracaoWhatsApp />}
                direcao={direcao}
                dica={
                    whatsAppConectado
                        ? undefined
                        : 'Este passo pode ser feito depois, em Atendimento → Agentes.'
                }
                acoes={
                    <>
                        {voltar}
                        {whatsAppConectado ? null : (
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => void pararWhatsApp()}
                                disabled={preparando}
                            >
                                {preparando ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : null}
                                {preparando ? 'Preparando…' : 'Ler o código'}
                            </Button>
                        )}
                        {seguir(whatsAppConectado ? 'Continuar' : 'Pular por agora')}
                    </>
                }
            >
                <Step3WhatsApp connected={whatsAppConectado} />
            </OnboardingShell>
        ) : passo === 4 ? (
            <OnboardingShell
                passo={4}
                total={TOTAL}
                titulo="Agente"
                ilustracao={<IlustracaoAgente />}
                direcao={direcao}
                dica="Opcional — dá para criar outros agentes depois, no painel."
                acoes={
                    <>
                        {voltar}
                        {seguir()}
                    </>
                }
            >
                <Step4Agent nome={nomeDoAgente} onNomeChange={setNomeDoAgente} />
            </OnboardingShell>
        ) : (
            <OnboardingShell
                passo={5}
                total={TOTAL}
                titulo="Termos do acordo"
                ilustracao={<IlustracaoTermos />}
                direcao={direcao}
                /* Sem trilho, por decisão dele: a fase 5 ocupa mais tela, e
                   300px de ilustração tirados de um contrato que se lê seria
                   gastar largura com decoração. */
                semTrilho
                dica={aceito ? undefined : 'Leia o texto até o fim e marque o aceite.'}
                acoes={
                    <>
                        {voltar}
                        <Button type="button" onClick={() => void concluir()} disabled={!aceito || enviando}>
                            {enviando ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : null}
                            Aceitar e começar
                        </Button>
                    </>
                }
            >
                <Step5Terms aceito={aceito} onAceitoChange={setAceito} />
            </OnboardingShell>
        )

    return (
        <>
            {quadro}

            {/* O pareamento acontece no passo 3 e devolve para o cadastro:
                falta o agente e o aceite, e é o aceite que fecha tudo.

                Montado **fora** do quadro do passo, e não dentro dele: o
                pareamento começa no passo 3 e o diálogo precisa continuar de pé
                enquanto a pessoa avança — numa versão anterior deste arquivo ele
                só era montado no passo 5, onde ninguém pareia nada. */}
            {agenteDoPareamento ? (
                <WhatsAppQRModal
                    agentId={agenteDoPareamento}
                    isOpen={qrAberto}
                    onClose={() => setQrAberto(false)}
                    onConnected={() => {
                        toast.success('WhatsApp conectado')
                        setWhatsAppConectado(true)
                        setQrAberto(false)
                    }}
                />
            ) : null}
        </>
    )
}
