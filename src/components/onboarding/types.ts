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
    /**
     * Pediu para conectar o WhatsApp no passo 3.
     *
     * A conexão não cabe ali: nada existe antes do aceite, e o QR se liga a um
     * agente que só nasce no fim. O passo guarda a intenção e o QR abre assim
     * que o agente existe.
     */
    connectWhatsApp?: boolean
}

export type OnboardingUpdate = (data: Partial<OnboardingData>) => void
