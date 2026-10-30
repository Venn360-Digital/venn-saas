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
    LIMITE_DO_ROTULO,
    documentosDoAcervo,
    documentosDoPrompt,
    modeloDoDocumento,
    SECAO_EXEMPLOS,
    orcamentoDoPrompt,
    TAMANHO_DE_TRECHO,
} from '@/lib/treinamento/documentos'
import { secionarMarkdown, semComentarios, TAMANHO_MAX } from '@/lib/rag/secoes'
import { MODELOS } from '@/lib/treinamento/modelos'
import { gerarRascunho, temRascunho } from '@/lib/treinamento/gerar'
import {
    decidirIndexacao,
    hashDoConteudo,
    slugConhecido,
    textoParaAcervo,
    tituloDoAcervo,
} from '@/lib/treinamento/indexar'
import { ehSecaoDeExemplos, semExemplos } from '@/lib/treinamento/exemplos'

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
conferir(
    'cinco no prompt, dois no acervo',
    [documentosDoPrompt().length, documentosDoAcervo().length],
    [5, 2]
)

conferir(
    'os do prompt são os de comportamento, na ordem de precedência',
    documentosDoPrompt().map((d) => d.slug),
    ['privacidade', 'instrucoes-centrais', 'processo-comercial', 'empresa', 'tecnicas-de-venda']
)

conferir(
    'os do acervo são os de fato consultável, que crescem com o cliente',
    documentosDoAcervo().map((d) => d.slug),
    ['servicos', 'faq']
)

// Documento de prompt viaja inteiro em toda resposta: o teto dele é o menor.
conferir(
    'quem foi para o prompt levou o teto do prompt',
    documentosDoPrompt().every((d) => d.teto === 10_000),
    true
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

console.log('\nO orçamento do prompt — informa, e quem limita é o teto de cada documento')

const orc = (chars: Record<string, number>) =>
    orcamentoDoPrompt(
        Object.fromEntries(Object.entries(chars).map(([k, n]) => [k, 'x'.repeat(n)]))
    )

conferir(
    'soma só os documentos de modo prompt',
    orc({ 'instrucoes-centrais': 100, privacidade: 50, servicos: 99999 }).usado,
    150
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
conferir(
    'o máximo possível é 50.000 — cinco documentos de prompt a 10.000',
    documentosDoPrompt().reduce((soma, d) => soma + d.teto, 0),
    50_000
)

// O teto por documento é o único limite rígido, e ele vive no catálogo.
conferir(
    'documento de prompt cabe em 10.000; o de acervo, em 50.000',
    [
        documentosDoPrompt().every((d) => d.teto === 10_000),
        documentosDoAcervo().every((d) => d.teto === 50_000),
    ],
    [true, true]
)

conferir('documento vazio não gasta orçamento', orc({}).usado, 0)

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

console.log('\nOs modelos fornecidos — cabeçalhos têm de casar com o catálogo')

conferir(
    'nenhum modelo escrito divergiu das seções do catálogo',
    Object.entries(MODELOS)
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
    Object.entries(MODELOS)
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

console.log('\nRascunho a partir dos campos antigos — para a transição não custar redigitação')

const antigos = {
    agentName: 'Ana',
    companyName: 'Clínica Teste',
    companySector: 'Clínica odontológica',
    companyAddress: 'Av. Afonso Pena, 1500',
    companyDescription: 'Atendemos ortodontia e implante.',
    jobDescription: 'Atender, qualificar e agendar avaliação.',
    agentFunction: 'sdr_atendimento',
    voiceTone: 'pratico',
    systemPrompt: 'Nunca prometa prazo sem avaliação presencial.',
}

const rascunhoCentrais = gerarRascunho('instrucoes-centrais', antigos)!

conferir('as centrais ganham rascunho', rascunhoCentrais !== null, true)
conferir('abre com o título do catálogo', rascunhoCentrais.startsWith('# Instruções centrais'), true)
conferir('o tom vira texto legível', rascunhoCentrais.includes('Prático e objetivo.'), true)
conferir(
    'a instrução livre vira "Limites técnicos" — era a lista de limites',
    rascunhoCentrais.includes('## Limites técnicos\n\nNunca prometa prazo'),
    true
)
conferir(
    'o aviso de rascunho vai em comentário, que NÃO chega ao modelo',
    semComentarios(rascunhoCentrais).includes('Rascunho gerado'),
    false
)
conferir(
    'e o rascunho sai bem seccionado, sem aviso de estrutura',
    conferirEstrutura(secionarMarkdown(semComentarios(rascunhoCentrais))),
    { trechos: 4, semSecoes: false, grandesDemais: [] }
)

conferir(
    'Empresa pega nome, setor, endereço e descrição',
    ['Clínica Teste', 'Av. Afonso Pena', 'ortodontia e implante'].every((s) =>
        gerarRascunho('empresa', antigos)!.includes(s)
    ),
    true
)

conferir(
    'Processo comercial pega as atribuições',
    gerarRascunho('processo-comercial', antigos)!.includes('qualificar e agendar'),
    true
)

conferir(
    'os quatro sem origem devolvem null, não um modelo disfarçado',
    ['servicos', 'tecnicas-de-venda', 'faq', 'privacidade'].map((s) =>
        gerarRascunho(s, antigos)
    ),
    [null, null, null, null]
)

conferir(
    'agente sem nada preenchido não gera rascunho nenhum',
    DOCUMENTOS.map((d) => gerarRascunho(d.slug, {})).filter(Boolean),
    []
)

conferir(
    'temRascunho concorda com gerarRascunho',
    DOCUMENTOS.every((d) => temRascunho(d.slug, antigos) === (gerarRascunho(d.slug, antigos) !== null)),
    true
)

console.log(`\n${passou} ok, ${falhou} falha(s)\n`)
process.exit(falhou > 0 ? 1 : 0)
