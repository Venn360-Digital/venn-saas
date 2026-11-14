/**
 * O que os quatro passos do onboarding compartilham.
 *
 * Existe porque cada passo declarava o seu próprio `updateData: (data: any)`:
 * quatro assinaturas que *pareciam* concordar com o estado da página sem nada
 * garantir. Renomear um campo no estado não quebrava passo nenhum — quebrava o
 * cadastro, em silêncio.
 */
export interface OnboardingData {
    workspaceName: string
    workspaceSlug: string
    plan: string
    agentName: string
}

export type OnboardingUpdate = (data: Partial<OnboardingData>) => void
