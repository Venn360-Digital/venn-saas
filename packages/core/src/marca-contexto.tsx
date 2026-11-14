'use client'
/**
 * A marca para componentes de cliente.
 *
 * O registro de módulo de `./marca` não serve aqui: o bundle do cliente é
 * outro ambiente, e nada garante que o módulo que registrou a marca no
 * servidor tenha sido avaliado no navegador. Então a marca desce pelo React,
 * serializada do servidor para o cliente — ela é só texto e caminhos, nada de
 * segredo, e o `brand.ts` do app já declara isso no cabeçalho dele ("nada de
 * segredo ou env de servidor aqui").
 *
 * Os cinco que precisam desta via, medidos antes: `layout/DocumentTitle`,
 * `management/IntegrationsPanel`, `account/PlanoTab`, `onboarding/Step1Workspace`
 * e `onboarding/Step3WhatsApp`. Todos renderizam sob a raiz do App Router, que
 * é onde o provider entra — e por isso `useMarca()` pode exigir o provider em
 * vez de tolerar a ausência dele.
 */
import { createContext, useContext, type ReactNode } from 'react'
import type { Brand } from '@venn/config/marca'

const Contexto = createContext<Brand | null>(null)

export function ProvedorDeMarca({ marca, children }: { marca: Brand; children: ReactNode }) {
    return <Contexto.Provider value={marca}>{children}</Contexto.Provider>
}

/**
 * Lança se não houver provider — pela mesma razão que `BRAND()` lança: uma
 * marca vazia renderizaria nome em branco, e uma marca padrão renderizaria a
 * marca errada num produto que tem três.
 */
export function useMarca(): Brand {
    const marca = useContext(Contexto)
    if (!marca) {
        throw new Error(
            'useMarca() fora do ProvedorDeMarca. Ele entra na raiz do App ' +
            'Router, em `app/layout.tsx` — veja `scripts/check-marca.mjs`.'
        )
    }
    return marca
}
