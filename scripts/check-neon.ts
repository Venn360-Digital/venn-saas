/**
 * Prova a migração contra um Postgres de verdade.
 *
 * Typecheck não prova que um driver conecta, e `prisma migrate deploy` não prova
 * que o schema **se comporta**. Este script roda contra a branch de homologação
 * do Neon e confere o que só aparece em execução: o driver adapter falando com o
 * Neon, a transação interativa (o motivo de ser WebSocket e não HTTP), o operador
 * `<=>` do pgvector pelo mesmo caminho do `retriever.ts`, a coluna gerada sendo
 * calculada pelo Postgres, e o cofre cifrando de fato na coluna.
 *
 * Confere também o que **não** deve existir: extensão que nenhuma migração cria,
 * as políticas que dependem de `auth.uid()` e a função `current_workspace_ids`. A
 * migração de RLS foi tornada portável, e uma migração condicional sem teste é
 * uma migração que ninguém sabe em qual dos dois ramos caiu.
 *
 * Cria e apaga o que usa. Nunca aponte para produção:
 *
 *     DATABASE_URL='<branch de homologação>' npm run check:neon
 */
import prisma from '@/lib/prisma'
import { readVaultSecret, writeVaultSecret, vaultSecretExists, vaultSecretOrigin, platformSecretName, SegredoDeAmbienteError } from '@/lib/vault'
import { gerarChave, CHAVE_ENV } from '@/lib/secrets/envelope'

