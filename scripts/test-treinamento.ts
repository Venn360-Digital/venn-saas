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
// PRIMEIRO de todos: registra uma marca fictícia, porque este script roda
// código do core e o core PEDE a marca. Ver `./lib/marca-de-teste.ts`.
import './lib/marca-de-teste.ts'

import {
    acharDocumento,
    conferirEstrutura,
    DOCUMENTOS,
    LIMITE_DO_ROTULO,
    documentosDoAcervo,
    documentosDeFato,
    documentosDoPrompt,
    modeloDoDocumento,
    SECAO_EXEMPLOS,
    orcamentoDoPrompt,
    TAMANHO_DE_TRECHO,
} from '@venn/core/lib/treinamento/documentos'
import { secionarMarkdown, semComentarios, TAMANHO_MAX } from '@venn/core/lib/rag/secoes'
import { MODELOS } from '@venn/core/lib/treinamento/modelos'
import {
    decidirIndexacao,
    hashDoConteudo,
    slugConhecido,
    textoParaAcervo,
    tituloDoAcervo,
} from '@venn/core/lib/treinamento/indexar'
import { ehSecaoDeExemplos, semExemplos } from '@venn/core/lib/treinamento/exemplos'

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
    'os oito slugs, nesta grafia — `cenarios` é o do passo 6',
    DOCUMENTOS().map((d) => d.slug),
    [
        'instrucoes-centrais',
        'empresa',
        'servicos',
        'processo-comercial',
        'tecnicas-de-venda',
        'faq',
        'privacidade',
        'cenarios',
    ]
)

conferir('slugs únicos', new Set(DOCUMENTOS().map((d) => d.slug)).size, DOCUMENTOS().length)
conferir(
    'slug é seguro para URL e para nome de arquivo',
    DOCUMENTOS().every((d) => /^[a-z0-9-]+$/.test(d.slug)),
    true
)
conferir('acharDocumento encontra pelo slug', acharDocumento('faq')?.titulo, 'Sinônimos e FAQ')
conferir('e devolve undefined no slug que não existe', acharDocumento('inventado'), undefined)

console.log('\nModo e precedência')

/**
 * A divisão **foi medida**, não arbitrada — e mudou em 2026-10-29 por causa dos
 * números, não de gosto. Quem mexer nela deve medir de novo
 * (`npm run medir:recuperacao`), porque cada linha abaixo tem uma razão:
 *
 *   - `empresa` saiu do acervo porque "onde vocês ficam?" era recuperado a
 *     **0.371** com o piso em 0.35. A pergunta mais básica que existe numa
 *     empresa, a um centésimo de desaparecer.
 *   - `tecnicas-de-venda` saiu porque "depois eu vejo isso" **não recuperava
 *     nada**. Contorno de objeção é comportamento: tem de valer sempre, não
 *     quando a busca coopera.
 *   - `servicos` e `faq` ficam: são acervo de fato consultável e crescem com o
 *     cliente. `faq` é, de longe, o mais recuperado (36 vezes contra 18 de
 *     `servicos`) — ela é escrita em forma de pergunta, o que a aproxima
 *     vetorialmente de qualquer pergunta.
 */
/**
 * **Sete no prompt, um no acervo, e nenhum documento de fato é recuperado.**
 *
 * `servicos` e `faq` saíram do acervo em 2026-11-12, por decisão do Andre. Sobra
 * `cenarios`, de modo `servico`: ele é indexado (o corpo chega por busca),
 * mas não é fonte de verdade — é ordem de execução. Por isso `documentosDoAcervo`
 * o inclui e `documentosDeFato` não, e é essa distinção que o prompt usa para pôr
 * os passos numa seção própria em vez de em "Base de conhecimento".
 *
 * `documentosDeFato()` vazio é o estado **correto** agora, não um defeito: todo
 * fato que a empresa escreve viaja no prompt. A função fica porque a distinção
 * fato/servico continua valendo — é ela que decide a seção do prompt.
 */
conferir(
    'sete no prompt, um no acervo, e nenhum de fato é recuperado',
    [documentosDoPrompt().length, documentosDoAcervo().length, documentosDeFato().length],
    [7, 1, 0]
)

