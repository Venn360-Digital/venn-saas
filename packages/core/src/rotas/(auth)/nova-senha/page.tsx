import { redirect } from 'next/navigation'

import { NovaSenhaForm } from './form'
import { BRAND } from '../../../marca'

/*
 * Função, não constante: `BRAND()` lança sem marca registrada, e uma constante
 * é avaliada quando a Cloudflare VALIDA o script. Sexta forma desta fase.
 */
export function generateMetadata() {
    return { title: `Nova senha — ${BRAND().name}` }
}

/**
 * Onde o link de recuperação chega.
 *
 * **O que mudou com o Better Auth, e por que é melhor.** No GoTrue o link de
 * recuperação *criava sessão* e mandava a pessoa para cá; esta página então
 * trocava a senha de quem já estava logado. Era frágil de um jeito que o
 * comentário anterior registrava: um clique que criasse sessão e caísse em
 * `/login` era encaminhado ao painel pelo middleware, a senha nunca era pedida,
 * e voltar ao e-mail para clicar de novo dava "link inválido" — o token é de uso
 * único e o primeiro clique já o tinha gasto.
 *
 * Aqui o token vem **na URL** e não vale sessão nenhuma. Quem o troca por senha
 * nova é o formulário, numa chamada só. Não há janela em que a pessoa esteja
 * autenticada sem ter escolhido a senha, que era o estado estranho de antes.
 *
 * O e-mail não aparece mais na tela: ele vinha da sessão, e agora não há sessão.
 * Quem chegou aqui clicou num link no próprio e-mail — a tela não precisa
 * dizer-lhe qual é.
 */
export default async function NovaSenhaPage({
    searchParams,
}: {
    searchParams: Promise<{ token?: string; error?: string }>
}) {
    const { token, error } = await searchParams

    /**
     * Sem token não há o que fazer aqui.
     *
     * O Better Auth também redireciona para cá com `?error=INVALID_TOKEN`
     * quando o link está expirado ou já foi usado — os dois casos terminam na
     * mesma frase, de propósito: dizer qual dos dois foi revelaria se aquele
     * e-mail tem conta.
     */
    if (!token || error) {
        redirect(
            '/login?error=' +
                encodeURIComponent('O link de recuperação expirou ou já foi usado. Peça outro.')
        )
    }

    return <NovaSenhaForm token={token} />
}
