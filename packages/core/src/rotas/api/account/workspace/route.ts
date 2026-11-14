import { NextResponse } from 'next/server'

import { marcaDaSessao } from '@venn/core/lib/session-brand'

/**
 * A marca da sessão, para o cliente se atualizar **sem recarregar**.
 *
 * O primeiro paint não passa por aqui: o layout do dashboard já entrega esta
 * mesma resposta renderizada no servidor, e era a falta disso que fazia a
 * sidebar piscar a marca do OdontoBox360 antes da logo da clínica. Esta rota é
 * o caminho do `workspace:updated` — gravar a logo ou o nome na guia Conta da
 * Clínica troca a marca na hora, sem navegar.
 *
 * Mesma forma dos dois lados, de propósito: `marcaDaSessao` é a fonte, e o hook
 * `useUnidades` consome os dois caminhos com um mapeamento só.
 */
export async function GET() {
    const marca = await marcaDaSessao()
    if (!marca) {
        return NextResponse.json({ error: 'Workspace não encontrado' }, { status: 404 })
    }
    return NextResponse.json(marca)
}
