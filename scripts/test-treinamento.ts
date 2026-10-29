/**
 * Os casos do catálogo de documentos de treinamento.
 *
 *   npm run test:treinamento
 *
 * O catálogo é a espinha do método: a tela desenha por ele, o indexador decide o
 * que vetorizar por ele e o prompt monta a ordem por ele. Três coisas aqui são
 * invariantes de verdade, não preferência — e as três falham em silêncio:
 *
 *   - **slug.** É a chave de gravação e de substituição dos trechos. Trocar um
 *     slug não dá erro: dá um documento órfão e um acervo que não é mais
 *     substituído. A lista é conferida literal de propósito, para um rename
 *     passar a quebrar o teste em vez de passar a perder dado.
 *   - **precedência.** É o que resolve a contradição entre "crie urgência" e
 *     "não prometa resultado". Empate volta ao problema original: ganha quem
 *     estiver mais perto do fim do prompt, por acidente.
 *   - **o teto somado dos documentos de prompt.** É o que mantém o método
 *     viável. Subir isto sem perceber é trocar ~2 mil tokens por mensagem por
 *     ~12 mil, piorar a atenção do modelo no meio do contexto e mandar a conta
 *     para a margem.
 */
import {
    acharDocumento,
    conferirEstrutura,
    DOCUMENTOS,
    documentosDoAcervo,
    documentosDoPrompt,
    modeloDoDocumento,
    SECAO_EXEMPLOS,
    TETO_SOMADO_DO_PROMPT,
} from '@/lib/treinamento/documentos'
import { secionarMarkdown } from '@/lib/rag/secoes'
import {
    decidirIndexacao,
    hashDoConteudo,
    slugConhecido,
    tituloDoAcervo,
} from '@/lib/treinamento/indexar'

let passou = 0
let falhou = 0

function conferir(nome: string, real: unknown, esperado: unknown) {
    const a = JSON.stringify(real)
    const b = JSON.stringify(esperado)
    if (a === b) {
        passou++
        console.log(`  ok  ${nome}`)
    } else {
        falhou++
        console.log(`  XX  ${nome}\n        esperado: ${b}\n        veio:     ${a}`)
    }
}

console.log('\nOs slugs — chave de gravação, conferida literal')

conferir(
    'os sete slugs, nesta grafia',
    DOCUMENTOS.map((d) => d.slug),
    [
        'instrucoes-centrais',
        'empresa',
        'servicos',
        'processo-comercial',
        'tecnicas-de-venda',
        'faq',
        'privacidade',
    ]
)

conferir('slugs únicos', new Set(DOCUMENTOS.map((d) => d.slug)).size, DOCUMENTOS.length)
conferir(
    'slug é seguro para URL e para nome de arquivo',
    DOCUMENTOS.every((d) => /^[a-z0-9-]+$/.test(d.slug)),
    true
)
conferir('acharDocumento encontra pelo slug', acharDocumento('faq')?.titulo, 'Sinônimos e FAQ')
conferir('e devolve undefined no slug que não existe', acharDocumento('inventado'), undefined)

console.log('\nModo e precedência')

conferir(
    'três no prompt, quatro no acervo',
    [documentosDoPrompt().length, documentosDoAcervo().length],
    [3, 4]
)

conferir(
    'os do prompt são os de comportamento',
    documentosDoPrompt().map((d) => d.slug),
    ['privacidade', 'instrucoes-centrais', 'processo-comercial']
)

conferir(
    'os do acervo são os de fato consultável',
    documentosDoAcervo().map((d) => d.slug),
    ['empresa', 'servicos', 'tecnicas-de-venda', 'faq']
)

conferir(
    'precedências únicas — empate devolve a decisão ao acidente',
    new Set(DOCUMENTOS.map((d) => d.precedencia)).size,
    DOCUMENTOS.length
)

conferir(
    'Privacidade tem a maior precedência de todas',
    Math.min(...DOCUMENTOS.map((d) => d.precedencia)),
    acharDocumento('privacidade')!.precedencia
)

