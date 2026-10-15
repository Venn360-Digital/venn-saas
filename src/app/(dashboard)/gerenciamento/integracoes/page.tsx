import { redirect } from 'next/navigation'

/**
 * Atalho para a guia, levando a resposta do OAuth junto.
 *
 * O callback do Google volta para cá com `?success=` ou `?error=`, e é o
 * painel quem lê esses parâmetros para dizer se conectou. Por isso o atalho
 * repassa a busca inteira em vez de descartá-la: sem ela, conectar o
 * calendário terminaria em silêncio.
 */
export default async function IntegracoesPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
    const params = await searchParams
    const busca = new URLSearchParams({ tab: 'integracoes' })
    for (const [chave, valor] of Object.entries(params)) {
        if (typeof valor === 'string') busca.set(chave, valor)
        else if (Array.isArray(valor) && valor[0]) busca.set(chave, valor[0])
    }
    redirect(`/gerenciamento/conta?${busca.toString()}`)
}
