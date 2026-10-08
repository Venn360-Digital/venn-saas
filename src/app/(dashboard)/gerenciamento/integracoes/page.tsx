import { IntegrationsPanel } from '@/components/management/IntegrationsPanel'

/**
 * Mantida como rota própria: o callback do OAuth do Google redireciona para cá
 * com `?success=` e `?error=`. A navegação leva à guia dentro de Gerenciar conta.
 */
export default function IntegracoesPage() {
    return <IntegrationsPanel />
}