conferir(
    'os do prompt vêm na ordem de precedência, e agora são sete',
    documentosDoPrompt().map((d) => d.slug),
    [
        'privacidade',
        'instrucoes-centrais',
        'processo-comercial',
        'empresa',
        'servicos',
        'tecnicas-de-venda',
        'faq',
    ]
)

conferir(
    'no acervo sobrou só o servico; de fato, nenhum',
    [documentosDeFato().map((d) => d.slug), documentosDoAcervo().map((d) => d.slug)],
    [[], ['cenarios']]
)

/**
 * **O teto do prompt deixou de ser um número só, e isso é deliberado.**
 *
 * Documento de prompt viaja inteiro em toda resposta, então o teto dele é o
 * limite do que a conta pode nos custar por mensagem. Os cinco de comportamento
 * cabem em 10.000 — é instrução, não acervo, e instrução que não cabe em 10.000
 * não está instruindo.
 *
 * `servicos` e `faq` são outra coisa: catálogo e léxico crescem com o cliente, e
 * o teto deles tinha de caber no que as contas **já escreveram** antes da troca
 * de modo — 14.712 e 8.843 no maior caso medido. Um teto de 10.000 não seria
 * economia: seria a tela recusando salvar o que já estava salvo.
 */
conferir(
    'os cinco de comportamento cabem em 10.000',
    documentosDoPrompt()
        .filter((d) => d.slug !== 'servicos' && d.slug !== 'faq')
        .every((d) => d.teto === 10_000),
    true
)
conferir(
    'catálogo e léxico têm teto próprio, acima do maior em uso na troca de modo',
    [acharDocumento('servicos')!.teto, acharDocumento('faq')!.teto],
    [20_000, 15_000]
)
conferir(
    'e nenhum documento de prompt passa de 20.000',
    documentosDoPrompt().every((d) => d.teto <= 20_000),
    true
)

conferir(
    'precedências únicas — empate devolve a decisão ao acidente',
    new Set(DOCUMENTOS().map((d) => d.precedencia)).size,
    DOCUMENTOS().length
)

