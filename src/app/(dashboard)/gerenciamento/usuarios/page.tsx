import { UsersPanel } from '@/components/management/UsersPanel'

/**
 * Mantida como rota própria: o convite por e-mail e outros pontos do sistema
 * apontam para cá. A navegação, porém, leva à guia dentro de Gerenciar conta.
 */
export default function UsuariosPage() {
    return <UsersPanel />
}
