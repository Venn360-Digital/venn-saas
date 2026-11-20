import type { Metadata } from 'next'

import prisma from '@venn/db/cliente'
import { BRAND } from '@venn/core/marca'
import { lerCampos, lerConfiguracao } from '@venn/core/lib/formularios/schema'

import { FormularioPublico } from './FormularioPublico'

/**
 * A página pública de um formulário de captura.
 *
 * Aberta por link ou embutida num `iframe` no site da organização
 * (`?embed=1` tira a altura mínima e as margens, e liga o aviso de altura ao
 * pai). Sem login, como o descadastro e o widget: quem chega aqui é um
 * visitante, e a chave na URL só diz **qual** formulário — não autoriza nada.
 *
 * Só o publicado abre. O rascunho responde a mesma tela de "indisponível" que
 * a chave inexistente: dizer "existe, mas não está publicado" seria confirmar
 * a existência de um formulário para quem adivinhou a chave.
 */

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ key: string }> }): Promise<Metadata> {
    const { key } = await params
    const form = await prisma.leadForm.findFirst({
        where: { publicKey: key, status: 'published' },
        select: { name: true, settings: true, workspace: { select: { name: true } } },
    })
    const titulo = form ? lerConfiguracao(form.settings).titulo || form.name : 'Formulário'
    return {
        title: form ? `${titulo} · ${form.workspace.name}` : titulo,
        // Página utilitária com formulário: o site da organização é quem se indexa.
        robots: { index: false, follow: false },
    }
}

export default async function FormularioPage({
    params,
    searchParams,
}: {
    params: Promise<{ key: string }>
    searchParams: Promise<{ embed?: string }>
}) {
    const { key } = await params
    const { embed } = await searchParams

    const form = await prisma.leadForm.findFirst({
        where: { publicKey: key, status: 'published' },
        select: { name: true, fields: true, settings: true, workspace: { select: { name: true } } },
    })

    if (!form) {
        return (
            <main className="flex min-h-dvh items-center justify-center bg-muted/30 px-4 py-16">
                <div className="w-full max-w-md rounded-xl border border-border/60 bg-card p-8 text-center shadow-sm">
                    <h1 className="text-xl font-semibold text-foreground">Formulário indisponível</h1>
                    <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                        Este formulário não está publicado ou o endereço mudou. Se você chegou por um
                        link, peça a quem o enviou o endereço atualizado.
                    </p>
                    <p className="mt-8 text-xs text-muted-foreground/70">{BRAND().name}</p>
                </div>
            </main>
        )
    }

    return (
        <FormularioPublico
            formulario={{
                chave: key,
                nome: form.name,
                organizacao: form.workspace.name,
                campos: lerCampos(form.fields),
                config: lerConfiguracao(form.settings),
            }}
            marca={BRAND().name}
            embed={embed === '1'}
        />
    )
}
