'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Step1Workspace } from '@/components/onboarding/Step1Workspace'
import { Step2Plan } from '@/components/onboarding/Step2Plan'
import { Step3WhatsApp } from '@/components/onboarding/Step3WhatsApp'
import { Step4Agent } from '@/components/onboarding/Step4Agent'

export default function OnboardingPage() {
    const [currentStep, setCurrentStep] = useState(1)
    const [loading, setLoading] = useState(true)
    const [onboardingData, setOnboardingData] = useState({
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
            const supabase = createClient()
            const { data: { user } } = await supabase.auth.getUser()

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

    const updateData = (data: Partial<typeof onboardingData>) => {
        setOnboardingData(prev => ({ ...prev, ...data }))
    }

    const nextStep = () => {
        setCurrentStep(prev => Math.min(prev + 1, 4))
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
                        {[1, 2, 3, 4].map((step) => (
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
                            data={onboardingData}
                            onNext={nextStep}
                            onBack={prevStep}
                        />
                    )}
                    {currentStep === 4 && (
                        <Step4Agent
                            data={onboardingData}
                            updateData={updateData}
                            onBack={prevStep}
                        />
                    )}
                </div>
            </div>
        </div>
    )
}
