/**
 * Prova o isolamento entre clínicas contra um Postgres de verdade.
 *
 * ## Por que este arquivo existe
 *
 * `docs/migration/01-compatibility.md:595-600` aceitou, por escrito, o preço de
 * remover o RLS do Supabase:
 *
 * > "a segunda linha de defesa que o RLS dava contra um defeito de aplicação
 * > sai… o preço de um defeito de autorização sobe. Isso torna os testes
 * > multi-tenant da Fase 5 **obrigatórios**, não desejáveis."
 *
 * Esses testes nunca foram escritos. A auditoria de 2026-10-23 encontrou quatro
 * defeitos exatamente dessa classe numa única passada — três deles escrita ou
 * leitura atravessando a fronteira da clínica. Este é o verificador que faltou.
 *
 * ## O que ele prova, e o que não prova
 *
 * **Prova** que `conferirRelacoes` recusa id de outra clínica e aceita o da
 * própria, nas duas formas de consulta que ela tem (modelo com `workspaceId`
 * próprio, e `userId`, que depende da participação). E prova que o
 * `updateMany` escopado da importação de contatos não alcança a clínica
 * vizinha.
 *
 * **Não prova** que toda rota chama o conferidor — isso é estático, e o lugar
 * disso é um linter como `lint-workspace.mjs`. Nem prova exaustividade de
 * campo: o `switch` de `quantosPertencem` não tem `default`, então um campo
 * novo sem ramo é **erro de tipo**, pego no `typecheck` antes de chegar aqui.
 *
 * ## A hierarquia importa
 *
 * CONTA → WORKSPACE. Uma conta tem várias unidades, então o cenário usa
 * **duas contas** com uma unidade cada (clínicas sem relação) **mais** uma
 * terceira unidade na primeira conta — porque o caso difícil não é a clínica
 * estranha, é a unidade irmã: `conferirRelacoes` tem de recusar o id dela
 * também. Dado da unidade é da unidade, não da conta.
 *
 * Cria e apaga o que usa, sempre com sufixo `@odontobox360.test` e slug
 * `prova-tenant-`. Nunca aponte para produção:
 *
 *     DATABASE_URL='<homologação>' npm run check:tenant
 */
import prisma from '@/lib/prisma'
import { conferirRelacoes } from '@/lib/auth/relacoes'

