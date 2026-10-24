import { AsyncLocalStorage } from 'node:async_hooks'

import { PrismaClient } from '#prisma'

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
 * `DB_SCHEMA` é a segunda via, porque é assim que o ambiente de
 * desenvolvimento alterna entre `public` e `dev`.
 *
 * **Chamava-se `SUPABASE_DB_SCHEMA`**, e o nome era o problema: uma variável
 * batizada com o nome de uma infraestrutura desligada, com poder de redirecionar
 * **todas** as consultas para outro schema — em silêncio, se um dia alguém a
 * gravasse achando que era resquício inofensivo. A auditoria de 2026-10-23 a
 * apontou por isso.
 *
 * O nome antigo segue aceito como alternativa para não quebrar `.env` que já
 * existe. Quando os ambientes locais tiverem migrado, some daqui.
 */
function schemaDaUrl(url: string): string | undefined {
    try {
        const naUrl = new URL(url).searchParams.get('schema')?.trim()
        if (naUrl) return naUrl
    } catch {
        // URL malformada: deixa o driver reclamar com a mensagem dele, que é
        // mais útil que uma exceção de parsing aqui.
    }

    return (process.env.DB_SCHEMA ?? process.env.SUPABASE_DB_SCHEMA)?.trim() || undefined
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
 * Um cliente por **requisição** — e os dois extremos que isto corrige.
 *
 * Medido na produção Cloudflare em 2026-10-22, nos dois sentidos:
 *
 *  - **Um cliente por isolate** (guardar no `globalThis` também em produção):
 *    17 falhas em 20. O Workers não garante que uma conexão aberta no contexto
 *    de uma requisição sirva na seguinte, e o pool do Neon passa a entregar
 *    WebSocket morto. Foi tentado e revertido — ver o histórico deste arquivo.
 *  - **Um cliente por acesso de propriedade** (o que havia antes): funciona,
 *    porque nunca reusa nada, mas o `prisma` exportado é um `Proxy` e cada
 *    `prisma.contact`, `prisma.deal`, `prisma.message`… constrói um
 *    `PrismaClient` inteiro, com pool e conexão próprios. Uma tela como o painel,
 *    com catorze consultas, abre catorze conexões. É essa avalanche que
 *    produzia 500 **intermitente** em qualquer tela que tocasse o banco.
 *
 * O meio-termo é o certo: o Worker abre um escopo por requisição (ver
 * `src/cloudflare/entrada.ts`) e o cliente nasce **uma vez dentro dele**. As
 * conexões são criadas e usadas no mesmo ciclo — válidas — e são uma, não
 * catorze.
 *
 * **Sem escopo, cai no comportamento antigo de propósito.** Fora de uma
 * requisição (build, script, um caminho que o `AsyncLocalStorage` não
 * atravesse) um cliente por acesso é desperdício, mas é o que comprovadamente
 * funciona — degradar para o seguro é melhor do que reusar algo inválido.
 */
export interface EscopoDoPrisma {
    cliente?: PrismaClient
}

export const escopoDoPrisma = new AsyncLocalStorage<EscopoDoPrisma>()

/**
 * Fecha o cliente que nasceu num escopo — e **tem** de ser chamado.
 *
 * Medido em 2026-10-23, na produção Cloudflare: toda invocação — rota, cron,
 * lote de fila — terminava o trabalho em centenas de milissegundos e ficava
 * **pendurada ~10 s** depois (`/api/health` respondia em 140 ms com
 * `wallTime` de 10 050 ms, em todas as amostras). A causa é o pool do Neon:
 * `PrismaNeon` abre um WebSocket por cliente, ninguém o fechava, e o runtime
 * só encerra a invocação quando não há mais I/O pendente. Cada chamada
 * segurava uma conexão no Neon por dez segundos — com cron a cada minuto e a
 * tela de conversas consultando a cada quinze, era conexão acumulada por nada.
 *
 * A documentação do driver é direta: em Workers o `Pool` "must be connected,
 * used and closed within a single request handler… don't forget to close
 * them". `$disconnect()` chega ao `dispose()` do adapter, que encerra o pool.
 *
 * **Não lança.** Falha ao fechar é registrada e engolida: a resposta já saiu,
 * e um erro aqui só transformaria uma conexão vazada num 500 na tela.
 */
export async function descartarCliente(escopo: EscopoDoPrisma): Promise<void> {
    const cliente = escopo.cliente
    if (!cliente) return
    escopo.cliente = undefined

    try {
        await cliente.$disconnect()
    } catch (erro) {
        console.error('[prisma] falha ao fechar o cliente do escopo:', erro)
    }
}

function obterCliente(): PrismaClient {
    const escopo = escopoDoPrisma.getStore()
    if (escopo) {
        escopo.cliente ??= criarCliente()
        return escopo.cliente
    }

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
