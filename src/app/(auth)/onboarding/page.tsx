'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ArrowRight, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { getSession } from '@/lib/auth/cliente'
import { TERMS_VERSION } from '@/lib/terms'
import { WhatsAppQRModal } from '@/components/agents/creation/WhatsAppQRModal'
import { OnboardingShell } from '@/components/onboarding/OnboardingShell'
import { Step1Workspace, slugDoNome } from '@/components/onboarding/Step1Workspace'
import { Step2Plan } from '@/components/onboarding/Step2Plan'
import { Step3WhatsApp } from '@/components/onboarding/Step3WhatsApp'
import { Step4Agent } from '@/components/onboarding/Step4Agent'
import { Step5Terms } from '@/components/onboarding/Step5Terms'

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
    const [carregando, setCarregando] = useState(true)
    const [enviando, setEnviando] = useState(false)

    const [nomeDoWorkspace, setNomeDoWorkspace] = useState('')
    const [plano, setPlano] = useState('pro')
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
        <Button type="button" variant="outline" onClick={() => setPasso((p) => Math.max(1, p - 1))}>
            <ArrowLeft className="mr-1.5 size-4" />
            Voltar
        </Button>
    )

    const seguir = (rotulo = 'Continuar', travado = false) => (
        <Button type="button" onClick={() => setPasso((p) => Math.min(TOTAL, p + 1))} disabled={travado}>
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
                descricao="O nome da sua empresa, como ela aparece no sistema."
                dica={slug ? undefined : 'Informe o nome para continuar.'}
                acoes={seguir('Continuar', !slug)}
            >
                <Step1Workspace nome={nomeDoWorkspace} onNomeChange={setNomeDoWorkspace} />
            </OnboardingShell>
        ) : passo === 2 ? (
            <OnboardingShell
                passo={2}
                total={TOTAL}
                titulo="Escolha seu plano"
                descricao="Dá para trocar depois, a qualquer momento."
                largura="larga"
                acoes={
                    <>
                        {voltar}
                        {seguir('Continuar', !plano)}
                    </>
                }
            >
                <Step2Plan data={{ plan: plano }} updateData={({ plan }) => setPlano(plan)} />
            </OnboardingShell>
        ) : passo === 3 ? (
            <OnboardingShell
                passo={3}
                total={TOTAL}
                titulo="WhatsApp"
                descricao="Conecte o número por onde a sua clínica atende."
                largura="media"
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
                descricao="O seu primeiro agente de IA, que atende por você."
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
                descricao="Aceito uma vez, pela conta. Quem você cadastrar depois não passa por aqui."
                largura="media"
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
