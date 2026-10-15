import { redirect } from 'next/navigation'

/**
 * Atalho para a guia, não uma segunda tela.
 *
 * Esta rota desenhava Usuários por conta própria, com cabeçalho e moldura
 * diferentes dos da guia em Gerenciar conta: duas portas para a mesma coisa,
 * cada uma com uma cara. Quem chega por um link antigo — um convite por
 * e-mail, um favorito — cai na guia, que é onde a tela mora.
 */
export default function UsuariosPage() {
    redirect('/gerenciamento/conta?tab=usuarios')
}
