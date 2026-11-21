/**
 * Prova os sete requisitos da rota pública de documento, sem banco.
 *
 *     pnpm run check:proposta-publica
 *
 * ## Por que este verificador existe separado
 *
 * `/p/{token}` é a **única rota sem autenticação de todo o produto**, e o risco
 * ali está catalogado como de severidade alta: um vazamento entre unidades
 * expõe a proposta de um cliente a outro. Os sete requisitos não são
 * preferências — cada um fecha um caminho concreto.
 *
 * ## O que se prova aqui, e o que só staging prova
 *
 * O que depende de banco — token de outra unidade devolvendo 404, expirado
 * devolvendo a MESMA 404, aceite concorrente — só se prova com Postgres, e
 * portanto em staging. O que **se** prova sem banco é tudo que é decisão de
 * código:
 *
 *   - a projeção mínima: por varredura do próprio fonte, porque o defeito aqui
 *     é de ADIÇÃO — alguém acrescenta `notes: true` ao `select` meses depois,
 *     nada quebra, e a observação interna do vendedor passa a sair na página do
 *     cliente. Nenhum teste de comportamento pega isso; um teste de forma pega;
 *   - o render público: que o HTML não carrega campo interno, e que escapa;
 *   - o hash: determinístico e sensível ao conteúdo;
 *   - a resposta uniforme: que a página e a rota não têm mensagem distinta por
 *     caso de recusa.
 *
 * A técnica de varrer o próprio fonte é a mesma de `scripts/check-trabalhos.ts`,
 * que lê o bloco `const TASKS` para afirmar que toda tarefa despachada tem
 * agenda. Serve para a mesma classe de erro: a que não falha, só vaza.
 */
// PRIMEIRO de todos: registra uma marca fictícia, porque este script roda
// código do core e o core PEDE a marca. Ver `./lib/marca-de-teste.ts`.
import './lib/marca-de-teste.ts'

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Prisma } from '@venn/db'
import { hashDoConteudo } from '@venn/core/lib/propostas/compartilhar'
import { VALIDADE_MAXIMA_EM_DIAS, VALIDADE_PADRAO_EM_DIAS } from '@venn/core/lib/propostas/validade'
import { pareceToken, renderizarPublico } from '@venn/core/lib/propostas/publico'

