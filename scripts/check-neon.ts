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
import { termosLexicais } from '@/lib/rag/fusao'

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

    /**
     * A busca híbrida do acervo — o SQL que o typecheck não alcança.
     *
     * Quatro coisas que só o banco responde, e nenhuma precisa de linha gravada:
     * a coluna é de fato **gerada e armazenada** pelo Postgres, a expressão dela
     * produz vetor de texto, os dois índices existem, e a consulta lexical **não
     * estoura** com os termos que `termosLexicais` produz. O último é o que pega
     * a classe de erro mais provável aqui: `to_tsquery` trata pontuação e símbolo
     * como operador, e pergunta de paciente é cheia deles.
     */
    /** `attgenerated` é `char` no catálogo; sem o cast o Prisma não desserializa. */
    const geradaPeloBanco = await prisma.$queryRaw<{ attgenerated: string }[]>`
        SELECT a.attgenerated::text AS attgenerated FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        WHERE c.relname = 'knowledge_documents' AND a.attname = 'searchVector'`

    ok(
        'searchVector é coluna GERADA e armazenada — nada no código a escreve',
        geradaPeloBanco[0]?.attgenerated === 's',
        `attgenerated=${geradaPeloBanco[0]?.attgenerated ?? '(ausente)'}`
    )

    const vetorDeTexto = await prisma.$queryRaw<{ v: string }[]>`
        SELECT to_tsvector('portuguese', public.immutable_unaccent('Clareamento a partir de R$ 180'))::text AS v`

    /**
     * `clareament` e não `clareamento`: a configuração `portuguese` **reduz ao
     * radical**, e é por isso que "clareamentos" e "clareamento" casam entre si.
     * Conferir a palavra inteira aqui seria conferir que o radical NÃO acontece.
     *
     * E `180` sobrevive como está — número não tem radical, e é justamente o
     * caso que a perna lexical veio resolver.
     */
    ok(
        'a expressão da coluna reduz ao radical e preserva o número',
        (vetorDeTexto[0]?.v ?? '').includes("'clareament'") &&
            (vetorDeTexto[0]?.v ?? '').includes("'180'"),
        vetorDeTexto[0]?.v ?? ''
    )

    const indices = await prisma.$queryRaw<{ indexname: string }[]>`
        SELECT indexname::text AS indexname FROM pg_indexes
        WHERE tablename = 'knowledge_documents'
          AND indexname IN ('knowledge_documents_searchVector_idx', 'knowledge_documents_embedding_hnsw_idx')`

    ok(
        'os dois índices da busca híbrida existem: GIN no texto, HNSW no vetor',
        indices.length === 2,
        indices.map((i) => i.indexname).sort().join(', ')
    )

    /**
     * A pergunta mais hostil que o medidor tem: símbolo de moeda, vírgula
     * decimal, interrogação e travessão. Com esses caracteres chegando crus ao
     * `to_tsquery`, a consulta morreria com erro de sintaxe — e morreria em
     * produção, numa mensagem de paciente, não aqui. Zero acerto é resposta
     * válida; o que se prova é que ela **responde**.
     */
    const termos = termosLexicais('quanto custa? R$ 180,00 — tá caro!')
    const lexical = await prisma.$queryRaw<{ n: bigint }[]>`
        WITH consulta AS (SELECT to_tsquery('portuguese', public.immutable_unaccent(${termos ?? 'x'})) AS q)
        SELECT count(*) AS n FROM "knowledge_documents" d
        WHERE d."agentId" = ${'agente-que-nao-existe'} AND d."searchVector" @@ (SELECT q FROM consulta)`

    ok(
        'a consulta lexical roda com pontuação e símbolo na pergunta',
        Number(lexical[0]?.n ?? -1) === 0,
        `termos: "${termos}"`
    )

    /**
     * ## Passo 3: a entrega à equipe e as lacunas
     *
     * Três coisas que só o banco responde: as duas colunas de entrega existem, a
     * tabela de lacunas existe com os índices que a conta de escalada usa, e — a
     * mais importante — **apagar a conversa não apaga a lacuna**.
     *
     * Esse último é o que justifica a tabela: o valor da lacuna é sobreviver ao
     * atendimento, porque é a mineração semanal do passo 5 que vai lê-la. Com
     * `onDelete: Cascade` na conversa, o `CONVERSATION_AUTOCLOSE` e qualquer
     * limpeza de histórico levariam o material embora em silêncio.
     */
    const colunasDeEntrega = await prisma.$queryRaw<{ column_name: string }[]>`
        SELECT column_name::text AS column_name FROM information_schema.columns
        WHERE table_name = 'conversations' AND column_name IN ('handoffAt', 'handoffReason')`

    ok(
        'as duas colunas de entrega existem em conversations',
        colunasDeEntrega.length === 2,
        colunasDeEntrega.map((c) => c.column_name).sort().join(', ')
    )

    const indicesDaLacuna = await prisma.$queryRaw<{ indexname: string }[]>`
        SELECT indexname::text AS indexname FROM pg_indexes WHERE tablename = 'knowledge_gaps'`

    ok(
        'knowledge_gaps existe com os dois índices que a escalada e a fila usam',
        indicesDaLacuna.length >= 3,
        indicesDaLacuna.map((i) => i.indexname).sort().join(', ')
    )

    /**
     * A prova de que a lacuna sobrevive: cria agente, conversa e lacuna, apaga a
     * conversa, e confere que a lacuna ficou — com `conversationId` nulo.
     */
    const agenteDaLacuna = await prisma.agent.create({
        data: {
            workspaceId: ws.criado.id,
            name: 'Agente da Prova',
            llmProvider: 'openai',
            llmModel: 'gpt-4o-mini',
            systemPrompt: 'prova',
        },
        select: { id: true },
    })
    const contatoDaLacuna = await prisma.contact.create({
        data: { workspaceId: ws.criado.id, name: 'Quem Perguntou' },
        select: { id: true },
    })
    const conversaDaLacuna = await prisma.conversation.create({
        data: {
            workspaceId: ws.criado.id,
            contactId: contatoDaLacuna.id,
            agentId: agenteDaLacuna.id,
            channel: 'whatsapp',
        },
        select: { id: true, handoffAt: true },
    })

    ok('conversa nasce sem entrega', conversaDaLacuna.handoffAt === null)

    const lacuna = await prisma.knowledgeGap.create({
        data: {
            workspaceId: ws.criado.id,
            agentId: agenteDaLacuna.id,
            conversationId: conversaDaLacuna.id,
            question: 'vocês fazem clareamento a laser?',
            bestSimilarity: 0.21,
            chunkCount: 2,
        },
        select: { id: true, source: true, status: true },
    })

    ok(
        'a lacuna nasce automática e nova — os padrões vêm do banco',
        lacuna.source === 'automatica' && lacuna.status === 'nova',
        `${lacuna.source}/${lacuna.status}`
    )

    await prisma.conversation.delete({ where: { id: conversaDaLacuna.id } })
    const sobreviveu = await prisma.knowledgeGap.findUnique({
        where: { id: lacuna.id },
        select: { conversationId: true, question: true },
    })

    ok(
        'apagar a conversa NÃO apaga a lacuna — só solta a referência',
        sobreviveu !== null && sobreviveu.conversationId === null,
        sobreviveu === null ? '(a lacuna foi embora)' : `conversationId=${sobreviveu.conversationId}`
    )

    /**
     * ## Passo 4: rascunho, versão e conjunto dourado
     *
     * O que só o banco responde: a coluna de rascunho existe, a versão nasce em
     * zero, e **a versão é única por agente** — é essa restrição que impede duas
     * publicações simultâneas de gravarem a "versão 4" duas vezes e deixarem a
     * volta atrás ambígua.
     */
    const agenteDaVersao = await prisma.agent.create({
        data: {
            workspaceId: ws.criado.id,
            name: 'Agente da Versao',
            llmProvider: 'openai',
            llmModel: 'gpt-4o-mini',
            systemPrompt: 'prova',
        },
        select: { id: true, trainingVersion: true },
    })

    ok('o agente nasce na versão 0 — "nunca publicou"', agenteDaVersao.trainingVersion === 0)

    const docDeTreino = await prisma.agentTrainingDoc.create({
        data: { agentId: agenteDaVersao.id, slug: 'servicos', content: '', draftContent: 'rascunho' },
        select: { content: true, draftContent: true },
    })

    ok(
        'salvar grava rascunho e deixa o publicado vazio — nada chega ao agente sem publicar',
        docDeTreino.content === '' && docDeTreino.draftContent === 'rascunho'
    )

    await prisma.agentTrainingVersion.create({
        data: {
            agentId: agenteDaVersao.id,
            version: 1,
            docs: [{ slug: 'servicos', content: 'rascunho' }],
            changed: ['servicos'],
        },
    })

    let repetiu = false
    try {
        await prisma.agentTrainingVersion.create({
            data: { agentId: agenteDaVersao.id, version: 1, docs: [], changed: [] },
        })
        repetiu = true
    } catch {
        // É o que se espera: a restrição única recusou.
    }

    ok('a mesma versão NÃO pode ser gravada duas vezes para o mesmo agente', repetiu === false)

    /**
     * O caso dourado e a avaliação: existem, e apagar o agente leva os dois.
     *
     * `Cascade` aqui e não `SetNull` — ao contrário da lacuna: caso de avaliação
     * sem agente não quer dizer nada, porque o critério de aprovação é **daquele**
     * agente. A lacuna sobrevive porque ela é material de escrita, não de
     * julgamento.
     */
    const casoDourado = await prisma.evaluationCase.create({
        data: {
            workspaceId: ws.criado.id,
            agentId: agenteDaVersao.id,
            question: 'quanto custa um clareamento?',
            chunks: ['Serviços › Clareamento\nA partir de R$ 180.'],
            reference: 'Começa em R$ 180.',
        },
        select: { id: true, kind: true },
    })

    ok('o caso nasce como aprovado — o padrão vem do banco', casoDourado.kind === 'aprovado')

    const bateria = await prisma.evaluation.create({
        data: {
            workspaceId: ws.criado.id,
            agentId: agenteDaVersao.id,
            version: 1,
            cases: 2,
            wins: 1,
            losses: 1,
            preference: 0.5,
            warnings: ['poucos casos'],
            details: [],
        },
        select: { id: true, kind: true, unreadable: true },
    })

    ok(
        'a bateria nasce como regressão, com zero ilegíveis',
        bateria.kind === 'regressao' && bateria.unreadable === 0,
        `${bateria.kind}/${bateria.unreadable}`
    )

    await prisma.agent.delete({ where: { id: agenteDaVersao.id } })

    ok(
        'apagar o agente leva versão, caso e bateria — critério de aprovação sem agente não diz nada',
        (await prisma.agentTrainingVersion.count({ where: { agentId: agenteDaVersao.id } })) === 0 &&
            (await prisma.evaluationCase.count({ where: { agentId: agenteDaVersao.id } })) === 0 &&
            (await prisma.evaluation.count({ where: { agentId: agenteDaVersao.id } })) === 0
    )

    await prisma.knowledgeGap.deleteMany({ where: { workspaceId: ws.criado.id } })
    await prisma.agent.deleteMany({ where: { workspaceId: ws.criado.id } })

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
