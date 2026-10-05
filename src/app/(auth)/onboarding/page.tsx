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

            // Check if user already has a workspace
            const { data: workspaceUsers } = await supabase
                .from('workspace_users')
                .select('workspaceId')
                .eq('userId', user.id)
                .limit(1)

            if (workspaceUsers && workspaceUsers.length > 0) {
                // User already has workspace, redirect to dashboard
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
            <div className="flex min-h-screen items-center justify-center bg-[#0A0E27]">
                <div className="text-white">Carregando...</div>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-[#0A0E27] text-white">
            <div className="mx-auto max-w-4xl px-4 py-12">
                {/* Header */}
                <div className="mb-12 text-center">
                    <div className="mb-6 flex justify-center">
                        <div className="flex items-center gap-2">
                            <div className="text-2xl font-bold text-purple-500">⚡</div>
                            <span className="text-2xl font-bold">OdontoBox360</span>
                        </div>
                    </div>
                    <h1 className="mb-2 text-3xl font-bold">Olá, Usuário!</h1>
                    <p className="text-gray-400">Vamos configurar sua conta em poucos passos</p>
                </div>

                {/* Progress Steps */}
                <div className="mb-12 flex justify-center">
                    <div className="flex items-center gap-4">
                        {[1, 2, 3, 4].map((step) => (
                            <div key={step} className="flex items-center">
                                <div
                                    className={`flex h-12 w-12 items-center justify-center rounded-full ${step < currentStep
                                        ? 'bg-purple-500'
                                        : step === currentStep
                                            ? 'bg-purple-500'
                                            : 'bg-gray-700'
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
                                        className={`h-1 w-16 ${step < currentStep ? 'bg-purple-500' : 'bg-gray-700'
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