conferir(
    'Privacidade tem a maior precedência de todas',
    Math.min(...DOCUMENTOS().map((d) => d.precedencia)),
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

console.log('\nO orçamento do prompt — informa, e quem limita é o teto de cada documento')

const orc = (chars: Record<string, number>) =>
    orcamentoDoPrompt(
        Object.fromEntries(Object.entries(chars).map(([k, n]) => [k, 'x'.repeat(n)]))
    )

conferir(
    'soma só os documentos de modo prompt — cenarios é servico e fica fora',
    orc({ 'instrucoes-centrais': 100, privacidade: 50, cenarios: 99999 }).usado,
    150
)
conferir(
    'e servicos agora SOMA, porque virou prompt',
    orc({ 'instrucoes-centrais': 100, servicos: 400 }).usado,
    500
)
conferir(
    'estima tokens a ~3,5 caracteres por token',
    orc({ 'instrucoes-centrais': 3500 }).tokens,
    1000
)

/**
 * As faixas são calibradas contra o máximo **possível**, não contra um número
 * abstrato: **cinco** documentos de prompt a 10.000 cada dão 50.000, e nada pode
 * passar disso porque o teto de cada documento é que barra. Um corte acima de
 * 50.000 seria faixa que nunca acende — foi o que aconteceu com `excessivo`.
 *
 * Estes casos travam a recalibração: com os cortes antigos (15.000/25.000,
 * desenhados quando eram três documentos) o conjunto real do cliente, que
 * cresceu para 17.952 por decisão nossa de mover dois documentos para o prompt,
 * passaria a ser chamado de "pesado" sem ninguém ter escrito uma linha a mais.
 */
conferir(
    'o conjunto real medido (17.952, cinco documentos) é confortável',
    orc({
        'instrucoes-centrais': 3170,
        'processo-comercial': 6429,
        privacidade: 2191,
        empresa: 2574,
        'tecnicas-de-venda': 3588,
    }).faixa,
    'confortavel'
)
conferir(
    'o conjunto antigo de três documentos segue confortável',
    orc({ 'instrucoes-centrais': 3170, 'processo-comercial': 6429, privacidade: 2191 }).faixa,
    'confortavel'
)
conferir(
    'três documentos cheios é pesado',
    orc({
        'instrucoes-centrais': 10_000,
        'processo-comercial': 10_000,
        privacidade: 10_000,
    }).faixa,
    'pesado'
)
conferir(
    'os cinco documentos cheios são muito pesados — e mesmo assim passam',
    orc({
        'instrucoes-centrais': 10_000,
        'processo-comercial': 10_000,
        privacidade: 10_000,
        empresa: 10_000,
        'tecnicas-de-venda': 10_000,
    }).faixa,
    'muito-pesado'
)
/**
 * **O máximo possível subiu de 50.000 para 85.000** com a troca de modo: cinco
 * documentos a 10.000, mais `servicos` a 20.000 e `faq` a 15.000.
 *
 * As faixas **não** foram recalibradas junto, e é decisão: elas medem o que a
 * conta custa por mensagem, e esse custo não mudou de natureza por o teto ter
 * subido. O efeito é que `muito-pesado` passa a ser alcançável por conteúdo
 * legítimo — uma conta com catálogo grande **de verdade** gasta muito contexto,
 * e a tela tem de dizer isso em vez de esconder.
 */
conferir(
    'o máximo possível é 85.000 — cinco a 10.000, servicos a 20.000, faq a 15.000',
    documentosDoPrompt().reduce((soma, d) => soma + d.teto, 0),
    85_000
)

// O teto por documento é o único limite rígido, e ele vive no catálogo.
conferir(
    'o que vai no prompt cabe em 20.000; o que fica no acervo, em 50.000',
    [
        documentosDoPrompt().every((d) => d.teto <= 20_000),
        documentosDoAcervo().every((d) => d.teto === 50_000),
    ],
    [true, true]
)

conferir('documento vazio não gasta orçamento', orc({}).usado, 0)

console.log('\nA seção reservada')

conferir(
    'todos os sete oferecem a seção de exemplos',
    DOCUMENTOS().every((d) => d.secoes.includes(SECAO_EXEMPLOS)),
    true
)
conferir(
    'e ela é sempre a última, para não se misturar aos fatos',
    DOCUMENTOS().every((d) => d.secoes.at(-1) === SECAO_EXEMPLOS),
    true
)

console.log('\nO modelo que o botão escreve')

const docDoModelo = acharDocumento('servicos')!
const modelo = modeloDoDocumento(docDoModelo)

// Derivado do catálogo, e não escrito à mão: o título na tela muda (este já
// mudou de "Serviços prestados" para "Serviços e Produtos" em 2026-11-05), e o
// que o teste tem a dizer é que o modelo abre pelo título — não qual ele é.
conferir('começa pelo título do documento', modelo.startsWith(`# ${docDoModelo.titulo}\n`), true)
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

console.log('\nOs modelos fornecidos — cabeçalhos têm de casar com o catálogo')

conferir(
    'nenhum modelo escrito divergiu das seções do catálogo',
    Object.entries(MODELOS())
        .map(([slug, texto]) => {
            const doc = acharDocumento(slug)
            if (!doc) return `${slug}: slug não existe no catálogo`
            const cabecalhos = (texto.match(/^## (.+)$/gm) ?? []).map((l) => l.replace('## ', '').trim())
            const faltam = doc.secoes.filter((s) => !cabecalhos.includes(s))
            const sobram = cabecalhos.filter((c) => !doc.secoes.includes(c))
            return faltam.length || sobram.length
                ? `${slug}: faltam [${faltam}] sobram [${sobram}]`
                : null
        })
        .filter(Boolean),
    []
)

conferir(
    'e todo modelo escrito abre com o título do catálogo',
    Object.entries(MODELOS())
        .filter(([slug, texto]) => !texto.startsWith(`# ${acharDocumento(slug)?.titulo}`))
        .map(([slug]) => slug),
    []
)

console.log('\nConferência de estrutura — sem exigir NOME de seção')

const doc = acharDocumento('servicos')!

conferir(
    'modelo recém-inserido: zero trechos, porque cabeçalho sem corpo não conta',
    conferirEstrutura(secionarMarkdown(semComentarios(modelo))).trechos,
    0
)

/**
 * **O invariante dos modelos, e ele substitui uma proibição que envelheceu.**
 *
 * Aqui havia `modelo.includes('<!--') === false`, com o motivo "comentário é
 * corpo, e seria indexado". O motivo deixou de ser verdade: `semComentarios` é
 * aplicado na montagem do prompt, na indexação do acervo e na leitura do
 * catálogo de Cenários — as provas estão neste mesmo arquivo, logo abaixo.
 * A proibição sobreviveu ao motivo, e era o único obstáculo ao desenho dos
 * modelos: exemplo de forma dentro de comentário, junto da seção que ilustra.
 *
 * O que vale conferir é o oposto, e é mais forte: **modelo inserido não produz
 * conteúdo nenhum**. Todo o texto do modelo é comentário, então depois de
 * `semComentarios` sobra título + cabeçalhos sem corpo. Isso significa zero
 * trecho no acervo e zero token no prompt — o cliente insere, lê a orientação
 * enquanto escreve, e nada do nosso texto chega ao modelo de linguagem.
 *
 * Se alguém escrever um modelo com orientação no corpo, isto reprova. É o que
 * impede "Escreva aqui um subtítulo por serviço" de ser vetorizado e devolvido
 * ao agente sob "use os trechos como fonte de verdade".
 */
conferir(
    'nenhum modelo produz corpo: depois de semComentarios sobram só cabeçalhos',
    Object.entries(MODELOS())
        .map(([slug, texto]) => {
            const comConteudo = secionarMarkdown(semComentarios(texto)).filter(
                (sec) => sec.corpo.trim() !== ''
            )
            return comConteudo.length > 0
                ? `${slug}: ${comConteudo.length} seção(ões) com corpo — ${comConteudo
                      .map((sec) => sec.caminho.at(-1))
                      .join(', ')}`
                : null
        })
        .filter(Boolean),
    []
)

/**
 * E a outra metade: o modelo **tem** de trazer orientação, senão é só esqueleto.
 *
 * Sem esta prova, "nenhum corpo" seria satisfeito por um modelo vazio — que é
 * exatamente o que `modeloDoDocumento` já devolve sozinho quando não há modelo
 * escrito. O modelo existe para ensinar a escrever; se não tem comentário, não
 * ensina nada e não deveria estar aqui.
 */
conferir(
    'todo modelo escrito traz orientação em comentário, uma por seção',
    Object.entries(MODELOS())
        .map(([slug, texto]) => {
            const doc = acharDocumento(slug)!
            const comentarios = (texto.match(/<!--/g) ?? []).length
            // Um por seção, mais o aviso de abertura.
            return comentarios < doc.secoes.length + 1
                ? `${slug}: ${comentarios} comentário(s) para ${doc.secoes.length} seção(ões)`
                : null
        })
        .filter(Boolean),
    []
)

const preenchido = `# Serviços prestados

## Regra geral

Nunca prometer prazo sem avaliação.

## Serviços

### Ortodontia

A partir de R$ 180 por mês.

## Diferenciais

Atendimento no mesmo dia.
`

conferir(
    'documento bem seccionado: conta os trechos e não reclama',
    conferirEstrutura(secionarMarkdown(preenchido)),
    { trechos: 3, semSecoes: false, grandesDemais: [] }
)

conferir(
    'SEÇÃO COM NOME QUE O CATÁLOGO NÃO PREVÊ passa limpo — era o defeito',
    conferirEstrutura(
        secionarMarkdown('# X\n\n## Prótese overdenture\n\nTexto.\n\n## Dói?\n\nNão.')
    ),
    { trechos: 2, semSecoes: false, grandesDemais: [] }
)

conferir(
    'texto sem nenhum subtítulo é apontado',
    conferirEstrutura(secionarMarkdown('Um muro de prosa, sem cabeçalho nenhum.')).semSecoes,
    true
)

conferir(
    'documento vazio NÃO é "sem seções" — é vazio, e o contador já diz',
    conferirEstrutura(secionarMarkdown('   \n\n  ')).semSecoes,
    false
)

conferir(
    'seção maior que um trecho é apontada pelo nome',
    conferirEstrutura(
        secionarMarkdown(`# X\n\n## Tabela de preços\n\n${'y'.repeat(TAMANHO_DE_TRECHO + 1)}`)
    ).grandesDemais,
    ['Tabela de preços']
)

conferir(
    'e o teto de trecho aqui bate com o do cortador',
    TAMANHO_DE_TRECHO,
    TAMANHO_MAX
)

console.log('\nO título dos trechos é o slug — e isso é deliberado')

conferir('tituloDoAcervo devolve o slug, não o título humano', tituloDoAcervo('servicos'), 'servicos')
conferir(
    'o slug NUNCA é o título da tela — se fosse, um rename orfanaria o acervo',
    DOCUMENTOS().every((d) => tituloDoAcervo(d.slug) !== d.titulo),
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

/**
 * **`cenarios`, e não `servicos`.**
 *
 * Era `servicos` até ele virar modo prompt: o exemplo de "documento de acervo"
 * tem de ser um documento que **é** acervo, senão todos os casos abaixo medem o
 * caminho do prompt enquanto dizem medir o do acervo.
 */
const docRag = acharDocumento('cenarios')!
const docPrompt = acharDocumento('instrucoes-centrais')!

conferir(
    'documento de modo prompt nunca é indexado — é o modo dele, não pendência',
    await decidirIndexacao({ doc: docPrompt, content: '# Instruções\n\nSeja breve.', hashGravado: null }),
    { acao: 'pular', motivo: 'modo-prompt' }
)

/**
 * O caso que faltava, e que apareceu ao mudar `empresa` e `tecnicas-de-venda`
 * de modo com 7 e 13 trechos já indexados: o modo novo diz "não indexe", e os
 * trechos antigos ficavam. O mesmo texto chegaria ao modelo duas vezes — inteiro
 * no prompt e em pedaços pelo acervo — e os pedaços ainda tomariam vaga de
 * recuperação de outro documento.
 */
conferir(
    'modo prompt COM trechos gravados manda apagar — a troca de modo não fica pela metade',
    await decidirIndexacao({
        doc: docPrompt,
        content: '# Instruções\n\nSeja breve.',
        hashGravado: 'hash-de-quando-ele-era-acervo',
    }),
    { acao: 'apagar' }
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

/**
 * **"Vazio" é vazio para o ACERVO, e isto é a invariante que duas rotas usam.**
 *
 * Documento reduzido a comentários tem texto cru. Até 2026-10-31 a rota de
 * publicação decidia por `texto.trim()`, então ele passava por "não vazio", era
 * enfileirado, e o processador descobria lá que não havia o que indexar — logava
 * um aviso e **saía sem apagar**. Os trechos da geração anterior sobreviviam, o
 * carimbo seguia dizendo "34 trechos", e o agente continuava respondendo pelo
 * texto que o cliente acabou de remover.
 *
 * As duas pontas agora decidem por `textoParaAcervo`, e é esta prova que diz o
 * que elas vão ver.
 */
conferir(
    'documento reduzido a COMENTÁRIOS é vazio para o acervo',
    textoParaAcervo('<!-- exemplo: a avaliação é gratuita -->\n<!-- outra nota -->').texto,
    ''
)

conferir(
    'e com acervo gravado, ele manda APAGAR — não "pular"',
    await decidirIndexacao({
        doc: docRag,
        content: '<!-- exemplo: Ortodontia a partir de R$ 180 -->',
        hashGravado: hashDele,
    }),
    { acao: 'apagar' }
)

/**
 * **Título e cabeçalho sobrevivem, e isso é bom saber antes de embarcar modelo.**
 *
 * `semComentarios` tira o comentário e deixa o `#` e os `##`. Então um modelo
 * que é título + cabeçalhos + exemplos em comentário **não** é vazio para o
 * acervo: ele é enfileirado, o corte descarta cabeçalho sem corpo, e o
 * documento acaba com zero trecho — depois de a reindexação ter apagado a
 * geração anterior. É o desfecho correto, e é o que o passo 7 vai produzir.
 *
 * A prova existe para que ninguém "conserte" `textoParaAcervo` para também
 * descartar cabeçalho: isso jogaria o modelo inserido na trilha de apagar, e aí
 * inserir um modelo apagaria o acervo de quem já tinha texto.
 */
conferir(
    'título e cabeçalhos sobrevivem: modelo com exemplos em comentário NÃO é vazio',
    textoParaAcervo('# Serviços prestados\n\n## Ortodontia\n\n<!-- exemplo: a partir de R$ 180 -->').texto,
    '# Serviços prestados\n\n## Ortodontia'
)

conferir(
    'documento com SÓ a seção reservada de exemplos também é vazio para o acervo',
    textoParaAcervo(`## ${SECAO_EXEMPLOS}\n\nA avaliação é gratuita.`).texto,
    ''
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

/**
 * A seção reservada de exemplos **não vai para o acervo** — e os dois lados
 * normalizam igual.
 *
 * O catálogo declara `SECAO_EXEMPLOS` como reservada desde que nasceu, com a
 * razão escrita (exemplo indexado como fato é repetido literalmente pelo modelo,
 * inclusive o exemplo da pergunta vizinha). Faltava o runtime fazer a separação.
 *
 * Os casos abaixo travam as duas metades: que a seção sai, e que a rota e o
 * processador chegam ao **mesmo** texto — senão `pular: inalterado` volta a
 * mentir e cada salvar enfileira um job inútil.
 */
console.log('\nA seção reservada de exemplos fica fora do acervo')

const comExemplos = [
    '# Serviços prestados',
    '',
    '## Ortodontia',
    'A partir de R$ 180 por mês.',
    '',
    '## Exemplos de resposta',
    'Oi! O aparelho sai a partir de R$ 180 por mês.',
    '',
    '### No WhatsApp',
    'Manda um oi que a gente explica.',
    '',
    '## Implante',
    'Avaliação gratuita.',
].join('\n')

conferir(
    'o fato fica e o exemplo sai',
    semExemplos(comExemplos).fatos,
    '# Serviços prestados\n\n## Ortodontia\nA partir de R$ 180 por mês.\n\n## Implante\nAvaliação gratuita.'
)
conferir('e diz qual seção retirou', semExemplos(comExemplos).retiradas, ['Exemplos de resposta'])
conferir(
    'o subtítulo dentro dos exemplos sai junto — senão volta pela porta de trás',
    semExemplos(comExemplos).fatos.includes('Manda um oi'),
    false
)
conferir(
    'documento sem exemplos atravessa intacto',
    semExemplos('## Ortodontia\nR$ 180.').fatos,
    '## Ortodontia\nR$ 180.'
)
conferir(
    'cabeçalho dentro de cerca de código não abre seção de exemplos',
    semExemplos(['## Ortodontia', '```', '## Exemplos de resposta', '```', 'R$ 180.'].join('\n')).retiradas,
    []
)
conferir(
    'título escrito à mão conta: plural, caixa e acento',
    [
        ehSecaoDeExemplos('Exemplos de respostas'),
        ehSecaoDeExemplos('exemplos de resposta'),
        ehSecaoDeExemplos('Exemplos de resposta (WhatsApp)'),
        ehSecaoDeExemplos('Serviços'),
    ],
    [true, true, true, false]
)
conferir(
    'o título do catálogo é reconhecido pela própria função',
    ehSecaoDeExemplos(SECAO_EXEMPLOS),
    true
)

/**
 * **Os títulos reais, e o motivo de a comparação por prefixo ter caído.**
 *
 * Estes seis saíram dos dois conjuntos de documentos de cliente lidos em
 * 2026-10-31. Com a regra antiga (prefixo contra `"exemplos de resposta"`),
 * **só o primeiro** era reconhecido: os outros têm o singular, ou "ou sugestão"
 * no meio, ou um enumerador na frente. Os dois marcados `faq`/`servicos` são de
 * documento de **acervo** — iriam vetorizados como fonte de verdade, que é o
 * defeito que este módulo existe para evitar.
 */
conferir(
    'os títulos reais de cliente são reconhecidos',
    [
        ehSecaoDeExemplos('Exemplos de resposta'),
        ehSecaoDeExemplos('Exemplo de resposta'),
        ehSecaoDeExemplos('Exemplos ou sugestões de resposta'), // servicos
        ehSecaoDeExemplos('Exemplo ou sugestão de resposta — convênio'), // faq
        ehSecaoDeExemplos('Exemplos ou sugestões de resposta — agenda'),
        ehSecaoDeExemplos('8. Exemplo de resposta'),
    ],
    [true, true, true, true, true, true]
)

/**
 * O outro lado da regra, e é por isso que `exemplo` sozinho não basta.
 *
 * Seção de fato retirada do acervo cala o agente sobre o que a conta escreveu, e
 * cala em silêncio. Exigir a palavra `resposta` é o que separa "exemplo de como
 * responder" de "exemplos de coisas que existem".
 */
conferir(
    'seção de fato que começa com "Exemplos" continua indexada',
    [
        ehSecaoDeExemplos('Exemplos de cursos oferecidos'),
        ehSecaoDeExemplos('Exemplos de documentos aceitos'),
        ehSecaoDeExemplos('Respostas rápidas'),
        ehSecaoDeExemplos('Perguntas e respostas'),
    ],
    [false, false, false, false]
)

/**
 * O limite declarado: sem a palavra `resposta`, não reconhece.
 *
 * `Exemplo completo` e `Exemplo de abertura` existem em conjunto real de
 * cliente, e hoje não chegam aqui — estão em documento de modo `prompt`. O teste
 * guarda o comportamento para que a escolha fique visível: o conserto é o modelo
 * ensinar o nome declarado, não esta função virar lista de sinônimos.
 */
conferir(
    'exemplo sem a palavra resposta NÃO é reconhecido, e é decisão',
    [ehSecaoDeExemplos('8. Exemplo completo'), ehSecaoDeExemplos('Exemplo de abertura')],
    [false, false]
)

/**
 * A prova de ponta a ponta: o documento de acervo como o cliente escreveu.
 *
 * Com a regra antiga este `fatos` saía com o diálogo inteiro dentro, pronto para
 * ser vetorizado e repetido literalmente pelo agente.
 */
{
    const comoOClienteEscreveu = [
        '# Serviços prestados',
        '',
        '## Implante dentário',
        'Reposição de dente perdido com pino de titânio.',
        '',
        '## Exemplos ou sugestões de resposta',
        '',
        '"Posso te explicar como funciona o implante?"',
    ].join('\n')

    const { fatos, retiradas } = semExemplos(comoOClienteEscreveu)
    conferir('o exemplo do cliente sai do acervo', retiradas, [
        'Exemplos ou sugestões de resposta',
    ])
    conferir('e o fato do cliente fica', fatos.includes('pino de titânio'), true)
    conferir('e a fala sugerida não vai ao acervo', fatos.includes('Posso te explicar'), false)
}

/**
 * `textoParaAcervo` é a normalização única. Antes a rota hasheava o conteúdo cru
 * e o processador hasheava sem comentário de HTML: documento com um
 * `<!-- confirmar -->` nunca batia, e **todo salvar** enfileirava um job para o
 * processador descobrir no fim que nada mudara.
 */
conferir(
    'tira comentário de HTML e exemplos, na mesma passada',
    textoParaAcervo('## Preço\nR$ 180. <!-- confirmar -->\n\n## Exemplos de resposta\nOi!').texto,
    '## Preço\nR$ 180.'
)
conferir(
    'documento que é só exemplo não tem fato nenhum a indexar',
    await decidirIndexacao({
        doc: docRag,
        content: '## Exemplos de resposta\nOi, tudo bem?',
        hashGravado: null,
    }),
    { acao: 'pular', motivo: 'sem-conteudo' }
)
conferir(
    'mexer só no exemplo não reindexa — o acervo não mudou',
    await decidirIndexacao({
        doc: docRag,
        content: `${conteudo}\n\n## Exemplos de resposta\nOutra redação do exemplo.`,
        hashGravado: hashDele,
    }),
    { acao: 'pular', motivo: 'inalterado' }
)

console.log(`\n${passou} ok, ${falhou} falha(s)\n`)
process.exit(falhou > 0 ? 1 : 0)
