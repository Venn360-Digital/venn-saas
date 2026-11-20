/**
 * O que o modelo recebe quando a mensagem é arquivo, e não texto.
 *
 *   npm run test:midia
 *
 * O defeito que estes casos travam foi medido em produção: uma conta recebeu
 * `IOSNEI-.pdf` com uma lista de orçamento, e o agente "leu" a string
 * `📄 IOSNEI-.pdf`. O histórico tinha caso especial só para áudio, então todo
 * marcador inventado pelo decodificador seguia para o modelo como fala da
 * pessoa.
 *
 * Os dois casos mais perigosos estão aqui, e são opostos:
 *
 *   - **legenda de foto é fala da pessoa** e não pode ser trocada por aviso
 *     nosso;
 *   - **nome de arquivo não é conteúdo**, e deixá-lo passar como texto é o que
 *     faz o modelo inventar o que havia dentro.
 */
// PRIMEIRO de todos: registra uma marca fictícia, porque este script roda
// código do core e o core PEDE a marca. Ver `./lib/marca-de-teste.ts`.
import './lib/marca-de-teste.ts'

import {
    avisoDeArquivoNaoLido,
    ehImagemAnexavel,
    imagemServeParaOModelo,
    imagensParaAnexar,
    JANELA_DE_MIDIA,
    MAX_BYTES_DA_IMAGEM,
    MAX_IMAGENS_POR_RESPOSTA,
    mimeDaImagem,
    nomeDoArquivo,
    textoParaOModelo,
    type MensagemComMidia,
} from '@venn/core/lib/ai/midia-no-prompt'
import {
    AVISO_DE_CORTE,
    ehFormatoLegivel,
    MAX_CHARS_NO_PROMPT,
    normalizarExtraido,
    textoParaOTranscript,
} from '@venn/core/lib/documentos/extrair'

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

/** Uma mensagem de entrada, com o mínimo preenchido. */
const dela = (extra: Partial<MensagemComMidia> = {}): MensagemComMidia => ({
    direction: 'inbound',
    content: 'oi',
    isInternal: false,
    ...extra,
})

console.log('\nO texto que o modelo recebe')

conferir('texto comum passa inteiro', textoParaOModelo(dela({ content: 'quanto custa o 10mm?' })), 'quanto custa o 10mm?')

conferir(
    'nota de voz vale pela transcrição, com o rótulo',
    textoParaOModelo(dela({ contentType: 'audio', content: '🎵 Áudio', transcript: 'preciso de 10 barras' })),
    '[Nota de voz] preciso de 10 barras'
)

conferir(
    'áudio SEM transcrição não finge: o marcador fica',
    textoParaOModelo(dela({ contentType: 'audio', content: '🎵 Áudio' })),
    '🎵 Áudio'
)

conferir(
    'documento vira aviso de que o modelo NÃO lê arquivo — com o nome',
    textoParaOModelo(dela({ contentType: 'file', content: '📄 IOSNEI-.pdf' })),
    '[A pessoa enviou um arquivo: IOSNEI-.pdf. Você não consegue abrir nem ler arquivos — não suponha o conteúdo dele.]'
)

conferir(
    'e o aviso diz explicitamente para não supor o conteúdo',
    avisoDeArquivoNaoLido('lista.pdf').includes('não suponha o conteúdo'),
    true
)

/**
 * O caso que inverte o anterior: aqui há palavra da pessoa, e ela ganha de
 * qualquer aviso nosso. Trocar legenda por aviso perderia a única informação
 * que a mensagem trazia.
 */
conferir(
    'documento COM legenda vale pela legenda',
    textoParaOModelo(dela({ contentType: 'file', content: 'segue a lista do orçamento' })),
    'segue a lista do orçamento'
)

conferir(
    'documento com texto extraído vale pelo texto, sem rótulo de voz',
    textoParaOModelo(dela({ contentType: 'file', content: '📄 lista.pdf', transcript: 'Vergalhão 10mm — 30 barras' })),
    'Vergalhão 10mm — 30 barras'
)

conferir(
    'imagem anexada MANTÉM o marcador: o anexo vai ao lado e o texto não mente',
    textoParaOModelo(dela({ contentType: 'image', content: '📷 Imagem', mediaUrl: 'ref:clinico:a/b/c' })),
    '📷 Imagem'
)

conferir('nome do arquivo sai do marcador', nomeDoArquivo('📄 orçamento final.pdf'), 'orçamento final.pdf')

console.log('\nQuais imagens vão anexadas')

conferir(
    'imagem da pessoa, com arquivo, é anexável',
    ehImagemAnexavel(dela({ contentType: 'image', mediaUrl: 'ref:clinico:a' })),
    true
)
conferir(
    'imagem SEM arquivo não é — não há byte para ler',
    ehImagemAnexavel(dela({ contentType: 'image' })),
    false
)
conferir(
    'imagem que o AGENTE mandou não volta para ele',
    ehImagemAnexavel(dela({ direction: 'outbound', contentType: 'image', mediaUrl: 'ref:clinico:a' })),
    false
)
conferir(
    'nota interna da equipe nunca vai',
    ehImagemAnexavel(dela({ contentType: 'image', mediaUrl: 'ref:clinico:a', isInternal: true })),
    false
)

const foto = (n: string) => dela({ contentType: 'image', mediaUrl: `ref:clinico:${n}` })
const texto = (t: string) => dela({ content: t })

conferir('conversa sem foto não toca o storage', imagensParaAnexar([texto('oi'), texto('tudo bem?')]), [])

