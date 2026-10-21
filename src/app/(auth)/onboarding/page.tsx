'use client'

import { Step5Terms } from '@/components/onboarding/Step5Terms'
import { TERMS_VERSION } from '@/lib/terms'
import { toast } from 'sonner'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getSession } from '@/lib/auth/cliente'
import { WhatsAppQRModal } from '@/components/agents/creation/WhatsAppQRModal'
import { Step1Workspace } from '@/components/onboarding/Step1Workspace'
import { Step2Plan } from '@/components/onboarding/Step2Plan'
import { Step3WhatsApp } from '@/components/onboarding/Step3WhatsApp'
import { Step4Agent } from '@/components/onboarding/Step4Agent'
import type { OnboardingData, OnboardingUpdate } from '@/components/onboarding/types'

export default function OnboardingPage() {
    const [currentStep, setCurrentStep] = useState(1)
    /** O agente provisionado no passo 3, dono do pareamento. */
    const [newAgentId, setNewAgentId] = useState<string | null>(null)
    const [qrOpen, setQrOpen] = useState(false)
    const [connecting, setConnecting] = useState(false)
    const [whatsAppConnected, setWhatsAppConnected] = useState(false)
    const [loading, setLoading] = useState(true)
    const [onboardingData, setOnboardingData] = useState<OnboardingData>({
        workspaceName: '',
        workspaceSlug: '',
        plan: 'pro',
        agentName: '',
    })
    const router = useRouter()

    useEffect(() => {
        checkOnboarding()
    }, [])

    const checkOnboarding = async () => {
        try {
            const { data: sessao } = await getSession()
            const user = sessao?.user ?? null

            if (!user) {
                router.push('/login')
                return
            }

            // Ask the server, rather than querying the table from the browser.
            //
            // This was the application's only PostgREST call — a client-side
            // SELECT on workspace_users. Routing it through our own endpoint means
            // no application table is reachable over /rest/v1 at all, so the anon
            // key (which ships in this bundle) can only reach Auth, Storage and
            // Realtime, each of which authorises on its own. It is also the more
            // correct check: the endpoint filters on isActive, which the direct
            // query did not, so a deactivated member no longer skips onboarding.
            const res = await fetch('/api/auth/check-workspace')
            const { hasWorkspace } = await res.json()

            if (hasWorkspace) {
                router.push('/dashboard')
                return
            }

            setLoading(false)
        } catch (error) {
            console.error('Error checking onboarding:', error)
            setLoading(false)
        }
    }

    const updateData: OnboardingUpdate = (data) => {
        setOnboardingData(prev => ({ ...prev, ...data }))
    }

    const nextStep = () => {
        setCurrentStep(prev => Math.min(prev + 1, 5))
    }

    const [submitting, setSubmitting] = useState(false)

    /**
     * O que o pareamento exige, criado na hora.
     *
     * O QR se liga a um agente, e o agente a um workspace — nenhum dos dois
     * existiria ainda no passo 3. Esta chamada cria os dois **sem o aceite**:
     * o cadastro continua, e o aceite do passo 5 é que o fecha (a mesma rota,
     * ao ver o workspace já existindo, registra o aceite em vez de criar outro).
     *
     * O custo dessa antecipação é um cadastro pela metade se a pessoa
     * desaparecer aqui. Está coberto: sem aceite registrado, a próxima visita
     * volta para o onboarding em vez de entrar no painel.
     */
    const handleConnectWhatsApp = async () => {
        setConnecting(true)
        try {
            const response = await fetch('/api/onboarding', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    workspaceName: onboardingData.workspaceName,
                    workspaceSlug: onboardingData.workspaceSlug,
                    plan: onboardingData.plan,
                    // O nome do agente é opcional no passo 4 e o pareamento não
                    // pode esperar por ele.
                    agentName: onboardingData.agentName?.trim() || 'Atendimento',
                }),
            })
            const result = await response.json()
            if (!response.ok || !result.agentId) {
                throw new Error(result.error || 'Não foi possível preparar a conexão')
            }
            setNewAgentId(result.agentId)
            setQrOpen(true)
        } catch (error) {
            console.error('[ONBOARDING] connect', error)
            toast.error(
                error instanceof Error ? error.message : 'Não foi possível preparar a conexão'
            )
        } finally {
            setConnecting(false)
        }
    }

    /**
     * Creates the workspace. It lives here rather than in a step because nothing
     * should exist before the agreement is accepted — the acceptance travels with
     * the same request that creates everything else.
     */
    const handleFinish = async () => {
        setSubmitting(true)
        try {
            const response = await fetch('/api/onboarding', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    workspaceName: onboardingData.workspaceName,
                    workspaceSlug: onboardingData.workspaceSlug,
                    plan: onboardingData.plan,
                    agentName: onboardingData.agentName?.trim(),
                    acceptedTermsVersion: TERMS_VERSION,
                }),
            })

            const result = await response.json()
            if (!response.ok) throw new Error(result.error || 'Não foi possível criar o workspace')

            toast.success('Tudo pronto')
            router.push('/dashboard')
            router.refresh()
        } catch (error) {
            console.error('[ONBOARDING]', error)
            toast.error(error instanceof Error ? error.message : 'Não foi possível criar o workspace')
        } finally {
            setSubmitting(false)
        }
    }

    const prevStep = () => {
        setCurrentStep(prev => Math.max(prev - 1, 1))
    }

    if (loading) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-card">
                <div className="text-foreground">Carregando...</div>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-card text-foreground">
            <div className="mx-auto max-w-4xl px-4 py-12">
                {/* Header */}
                <div className="mb-12 text-center">
                    <div className="mb-6 flex justify-center">
                        <div className="flex items-center gap-2">
                            <div className="text-2xl font-bold text-primary">⚡</div>
                            <span className="text-2xl font-bold">OdontoBox360</span>
                        </div>
                    </div>
                    <h1 className="mb-2 text-3xl font-bold">Olá, Usuário!</h1>
                    <p className="text-muted-foreground">Vamos configurar sua conta em poucos passos</p>
                </div>

                {/* Progress Steps */}
                <div className="mb-12 flex justify-center">
                    <div className="flex items-center gap-4">
                        {[1, 2, 3, 4, 5].map((step) => (
                            <div key={step} className="flex items-center">
                                <div
                                    className={`flex h-12 w-12 items-center justify-center rounded-full ${step < currentStep
                                        ? 'bg-primary'
                                        : step === currentStep
                                            ? 'bg-primary'
                                            : 'bg-muted'
                                        }`}
                                >
                                    {step < currentStep ? (
                                        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                        </svg>
                                    ) : (
                                        <span className="text-sm font-semibold">{step}</span>
                                    )}
                                </div>
                                {step < 4 && (
                                    <div
                                        className={`h-1 w-16 ${step < currentStep ? 'bg-primary' : 'bg-muted'
                                            }`}
                                    />
                                )}
                            </div>
                        ))}
                    </div>
                </div>

                {/* Step Content */}
                <div className="mx-auto max-w-2xl">
                    {currentStep === 1 && (
                        <Step1Workspace
                            data={onboardingData}
                            updateData={updateData}
                            onNext={nextStep}
                        />
                    )}
                    {currentStep === 2 && (
                        <Step2Plan
                            data={onboardingData}
                            updateData={updateData}
                            onNext={nextStep}
                            onBack={prevStep}
                        />
                    )}
                    {currentStep === 3 && (
                        <Step3WhatsApp
                            connected={whatsAppConnected}
                            onConnect={() => void handleConnectWhatsApp()}
                            connecting={connecting}
                            onNext={nextStep}
                            onBack={prevStep}
                        />
                    )}
                    {currentStep === 4 && (
                        <Step4Agent
                            data={onboardingData}
                            updateData={updateData}
                            onNext={nextStep}
                            onBack={prevStep}
                        />
                    )}
                    {currentStep === 5 && (
                        <Step5Terms
                            onFinish={handleFinish}
                            onBack={prevStep}
                            loading={submitting}
                        />
                    )}
                </div>
            </div>

            {/* O pareamento acontece no passo 3 e devolve para o cadastro:
                falta o agente e o aceite, e é o aceite que fecha tudo. */}
            {newAgentId ? (
                <WhatsAppQRModal
                    agentId={newAgentId}
                    isOpen={qrOpen}
                    onClose={() => setQrOpen(false)}
                    onConnected={() => {
                        toast.success('WhatsApp conectado')
                        setWhatsAppConnected(true)
                        setQrOpen(false)
                    }}
                />
            ) : null}
        </div>
    )
}