conferir(
    'Técnicas de venda vem DEPOIS de Privacidade e do Processo comercial',
    acharDocumento('tecnicas-de-venda')!.precedencia >
        Math.max(
            acharDocumento('privacidade')!.precedencia,
            acharDocumento('processo-comercial')!.precedencia
        ),
    true
)

conferir(
    'documentosDoPrompt já vem na ordem de precedência',
    documentosDoPrompt().map((d) => d.precedencia),
    [...documentosDoPrompt().map((d) => d.precedencia)].sort((a, b) => a - b)
)

console.log('\nTetos')

conferir('o teto somado do prompt é 11.000 caracteres', TETO_SOMADO_DO_PROMPT, 11_000)
conferir(
    'e cabe num bloco estável de prompt (~3 mil tokens)',
    TETO_SOMADO_DO_PROMPT <= 12_000,
    true
)
conferir(
    'documento de prompt tem teto apertado; de acervo, largo',
    [acharDocumento('privacidade')!.teto, acharDocumento('servicos')!.teto],
    [3000, 200_000]
)

console.log('\nA seção reservada')

conferir(
    'todos os sete oferecem a seção de exemplos',
    DOCUMENTOS.every((d) => d.secoes.includes(SECAO_EXEMPLOS)),
    true
)
conferir(
    'e ela é sempre a última, para não se misturar aos fatos',
    DOCUMENTOS.every((d) => d.secoes.at(-1) === SECAO_EXEMPLOS),
    true
)

console.log('\nO modelo que o botão escreve')

const modelo = modeloDoDocumento(acharDocumento('servicos')!)