let falhas = 0
const ok = (nome: string, cond: boolean, extra = '') => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${nome}${extra ? '  — ' + extra : ''}`)
    if (!cond) falhas++
}

const MARCA = `prova-tenant-${Date.now()}`

async function main() {
    // ---------------------------------------------------------------- cenário

    const contaA = await prisma.account.create({ data: { name: `${MARCA}-contaA` } })
    const contaB = await prisma.account.create({ data: { name: `${MARCA}-contaB` } })

    // Unidade 1 e 2 na MESMA conta; unidade 3 numa conta sem relação.
    const un1 = await prisma.workspace.create({
        data: { accountId: contaA.id, name: 'Unidade 1', slug: `${MARCA}-un1` },
    })
    const un2 = await prisma.workspace.create({
        data: { accountId: contaA.id, name: 'Unidade 2', slug: `${MARCA}-un2` },
    })
    const un3 = await prisma.workspace.create({
        data: { accountId: contaB.id, name: 'Unidade 3', slug: `${MARCA}-un3` },
    })

    const pacienteDa1 = await prisma.contact.create({
        data: { workspaceId: un1.id, name: 'Paciente da Unidade 1' },
    })
    const pacienteDa2 = await prisma.contact.create({
        data: { workspaceId: un2.id, name: 'Paciente da Unidade 2' },
    })
    const pacienteDa3 = await prisma.contact.create({
        data: { workspaceId: un3.id, name: 'Paciente da Unidade 3' },
    })

    const origemDa2 = await prisma.origin.create({
        data: { workspaceId: un2.id, name: 'Origem da Unidade 2' },
    })

    const pessoa1 = await prisma.user.create({
        data: { email: `${MARCA}-p1@odontobox360.test`, name: 'Pessoa 1' },
    })
    const pessoa3 = await prisma.user.create({
        data: { email: `${MARCA}-p3@odontobox360.test`, name: 'Pessoa 3' },
    })
    await prisma.workspaceUser.create({
        data: { workspaceId: un1.id, userId: pessoa1.id, role: 'OWNER' },
    })
    await prisma.workspaceUser.create({
        data: { workspaceId: un3.id, userId: pessoa3.id, role: 'OWNER' },
    })

    // ------------------------------------------------- o próprio id é aceito

    ok(
        'o paciente da própria unidade é aceito',
        (await conferirRelacoes(un1.id, { contactId: pacienteDa1.id })) === null
    )
    ok(
        'o usuário que participa da própria unidade é aceito',
        (await conferirRelacoes(un1.id, { userId: pessoa1.id })) === null
    )

    // ------------------------------- id de clínica sem relação é recusado

    const deOutraConta = await conferirRelacoes(un1.id, { contactId: pacienteDa3.id })
    ok(
        'paciente de clínica de OUTRA conta é recusado',
        deOutraConta?.campo === 'contactId',
        deOutraConta?.mensagem
    )
    ok(
        'usuário que só participa de outra clínica é recusado',
        (await conferirRelacoes(un1.id, { userId: pessoa3.id }))?.campo === 'userId'
    )

    // ------------------------- e o caso difícil: a unidade IRMÃ, mesma conta

    /**
     * **A asserção que justifica o cenário ter três unidades.**
     *
     * Dado é da unidade, não da conta. Um conferidor que resolvesse a conta e
     * aceitasse qualquer unidade dela passaria em todos os testes acima e
     * falharia aqui — e esse é justamente o erro tentador de escrever, porque
     * "é tudo do mesmo cliente".
     */
    const daIrma = await conferirRelacoes(un1.id, { contactId: pacienteDa2.id })
    ok(
        'paciente da unidade IRMÃ (mesma conta) é recusado',
        daIrma?.campo === 'contactId',
        daIrma?.mensagem
    )
    ok(
        'origem da unidade IRMÃ é recusada',
        (await conferirRelacoes(un1.id, { originId: origemDa2.id }))?.campo === 'originId'
    )

    // --------------------------------------------------- forma e vários ids

    ok(
        'id inexistente é recusado como qualquer outro',
        (await conferirRelacoes(un1.id, { contactId: 'nao-existe-em-lugar-nenhum' }))?.campo ===
            'contactId'
    )
    ok(
        'nulo e vazio não são conferidos (limpar o campo é legítimo)',
        (await conferirRelacoes(un1.id, { contactId: null, dealId: undefined, userId: '' })) === null
    )
    ok(
        'um id bom e um ruim no mesmo corpo recusa',
        (await conferirRelacoes(un1.id, { contactId: pacienteDa1.id, originId: origemDa2.id }))
            ?.campo === 'originId'
    )
    ok(
        'a mensagem não revela que o id existe em outra clínica',
        !/outra|other|workspace|clínica/i.test(daIrma?.mensagem ?? ''),
        daIrma?.mensagem
    )

    // ------------------------- o updateMany escopado da importação de contatos

    /**
     * O defeito real de `contacts/import`, reproduzido.
     *
     * Era `update({ where: { id } })` com `existingId` vindo do **corpo da
     * requisição** e só `currentMembership()` na porta — membro de qualquer
     * clínica sobrescrevia contato de qualquer outra. A forma escopada tem de
     * devolver 0 e não tocar em nada.
     */
    const { count } = await prisma.contact.updateMany({
        where: { id: pacienteDa3.id, workspaceId: un1.id },
        data: { name: 'SOBRESCRITO POR OUTRA CLINICA' },
    })
    ok('updateMany escopado não alcança contato de outra clínica', count === 0, `count=${count}`)

    const intacto = await prisma.contact.findUnique({
        where: { id: pacienteDa3.id },
        select: { name: true },
    })
    ok(
        'e o nome do paciente da outra clínica segue intacto',
        intacto?.name === 'Paciente da Unidade 3',
        intacto?.name ?? '(sem nome)'
    )

    // ------------------------------------------------------------- limpeza

    await prisma.contact.deleteMany({
        where: { workspaceId: { in: [un1.id, un2.id, un3.id] } },
    })
    await prisma.origin.deleteMany({ where: { workspaceId: un2.id } })
    await prisma.workspaceUser.deleteMany({
        where: { workspaceId: { in: [un1.id, un2.id, un3.id] } },
    })
    await prisma.user.deleteMany({ where: { email: { startsWith: MARCA } } })
    await prisma.workspace.deleteMany({ where: { slug: { startsWith: MARCA } } })
    await prisma.account.deleteMany({ where: { name: { startsWith: MARCA } } })

    const sobrou = await prisma.workspace.count({ where: { slug: { startsWith: MARCA } } })
    ok('a limpeza não deixou unidade para trás', sobrou === 0, `${sobrou} restante(s)`)

    console.log(falhas === 0 ? '\nTODOS OS TESTES PASSARAM' : `\n${falhas} FALHA(S)`)
    await prisma.$disconnect()
    process.exit(falhas === 0 ? 0 : 1)
}

void main()
