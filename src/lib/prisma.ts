import { PrismaClient } from '@prisma/client'

import { criarAdapter } from '@/lib/prisma-adapters'

/**
 * O cliente do Prisma, agora sobre um **driver adapter**.
 *
 * Até 2026-10-21 isto era `new PrismaClient()` e o Prisma carregava um engine
 * nativo para falar com o Postgres. Cloudflare Workers não carrega binário, então
 * essa forma simplesmente não roda lá. O adapter troca o engine por um driver de
 * JavaScript, e é a condição para a aplicação sair da VPS.
 *
 * **Dois adapters, escolhidos pelo host da URL — e não por variável separada.**
 * Uma variável a mais seria uma variável a mais para alguém marcar errado, num
 * lugar onde errar significa a aplicação apontar para o banco de outro ambiente.
 * O host já diz tudo o que é preciso saber:
 *
 *   - `*.neon.tech` → `PrismaNeon`, que fala por WebSocket sobre o proxy do Neon.
 *     Sem socket TCP, sem Hyperdrive, sem `nodejs_compat` para o driver. É o
 *     caminho de produção.
 *   - qualquer outro host → `PrismaPg`, que é TCP comum. É o Postgres local do
 *     desenvolvimento e o da VPS durante a transição.
 *
 * **Por que WebSocket e não HTTP.** O `PrismaNeonHTTP` é mais leve, mas não
 * suporta transação interativa, e há **seis** `$transaction(async …)` no código
 * — mais as que a tabela `outbox` do tempo real vai exigir, que precisam gravar
 * o domínio e o evento na mesma transação ou o desenho inteiro perde sentido.
 */

/**
 * O schema do Postgres, que viaja na URL e não nas opções do cliente.
 *
 * Com o engine nativo, o `?schema=` da connection string era lido pelo próprio
 * Prisma. Com adapter, quem conecta é o driver — e driver nenhum entende esse
 * parâmetro. Então ele é extraído aqui e repassado nas opções do adapter.
 *
 * `SUPABASE_DB_SCHEMA` continua valendo como segunda via, porque é assim que o
 * ambiente de desenvolvimento alterna entre `public` e `dev` hoje.
 */
function schemaDaUrl(url: string): string | undefined {
    try {
        const naUrl = new URL(url).searchParams.get('schema')?.trim()
        if (naUrl) return naUrl
    } catch {
        // URL malformada: deixa o driver reclamar com a mensagem dele, que é
        // mais útil que uma exceção de parsing aqui.
    }

    return process.env.SUPABASE_DB_SCHEMA?.trim() || undefined
}

function criarCliente(): PrismaClient {
    const url = process.env.DATABASE_URL

    if (!url) {
        throw new Error(
            'DATABASE_URL não está definida; o Prisma não tem para onde conectar. ' +
                'Em produção ela vem do Cloudflare Secrets.'
        )
    }

    const schema = schemaDaUrl(url)

    /**
     * O adapter recebe a URL inteira, inclusive o `?schema=`.
     *
     * Deixar o parâmetro ali é inofensivo — o Postgres ignora o que não
     * reconhece no startup packet do driver — e tirá-lo exigiria remontar a URL,
     * que é mais código e mais uma forma de errar.
     */
    /**
     * A escolha do driver mora em `prisma-adapters`, e não aqui, por
     * empacotamento: o `vite.config.ts` troca esse módulo pela variante
     * `.workerd.ts` nos ambientes do Worker, que não traz o driver de Postgres
     * comum. Com os dois no mesmo arquivo, a biblioteca `pg` entrava no bundle
     * e o Worker não iniciava. Ver o cabeçalho de `prisma-adapters.ts`.
     */
    return new PrismaClient({ adapter: criarAdapter(url, schema) })
}

declare global {
    var prismaGlobal: undefined | PrismaClient
}

/**
 * Em produção, um cliente por isolate — que é o que o Workers dá de qualquer
 * forma. Em desenvolvimento, guardado no global para que o recarregamento a
 * quente do Next não abra uma conexão nova a cada edição.
 */
function obterCliente(): PrismaClient {
    const existente = globalThis.prismaGlobal
    if (existente) return existente

    const cliente = criarCliente()
    if (process.env.NODE_ENV !== 'production') globalThis.prismaGlobal = cliente
    return cliente
}

/**
 * **Preguiçoso de propósito, e isto é o que faz o build existir.**
 *
 * Antes era `const prisma = globalThis.prismaGlobal ?? criarCliente()`, que
 * instancia na CARGA do módulo. `criarCliente` lança quando `DATABASE_URL` não
 * está definida — e aí `next build` quebrava no "Collecting page data", que
 * importa cada rota para ler a configuração dela:
 *
 *   Failed to collect configuration for /api/account/invoices
 *   [cause]: DATABASE_URL não está definida
 *
 * Buildar não precisa de banco, e exigir a variável no build estava errado em
 * dois sentidos: no Workers a URL vem de Secrets em tempo de EXECUÇÃO, e o CI
 * não tem nem deve ter credencial de banco para compilar. Com a criação movida
 * para o primeiro acesso, a carga do módulo deixa de ter efeito.
 *
 * O `Proxy` existe para não mudar nenhum chamador: `prisma.user.findMany()`
 * continua igual nos mais de cem pontos que o usam. Função é devolvida ligada
 * ao cliente real, senão `this` se perde em `$transaction` e afins.
 */
const prisma = new Proxy({} as PrismaClient, {
    get(_alvo, propriedade) {
        const cliente = obterCliente()
        const valor = Reflect.get(cliente as object, propriedade)
        return typeof valor === 'function' ? valor.bind(cliente) : valor
    },
    has(_alvo, propriedade) {
        return propriedade in (obterCliente() as object)
    },
    set(_alvo, propriedade, valor) {
        return Reflect.set(obterCliente() as object, propriedade, valor)
    },
})

export default prisma