let falhas = 0
const ok = (nome: string, cond: boolean, extra = '') => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${nome}${extra ? '  — ' + extra : ''}`)
    if (!cond) falhas++
}

/**
 * A raiz do core, a partir deste arquivo — não de `process.cwd()`.
 *
 * O verificador é rodado da raiz do repositório pelo `package.json`, mas
 * depender disso faria `pnpm --filter` quebrá-lo em silêncio: `readFileSync`
 * de um caminho que não existe lança, e a leitura do fonte é metade do que
 * este script prova.
 */
const CORE = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'core', 'src')
const ler = (caminho: string) => readFileSync(join(CORE, caminho), 'utf8')

// ================================================== 1. o token

console.log('\n── requisito 1: token opaco de 32 bytes ──')

{
    /**
     * `pareceToken` é higiene, não segurança — a segurança é o token não existir
     * na tabela. Mas a higiene importa: sem ela, `/p/undefined` gasta uma
     * consulta, e um link truncado colado do WhatsApp também.
     */
    ok('token de 43 caracteres base64url passa', pareceToken('a'.repeat(43)))
    ok('token vazio é recusado', !pareceToken(''))
    ok('undefined é recusado', !pareceToken(undefined))
    ok('token curto é recusado', !pareceToken('abc'))
    ok('token com caractere fora do alfabeto é recusado', !pareceToken('a'.repeat(42) + '/'))
    ok('token com ponto é recusado', !pareceToken('a'.repeat(42) + '.'))
}

{
    /**
     * O token vem de `sortearToken()`, que é `crypto.getRandomValues` de 32
     * bytes. Esta asserção não testa o sorteio (há o verificador do convite para
     * isso) — testa que `criarLink` não passou a usar outra coisa.
     *
     * O que isto pega: alguém trocar por `cuid()` "porque já temos", e o token
     * passar a ser sequencial-por-tempo e adivinhável.
     */
    const fonte = ler('lib/propostas/compartilhar.ts')
    ok('o link usa sortearToken (CSPRNG), não cuid', fonte.includes('sortearToken()'))
    ok('não usa cuid para o token', !/cuid\(\)/.test(fonte))
    ok('não usa Math.random', !/Math\.random/.test(fonte))
}

// ================================================== 2 e 3. validade e revogação

console.log('\n── requisitos 2 e 3: validade obrigatória e revogação ──')

{
    ok('há validade padrão', VALIDADE_PADRAO_EM_DIAS > 0)
    ok('há TETO de validade', VALIDADE_MAXIMA_EM_DIAS > 0)
    /**
     * O teto é o que impede a decisão de ser contornada pela interface: sem
     * ele, a tela acabaria oferecendo "não expira", e `expiresAt` obrigatório
     * no banco teria virado letra morta.
     */
    ok(
        'o teto não é absurdo (link de valor não vive um ano)',
        VALIDADE_MAXIMA_EM_DIAS <= 180,
        `${VALIDADE_MAXIMA_EM_DIAS} dias`
    )
    ok('o padrão respeita o teto', VALIDADE_PADRAO_EM_DIAS <= VALIDADE_MAXIMA_EM_DIAS)
}

{
    const fonte = ler('lib/propostas/compartilhar.ts')
    /**
     * A consulta do documento público tem de filtrar os três: revogado,
     * expirado e proposta apagada. Cada um é um vazamento se faltar.
     */
    const consulta = fonte.slice(fonte.indexOf('export async function documentoPublico'))
    ok('a consulta pública exige revokedAt: null', consulta.includes('revokedAt: null'))
    ok('a consulta pública exige expiresAt no futuro', /expiresAt:\s*\{\s*gt:/.test(consulta))
    ok('a consulta pública exige proposta não apagada', consulta.includes('deletedAt: null'))
}

{
    // Apagar a proposta revoga os links: sem isto o documento sai da tela de
    // todos e CONTINUA abrindo para quem tem o link.
    const fonte = ler('rotas/api/propostas/[id]/route.ts')
    const apagar = fonte.slice(fonte.indexOf('export async function DELETE'))
    ok('apagar a proposta revoga os links abertos', apagar.includes('proposalShare.updateMany'))
    ok('apagar é lógico, não físico', apagar.includes('deletedAt') && !apagar.includes('proposal.delete'))
}

{
    // Reenviar revoga o anterior: o caso do destinatário errado.
    const fonte = ler('rotas/api/propostas/[id]/revisoes/[versao]/enviar/route.ts')
    ok('reenviar revoga o link anterior', fonte.includes('revokedAt: new Date()'))
    ok('o link aceito NÃO é revogado no reenvio', fonte.includes('acceptedAt: null'))
}

// ================================================== 4. a mesma 404

console.log('\n── requisito 4: a MESMA resposta para inexistente, expirado e revogado ──')

{
    /**
     * Uma consulta, uma resposta.
     *
     * Se `documentoPublico` devolvesse motivos distintos — ou se a página
     * ramificasse em "expirou" / "foi revogado" / "não existe" —, quem varre
     * tokens aprenderia quais existem, e com isso quantos documentos a unidade
     * tem. Então os três casos são indistinguíveis por construção: a função
     * devolve `null` para todos.
     */
    const fonte = ler('lib/propostas/compartilhar.ts')
    const consulta = fonte.slice(
        fonte.indexOf('export async function documentoPublico'),
        fonte.indexOf('export type DocumentoPublico')
    )
    ok(
        'documentoPublico não distingue o motivo da recusa',
        !/revogado|expirado|'expired'|'revoked'/i.test(consulta.replace(/\/\*[\s\S]*?\*\//g, ''))
    )

    const pagina = ler('rotas/p/[token]/page.tsx')
    const semComentarios = pagina.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '')
    /**
     * Uma única tela de recusa, usada em todos os caminhos — inclusive no do
     * rate limit, que também não deve confirmar existência.
     */
    /**
     * São exatamente TRÊS caminhos de recusa, e todos levam à mesma tela:
     * token malformado, limite de taxa excedido e documento não encontrado
     * (que já engloba inexistente, expirado, revogado e proposta apagada).
     *
     * O terceiro é o que importa: ele é um `null` só, vindo de uma consulta só.
     */
    const usos = semComentarios.match(/<Indisponivel \/>/g) ?? []
    ok('a página tem uma única tela de recusa', semComentarios.split('function Indisponivel').length === 2)
    ok('os três caminhos de recusa levam a ela', usos.length === 3, `${usos.length} usos`)
    ok(
        'a tela de recusa não diz qual foi o motivo',
        !/expirou|expirado|revogad|não existe|limite excedido/i.test(
            semComentarios.slice(semComentarios.indexOf('function Indisponivel'), semComentarios.indexOf('export default'))
        )
    )

    const aceitar = ler('rotas/api/p/[token]/aceitar/route.ts')
    const semCom = aceitar.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '')
    // As recusas de existência usam a mesma frase. "Documento indisponível"
    // para token inválido e para share ausente — e nenhuma delas diz por quê.
    const indisponivel = semCom.match(/Documento indisponível/g) ?? []
    ok('a rota de aceite usa a mesma frase para recusa de existência', indisponivel.length >= 3, `${indisponivel.length}`)
    ok('a rota de aceite não tem GET que aceite', semCom.includes('405'))
}

// ================================================== 5. rate limit

console.log('\n── requisito 5: rate limit por IP E por token ──')

{
    const fonte = ler('lib/propostas/publico.ts')
    const limite = fonte.slice(fonte.indexOf('export async function dentroDoLimitePublico'))
    /**
     * Os dois eixos, e nenhum basta sozinho: só por IP, quem varre de uma
     * botnet passa; só por token, quem usa um token diferente por tentativa
     * passa.
     */
    ok('limita por IP', limite.includes(':ip:'))
    ok('limita por token', limite.includes(':token:'))
    ok('os dois têm de passar (E, não OU)', /porIp\s*&&\s*porToken/.test(limite))
    ok('o aceite tem teto próprio, mais apertado', fonte.includes('TETO_DE_ACEITE'))

    const pagina = ler('rotas/p/[token]/page.tsx')
    ok('a página aplica o limite', pagina.includes('dentroDoLimitePublico'))
    const aceitar = ler('rotas/api/p/[token]/aceitar/route.ts')
    ok('o aceite aplica o limite', aceitar.includes("dentroDoLimitePublico") && aceitar.includes("'aceitar'"))
    ok('o aceite responde 429 ao exceder', aceitar.includes('429'))
}

// ================================================== 6. projeção mínima

console.log('\n── requisito 6: projeção mínima ──')

{
    /**
     * O defeito aqui é de ADIÇÃO, e é por isso que este teste olha o fonte.
     *
     * Meses depois, alguém precisa de um campo na tela interna, acrescenta
     * `notes: true` ao `select` errado, e nada quebra: a página do cliente
     * passa a receber a observação interna do vendedor — "cliente pediu
     * desconto, aprovei 10%" — no payload. Nenhum teste de comportamento pega
     * isso, porque o comportamento não muda. Um teste de forma pega.
     */
    const fonte = ler('lib/propostas/compartilhar.ts')
    const projecao = fonte.slice(
        fonte.indexOf('export async function documentoPublico'),
        fonte.indexOf('export type DocumentoPublico')
    )
    const semComentarios = projecao.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '')

    /**
     * O critério é `campo: true` — a forma do `select`, não o nome seguido de
     * dois pontos.
     *
     * A primeira versão procurava `'token:'` e reprovava na própria assinatura,
     * `documentoPublico(token: string)`. Um filtro no `where` também é
     * legítimo (`revokedAt: null`, `token`), e o que não pode é o campo ser
     * PEDIDO de volta.
     */
    const proibidos: [string, string][] = [
        ['notes', 'a observação interna do vendedor'],
        ['contentHash', 'o hash só interessa à auditoria interna'],
        ['acceptedIp', 'o IP de um aceite anterior'],
        ['acceptedUserAgent', 'o agente de um aceite anterior'],
        ['token', 'o token de outro link da mesma revisão'],
        ['email', 'o e-mail de quem quer que seja'],
        ['phone', 'o telefone do contato'],
        ['userId', 'id interno de pessoa'],
        ['dealId', 'id interno de negócio'],
        ['templateId', 'id interno de modelo'],
        ['value', 'o valor que o vendedor digitou no negócio'],
        ['closedValue', 'o valor fechado do negócio'],
        ['probability', 'a probabilidade interna'],
        ['stageId', 'a etapa do funil'],
        ['searchText', 'o texto de busca interno'],
    ]

    const pede = (campo: string) => new RegExp(`\\b${campo}:\\s*true`).test(semComentarios)

    for (const [campo, porque] of proibidos) {
        ok(`a projeção pública NÃO pede ${campo} (${porque})`, !pede(campo))
    }

    // E o que ela PRECISA ter, para a página existir.
    for (const campo of ['total', 'title', 'number', 'currency', 'expiresAt']) {
        ok(`a projeção pública pede ${campo}`, pede(campo))
    }
}

// ================================================== o render público

console.log('\n── o documento renderizado ──')

const D = Prisma.Decimal

/**
 * Um `share` sintético, na forma que `documentoPublico` devolve.
 *
 * Construído à mão para exercitar `renderizarPublico` sem banco. Os campos
 * internos — `notes` com texto que não pode sair, nome de contato com HTML —
 * estão aqui de propósito: é o que o teste procura na saída.
 */
const NOTA_INTERNA = 'INTERNO: cliente pediu 30%, aprovei 10% com o gestor'
const shareFalso = {
    id: 'share1',
    expiresAt: new Date('2027-01-01T00:00:00Z'),
    acceptedAt: null,
    acceptedByName: null,
    revision: {
        id: 'rev1',
        subtotal: new D('1000.00'),
        discount: new D('100.00'),
        total: new D('900.00'),
        validUntil: new Date('2026-12-31T00:00:00Z'),
        status: 'enviada',
        createdAt: new Date('2026-11-21T12:00:00Z'),
        notes: NOTA_INTERNA,
        items: [
            {
                description: 'Clareamento',
                quantity: new D('2'),
                unitPrice: new D('500.00'),
                discountPct: new D('10'),
                total: new D('900.00'),
                productService: { unit: 'sessão' },
            },
        ],
        proposal: {
            kind: 'proposta',
            title: 'Plano de tratamento',
            number: 1042,
            currency: 'BRL',
            createdAt: new Date('2026-11-21T12:00:00Z'),
            template: { body: '# {{titulo}}\n\nPara: {{cliente}}\n\n{{itens}}\n\n{{observacao}}' },
            createdBy: { name: 'Ana Souza' },
            deal: { contact: { name: '<script>alert(1)</script> Maria' } },
            workspace: { name: 'Clínica Exemplo', logo: null },
        },
    },
    // Presente no objeto de propósito: se `renderizarPublico` passar a ler
    // daqui, o teste abaixo acusa.
} as unknown as Parameters<typeof renderizarPublico>[0]

{
    const doc = renderizarPublico(shareFalso)

    ok('o documento traz o título', doc.html.includes('Plano de tratamento'))
    ok('o documento traz o item', doc.html.includes('Clareamento'))
    ok('o documento traz o total', doc.totalEmTexto.includes('900,00'), doc.totalEmTexto)
    ok('o rótulo e o número saem', doc.rotulo === 'Proposta' && doc.numero === 1042)

    /**
     * A observação interna NÃO sai, mesmo com `{{observacao}}` no template.
     *
     * `renderizarPublico` passa `observacao: null` de propósito: `notes` é o
     * caderno do vendedor. Se este teste falhar, uma frase como a de
     * `NOTA_INTERNA` chega ao cliente — e o desconto que ele não conseguiu
     * negociar aparece escrito.
     */
    ok('a observação interna da revisão NÃO entra no documento', !doc.html.includes('INTERNO'))
    ok('nenhum pedaço da nota interna vaza', !doc.html.includes('aprovei 10%'))

    // O nome do contato vem do banco, que aceita qualquer texto.
    ok('o nome do contato é escapado', !doc.html.includes('<script>') && doc.html.includes('&lt;script&gt;'))

    // Determinismo: é a condição para o hash do aceite valer.
    ok('o render é determinístico', renderizarPublico(shareFalso).html === doc.html)
}

{
    // Desconto zero não imprime "Desconto: R$ 0,00" — o marcador desaparece
    // levando a pontuação com ele.
    const semDesconto = JSON.parse(JSON.stringify(shareFalso)) as Record<string, never>
    // (o clone perde os Decimal; este caso é coberto por check:propostas)
    void semDesconto
}

// ================================================== 7. trilha do aceite

console.log('\n── requisito 7: trilha no aceite ──')

{
    const fonte = ler('lib/propostas/aceite.ts')

    for (const campo of ['acceptedAt', 'acceptedByName', 'acceptedIp', 'acceptedUserAgent', 'contentHash']) {
        ok(`o aceite grava ${campo}`, fonte.includes(campo))
    }

    /**
     * A corrida do duplo clique.
     *
     * `updateMany` com `acceptedAt: null` no `where` é o que faz o segundo
     * clique atualizar zero linhas. Um `update` por id gravaria os dois e o
     * carimbo registrado seria o do clique duplicado — a hora errada do ato.
     */
    ok(
        'o aceite usa updateMany com acceptedAt: null (fecha a corrida)',
        /updateMany\(\{[\s\S]{0,200}acceptedAt:\s*null/.test(fonte)
    )
    ok('conta as linhas afetadas para saber se perdeu a corrida', fonte.includes('marcado.count === 0'))

    // A cadeia inteira numa transação.
    ok('tudo numa transação', fonte.includes('prisma.$transaction'))
    ok('a revisão vira aceita', fonte.includes("status: 'aceita'"))
    ok('o negócio recebe o valor', fonte.includes('value: valorParaOFunil'))
    ok('a passagem de etapa é registrada', fonte.includes('dealStageEntry.create'))
    ok('o vendedor é notificado', fonte.includes('notification.create'))
    ok('os outros links são revogados', fonte.includes('proposalShare.updateMany'))

    /**
     * A conversão Decimal -> Float mora numa fronteira só, comentada.
     *
     * Se `Number(` aparecer em outro arquivo do módulo aplicado a dinheiro, a
     * regra do projeto ("campo novo nasce Decimal, legado não migra, conversão
     * explícita na fronteira") passou a ser contornada em silêncio.
     */
    ok('a conversão para Float é explícita e comentada', /Number\(revisao\.total\)/.test(fonte))
}

{
    // O hash: determinístico, e sensível ao conteúdo.
    const a = await hashDoConteudo('<p>900,00</p>')
    const b = await hashDoConteudo('<p>900,00</p>')
    const c = await hashDoConteudo('<p>800,00</p>')
    ok('o hash é determinístico', a === b)
    ok('o hash muda quando o conteúdo muda', a !== c)
    ok('o hash é SHA-256 em hexadecimal', /^[0-9a-f]{64}$/.test(a), a.slice(0, 16) + '…')
}

// ================================================== indexação

console.log('\n── fora dos buscadores ──')

{
    const pagina = ler('rotas/p/[token]/page.tsx')
    ok('a página pede noindex', /index:\s*false/.test(pagina))
    ok('a página pede nofollow', /follow:\s*false/.test(pagina))
    /**
     * O título da aba não traz o nome do documento.
     *
     * A aba aparece no histórico do navegador e em qualquer captura de tela que
     * o cliente mande para um grupo. "Proposta 1042 — Clínica Exemplo" ali é
     * vazamento de graça.
     */
    const meta = pagina.slice(pagina.indexOf('generateMetadata'), pagina.indexOf('function Indisponivel'))
    ok('o título da aba é genérico', meta.includes("title: 'Documento'"))
}

// ================================================== fecho

console.log('')
if (falhas > 0) {
    console.log(`${falhas} FALHA(S)`)
    process.exitCode = 1
} else {
    console.log('tudo passou')
}