conferir('começa pelo título do documento', modelo.startsWith('# Serviços prestados\n'), true)
conferir(
    'uma seção de 2º nível por item previsto',
    (modelo.match(/^## /gm) ?? []).length,
    acharDocumento('servicos')!.secoes.length
)
conferir(
    'e os cabeçalhos saem na ordem do catálogo',
    (modelo.match(/^## (.+)$/gm) ?? []).map((l) => l.replace('## ', '')),
    acharDocumento('servicos')!.secoes
)

console.log('\nConferência de estrutura — contra o corte real, não contra o texto cru')

const doc = acharDocumento('servicos')!

conferir(
    'modelo recém-inserido: TUDO faltando, porque nada tem corpo',
    conferirEstrutura(doc, secionarMarkdown(modelo)).faltando,
    doc.secoes
)

conferir(
    'o modelo não traz comentário de HTML — comentário é corpo, e seria indexado',
    modelo.includes('<!--'),
    false
)

const preenchido = `# Serviços prestados

## Regra geral

Nunca prometer prazo sem avaliação.

## Serviços

### Ortodontia

A partir de R$ 180 por mês.

## Diferenciais

Atendimento no mesmo dia.

## ${SECAO_EXEMPLOS}

"Posso te explicar as opções?"
`

conferir(
    'documento completo: nada faltando, nada sobrando',
    conferirEstrutura(doc, secionarMarkdown(preenchido)),
    { faltando: [], extras: [] }
)

conferir(
    'subtítulo de 3º nível conta para a seção de 2º nível que o contém',
    conferirEstrutura(doc, secionarMarkdown(preenchido)).faltando.includes('Serviços'),
    false
)

const semDiferenciais = preenchido.replace(/## Diferenciais\n\nAtendimento no mesmo dia.\n\n/, '')
conferir(
    'seção removida é apontada',
    conferirEstrutura(doc, secionarMarkdown(semDiferenciais)).faltando,
    ['Diferenciais']
)

const comExtra = `${preenchido}\n## Convênios\n\nAtendemos Amil.\n`
conferir(
    'cabeçalho não previsto aparece como extra, não como erro',
    conferirEstrutura(doc, secionarMarkdown(comExtra)),
    { faltando: [], extras: ['Convênios'] }
)

const vazia = preenchido.replace('Atendimento no mesmo dia.', '')
conferir(
    'seção com cabeçalho e sem conteúdo conta como faltando',
    conferirEstrutura(doc, secionarMarkdown(vazia)).faltando,
    ['Diferenciais']
)

console.log('\nO título dos trechos é o slug — e isso é deliberado')

conferir('tituloDoAcervo devolve o slug, não o título humano', tituloDoAcervo('servicos'), 'servicos')
conferir(
    'o slug NUNCA é o título da tela — se fosse, um rename orfanaria o acervo',
    DOCUMENTOS.every((d) => tituloDoAcervo(d.slug) !== d.titulo),
    true
)
conferir('slugConhecido aceita o do catálogo', slugConhecido('privacidade'), true)
conferir('e recusa slug inventado', slugConhecido('../etc/passwd'), false)

console.log('\nO hash do conteúdo')

const h1 = await hashDoConteudo('Ortodontia a partir de R$ 180.')
conferir('é SHA-256 em hexadecimal (64 caracteres)', /^[0-9a-f]{64}$/.test(h1), true)
conferir('é estável para o mesmo texto', await hashDoConteudo('Ortodontia a partir de R$ 180.'), h1)
conferir('e muda com o texto', (await hashDoConteudo('Ortodontia a partir de R$ 190.')) !== h1, true)
conferir(
    'acento conta (UTF-8), senão dois textos diferentes colidiriam',
    (await hashDoConteudo('protese')) !== (await hashDoConteudo('prótese')),
    true
)

console.log('\nA decisão de indexar — o que evita pagar embedding sete vezes')

const docRag = acharDocumento('servicos')!
const docPrompt = acharDocumento('instrucoes-centrais')!

conferir(
    'documento de modo prompt nunca é indexado — é o modo dele, não pendência',
    await decidirIndexacao({ doc: docPrompt, content: '# Instruções\n\nSeja breve.', hashGravado: null }),
    { acao: 'pular', motivo: 'modo-prompt' }
)

conferir(
    'documento de acervo com conteúdo novo é indexado',
    (await decidirIndexacao({ doc: docRag, content: '## Serviços\n\nOrtodontia.', hashGravado: null })).acao,
    'indexar'
)

const conteudo = '## Serviços\n\nOrtodontia a partir de R$ 180.'
const hashDele = await hashDoConteudo(conteudo)

conferir(
    'conteúdo INALTERADO é pulado — é isto que evita reindexar os sete a cada salvar',
    await decidirIndexacao({ doc: docRag, content: conteudo, hashGravado: hashDele }),
    { acao: 'pular', motivo: 'inalterado' }
)

conferir(
    'espaço em volta não conta como alteração',
    await decidirIndexacao({ doc: docRag, content: `\n\n${conteudo}\n  `, hashGravado: hashDele }),
    { acao: 'pular', motivo: 'inalterado' }
)

conferir(
    'uma vírgula a mais JÁ conta, e volta para a fila',
    (await decidirIndexacao({ doc: docRag, content: `${conteudo},`, hashGravado: hashDele })).acao,
    'indexar'
)

conferir(
    'documento esvaziado que JÁ tinha acervo manda apagar os trechos',
    await decidirIndexacao({ doc: docRag, content: '   ', hashGravado: hashDele }),
    { acao: 'apagar' }
)

conferir(
    'documento vazio que nunca teve acervo não tem nada a fazer',
    await decidirIndexacao({ doc: docRag, content: '', hashGravado: null }),
    { acao: 'pular', motivo: 'sem-conteudo' }
)

conferir(
    'o hash devolvido na ação indexar é o do conteúdo JÁ aparado',
    await decidirIndexacao({ doc: docRag, content: `  ${conteudo}  `, hashGravado: null }),
    { acao: 'indexar', hash: hashDele }
)

console.log(`\n${passou} ok, ${falhou} falha(s)\n`)
process.exit(falhou > 0 ? 1 : 0)
