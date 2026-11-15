export interface Manifesto {
    slug: string
    caminho: string
    dados: {
        app: { slug: string; name: string; repo: string; cloudflareAccountId: string }
        environments: Record<string, unknown>
    }
}
export function manifestos(): Manifesto[]
export function manifestoDoApp(slug: string): Manifesto
export function slugsComManifesto(): string[]