let falhas = 0
const ok = (nome: string, cond: boolean, extra = '') => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${nome}${extra ? '  — ' + extra : ''}`)
    if (!cond) falhas++
}

async function main() {
    // 1. O driver conecta mesmo.
    const [{ versao }] = await prisma.$queryRaw<{ versao: string }[]>`
        SELECT version() AS versao
    `
    ok('adapter-neon conecta e consulta', versao.includes('PostgreSQL'), versao.split(' ')[1])

    // 2. O schema chegou inteiro.
    const [{ n }] = await prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM information_schema.tables WHERE table_schema = 'public'
    `
    ok('tabelas em public', Number(n) >= 46, `${n} tabelas`)

    // 3. As extensões que o schema exige.
    const exts = await prisma.$queryRaw<{ extname: string }[]>`
        SELECT extname::text AS extname FROM pg_extension ORDER BY 1
    `
    const nomes = exts.map((e) => e.extname)
    ok('pgvector instalado', nomes.includes('vector'))
    ok('unaccent instalado', nomes.includes('unaccent'))

    /**
     * E **nada além** das declaradas.
     *
     * A versão anterior conferia a ausência de uma extensão específica — a de
     * cofre da plataforma antiga — e por isso só pegava aquele caso. O que
     * importa é mais largo: extensão que nenhuma migração cria é extensão que
     * alguém instalou à mão, e o schema deixa de ser reproduzível a partir do
     * repositório. Vale para um cofre de qualquer fornecedor e para o que ainda
     * não aconteceu.
     *
     * A lista vem das migrações: `vector` no baseline, `unaccent` e `pg_trgm`
     * na busca sem acento. `plpgsql` é do Postgres.
     */
    const DECLARADAS = ['plpgsql', 'vector', 'unaccent', 'pg_trgm']
    const intrusas = nomes.filter((n) => !DECLARADAS.includes(n))
    ok(
        'nenhuma extensão fora das declaradas nas migrações',
        intrusas.length === 0,
        intrusas.length ? intrusas.join(', ') : `${nomes.length} extensão(ões)`
    )

    // 4. A migração de RLS virou no-op portável: RLS ligado, sem política de auth.
    const [{ comRls }] = await prisma.$queryRaw<{ comRls: bigint }[]>`
        SELECT count(*) AS "comRls" FROM pg_tables
        WHERE schemaname = 'public' AND rowsecurity = true
    `
    ok('RLS habilitado nas tabelas', Number(comRls) >= 27, `${comRls} tabelas`)

    const [{ politicas }] = await prisma.$queryRaw<{ politicas: bigint }[]>`
        SELECT count(*) AS politicas FROM pg_policies WHERE schemaname = 'public'
    `
    ok('nenhuma política de auth.uid() criada', Number(politicas) === 0, `${politicas} políticas`)

    const [{ temFn }] = await prisma.$queryRaw<{ temFn: bigint }[]>`
        SELECT count(*) AS "temFn" FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'current_workspace_ids'
    `
    ok('current_workspace_ids NÃO criada (depende de auth)', Number(temFn) === 0)

    // 5. A função immutable_unaccent e a coluna gerada — o acento tem de sumir.
    const [{ normalizado }] = await prisma.$queryRaw<{ normalizado: string }[]>`
        SELECT public.immutable_unaccent(lower('André Conceição')) AS normalizado
    `
    ok('immutable_unaccent normaliza', normalizado === 'andre conceicao', normalizado)

    // 6. pgvector aceita o tipo que o schema usa.
    const [{ dims }] = await prisma.$queryRaw<{ dims: number }[]>`
        SELECT vector_dims('[1,2,3]'::vector) AS dims
    `
    ok('pgvector operacional', dims === 3)

    // 6b. O operador de similaridade que o RAG usa, pelo mesmo caminho do
    // `$queryRaw` com `::vector` — é assim que `retriever.ts` consulta.
    const alvo = '[1,0,0]'
    const [{ sim, dist }] = await prisma.$queryRaw<{ sim: number; dist: number }[]>`
        SELECT 1 - ('[1,0,0]'::vector <=> ${alvo}::vector) AS sim,
               ('[1,0,0]'::vector <=> '[0,1,0]'::vector) AS dist
    `
    ok('operador <=> com parâmetro ::vector', Math.abs(sim - 1) < 1e-9, `sim=${sim}`)
    ok('vetores ortogonais têm distância 1', Math.abs(dist - 1) < 1e-9, `dist=${dist}`)

    // 6c. A coluna de embedding existe com a dimensão que o schema declara.
    const [{ tipo }] = await prisma.$queryRaw<{ tipo: string }[]>`
        SELECT format_type(a.atttypid, a.atttypmod) AS tipo
        FROM pg_attribute a
        WHERE a.attrelid = 'public.knowledge_documents'::regclass
          AND a.attname = 'embedding'
    `
    ok('knowledge_documents.embedding é vector(1536)', tipo === 'vector(1536)', tipo)

    // 7. Transação INTERATIVA — o motivo de ser WebSocket e não HTTP.
    const ws = await prisma.$transaction(async (tx) => {
        const criado = await tx.workspace.create({
            data: {
                name: 'Prova de Migração',
                slug: `prova-${Date.now()}`,
                // Workspace exige Account: a validação do cliente recusou sem ela,
                // que é mais uma prova de que o cliente gerado está íntegro.
                account: { create: { name: 'Conta da Prova' } },
            },
            select: { id: true, name: true, accountId: true },
        })
        const lido = await tx.workspace.findUnique({ where: { id: criado.id }, select: { id: true } })

        // A coluna GERADA vive em Contact (e em mais seis modelos). É o Postgres
        // que a calcula, via public.immutable_unaccent — a aplicação nunca
        // escreve nela, e o banco recusa se tentar.
        const contato = await tx.contact.create({
            data: { workspaceId: criado.id, name: 'José DA Silva Conceição' },
            select: { id: true, searchText: true },
        })

        return { criado, contato, viuDentroDaTransacao: lido !== null }
    })
    ok('$transaction interativa funciona', ws.viuDentroDaTransacao)

    // 8. A coluna GERADA foi calculada pelo banco, não pela aplicação.
    ok(
        'coluna gerada searchText calculada pelo Postgres',
        ws.contato.searchText?.startsWith('jose da silva conceicao') === true,
        String(ws.contato.searchText)
    )

    // E a busca sem acento tem de encontrar quem foi gravado com acento — é o
    // ponto inteiro da coluna gerada.
    const achado = await prisma.contact.findFirst({
        where: { workspaceId: ws.criado.id, searchText: { contains: 'conceicao' } },
        select: { id: true },
    })
    ok('busca sem acento encontra nome com acento', achado?.id === ws.contato.id)

    // 9. Rollback de transação interativa de verdade.
    const slugRollback = `rollback-${Date.now()}`
    try {
        await prisma.$transaction(async (tx) => {
            await tx.workspace.create({
                data: {
                    name: 'Vai Reverter',
                    slug: slugRollback,
                    account: { create: { name: 'Conta que Reverte' } },
                },
            })
            throw new Error('revertendo de propósito')
        })
    } catch {
        /* esperado */
    }
    const sobrou = await prisma.workspace.findFirst({ where: { slug: slugRollback } })
    ok('rollback de transação reverte mesmo', sobrou === null)

    // 10. O cofre, agora contra um Postgres real.
    process.env[CHAVE_ENV] = gerarChave()
    delete process.env.PLATFORM_ASAAS_CLIENT_SECRET

    const nome = platformSecretName('asaas')
    const segredo = '$aact_hmlg_çãõ-prova-de-cofre'
    await writeVaultSecret(nome, segredo, 'Prova da migração')
    ok('cofre grava no Neon', await vaultSecretExists(nome))
    ok('cofre lê de volta o mesmo valor', (await readVaultSecret(nome)) === segredo)
    ok('origem é o banco quando não há secret', (await vaultSecretOrigin(nome)) === 'banco')

    const [{ guardado }] = await prisma.$queryRaw<{ guardado: string }[]>`
        SELECT value::text AS guardado FROM app_secrets WHERE name = ${nome}
    `
    ok('o que está na coluna é envelope, não texto puro', !guardado.includes('aact_hmlg'), guardado.slice(0, 48) + '…')

    // 11. Precedência do ambiente, e recusa de gravação.
    process.env.PLATFORM_ASAAS_CLIENT_SECRET = 'veio-do-ambiente'
    ok('ambiente tem precedência sobre o banco', (await readVaultSecret(nome)) === 'veio-do-ambiente')
    ok('origem passa a ser ambiente', (await vaultSecretOrigin(nome)) === 'ambiente')
    try {
        await writeVaultSecret(nome, 'tentativa', 'não deve passar')
        ok('gravação é recusada quando vem do ambiente', false)
    } catch (e) {
        ok(
            'gravação é recusada quando vem do ambiente',
            e instanceof SegredoDeAmbienteError && e.variavel === 'PLATFORM_ASAAS_CLIENT_SECRET'
        )
    }

    // Limpeza do que esta prova criou.
    delete process.env.PLATFORM_ASAAS_CLIENT_SECRET
    await prisma.appSecret.deleteMany({ where: { name: nome } })
    ok(
        'rollback não deixou Account órfã',
        (await prisma.account.findFirst({ where: { name: 'Conta que Reverte' } })) === null
    )

    await prisma.contact.deleteMany({ where: { workspaceId: ws.criado.id } })
    await prisma.workspace.deleteMany({ where: { id: ws.criado.id } })
    await prisma.account.deleteMany({ where: { id: ws.criado.accountId } })
    ok(
        'limpeza concluída',
        (await prisma.workspace.findFirst({ where: { id: ws.criado.id } })) === null &&
            (await prisma.account.findFirst({ where: { id: ws.criado.accountId } })) === null
    )

    console.log(falhas === 0 ? '\nTODOS OS TESTES PASSARAM' : `\n${falhas} FALHA(S)`)
    await prisma.$disconnect()
    process.exit(falhas === 0 ? 0 : 1)
}

void main()