conferir(
    'o teto fica com as MAIS RECENTES, e a ordem devolvida é cronológica',
    imagensParaAnexar([foto('1'), foto('2'), foto('3')]),
    [1, 2]
)

conferir(
    'foto fora da janela não entra, mesmo sem ter batido o teto',
    imagensParaAnexar([foto('antiga'), texto('a'), texto('b'), texto('c'), texto('d'), texto('e'), texto('f')]),
    []
)

conferir(
    'foto na borda da janela entra',
    imagensParaAnexar([texto('x'), foto('na borda'), texto('a'), texto('b'), texto('c'), texto('d'), texto('e')]),
    [1]
)

conferir('teto zero desliga o anexo', imagensParaAnexar([foto('1')], 0), [])
conferir('os dois tetos são os do catálogo', [MAX_IMAGENS_POR_RESPOSTA, JANELA_DE_MIDIA], [2, 6])

console.log('\nO tipo da imagem vem dos bytes, não do nome')

const comCabecalho = (bytes: number[]) => new Uint8Array([...bytes, ...new Array(16).fill(0)])

conferir('JPEG', mimeDaImagem(comCabecalho([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg')
conferir('PNG', mimeDaImagem(comCabecalho([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'image/png')
conferir('GIF', mimeDaImagem(comCabecalho([0x47, 0x49, 0x46, 0x38])), 'image/gif')
conferir(
    'WEBP exige RIFF **e** WEBP, nas duas posições',
    mimeDaImagem(new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50])),
    'image/webp'
)
conferir(
    'RIFF que não é WEBP (um .wav) NÃO passa como imagem',
    mimeDaImagem(new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45])),
    null
)
conferir('PDF não é imagem', mimeDaImagem(comCabecalho([0x25, 0x50, 0x44, 0x46])), null)
conferir('bytes insuficientes não viram palpite', mimeDaImagem(new Uint8Array([0xff, 0xd8])), null)

/**
 * O teto de tamanho é guarda nossa, não limite de produto: `data:` cresce um
 * terço na conversão para base64, e a requisição inteira ainda tem de caber.
 */
conferir(
    'imagem acima do teto é recusada mesmo sendo JPEG válido',
    imagemServeParaOModelo(new Uint8Array(MAX_BYTES_DA_IMAGEM + 1).fill(0xff)),
    null
)
conferir(
    'no teto, passa',
    imagemServeParaOModelo(
        (() => {
            const b = new Uint8Array(MAX_BYTES_DA_IMAGEM)
            b[0] = 0xff
            b[1] = 0xd8
            b[2] = 0xff
            return b
        })()
    ),
    'image/jpeg'
)

console.log('\nO texto do documento que vai para o transcript')

conferir('PDF é legível', ehFormatoLegivel('IOSNEI-.pdf'), true)
conferir('maiúsculas não importam', ehFormatoLegivel('LISTA.PDF'), true)
conferir('docx, txt, md e csv também', [
    ehFormatoLegivel('a.docx'),
    ehFormatoLegivel('b.txt'),
    ehFormatoLegivel('c.md'),
    ehFormatoLegivel('d.csv'),
], [true, true, true, true])
conferir('.doc antigo NÃO é', ehFormatoLegivel('antigo.doc'), false)
// Planilha entrou em 20/11/2026, com leitor próprio (`lib/documentos/xlsx.ts`,
// provado em `test:xlsx`). O `.xls` antigo é binário e continua fora, como o `.doc`.
conferir('planilha .xlsx É legível, desde o leitor próprio', ehFormatoLegivel('precos.xlsx'), true)
conferir('.xls antigo NÃO é', ehFormatoLegivel('precos.xls'), false)
conferir(
    'imagem não é: ela tem caminho melhor, que é ir anexada ao modelo',
    ehFormatoLegivel('foto.jpg'),
    false
)

conferir('espaço antes de quebra é ruído de extração', normalizarExtraido('linha   \noutra'), 'linha\noutra')

const curto = 'Vergalhão 10mm — 30 barras'
conferir('texto curto passa inteiro, sem aviso', textoParaOTranscript(curto), curto)

const longo = 'x'.repeat(MAX_CHARS_NO_PROMPT + 500)
const cortado = textoParaOTranscript(longo)
conferir('acima do teto é cortado', cortado.length, MAX_CHARS_NO_PROMPT + AVISO_DE_CORTE.length)
conferir(
    'e leva o aviso — sem ele o modelo trata o pedaço como o documento inteiro',
    cortado.endsWith(AVISO_DE_CORTE),
    true
)
conferir(
    'o teto do prompt é muito menor que o do Cérebro: transcript viaja inteiro',
    MAX_CHARS_NO_PROMPT < 200_000,
    true
)
conferir('exatamente no teto não corta nem avisa', textoParaOTranscript('y'.repeat(MAX_CHARS_NO_PROMPT)).length, MAX_CHARS_NO_PROMPT)

/**
 * O encaixe das duas metades: com o texto extraído gravado em `transcript`, o
 * que o modelo recebe deixa de ser o nome do arquivo — e é `textoParaOModelo`,
 * que já existia para o áudio, que faz isso sem mudança nenhuma.
 */
conferir(
    'documento extraído chega ao modelo como o conteúdo dele, não como nome de arquivo',
    textoParaOModelo(dela({ contentType: 'file', content: '📄 IOSNEI-.pdf', transcript: 'Vergalhão 10mm: 30 barras' })),
    'Vergalhão 10mm: 30 barras'
)

console.log(`\n${passou} ok, ${falhou} falha(s)\n`)
process.exit(falhou > 0 ? 1 : 0)
