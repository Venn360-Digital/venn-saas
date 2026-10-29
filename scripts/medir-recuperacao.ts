/**
 * Mede se cada documento de treinamento **é encontrado** pela busca.
 *
 *   npm run medir:recuperacao -- <url-base> <agentId> <arquivo.json>
 *
 * Existe para decidir, com número, o que hoje está no chute: quais documentos
 * ficam sempre no prompt (`modo: 'prompt'`) e quais entram só quando a busca os
 * recupera (`modo: 'rag'`). Um documento que não aparece para as perguntas que
 * ele deveria responder **não pertence ao rag** — ou o texto dele precisa mudar,
 * e o número diz qual dos dois.
 *
 * Não gasta crédito do cliente e não chama modelo nenhum: a rota
 * `/api/agents/:id/recuperacao` só faz a busca. O custo é um embedding por
 * pergunta.
 *
 * ## O arquivo de perguntas
 *
 * JSON, uma lista de `{ pergunta, esperado? }`. `esperado` é o **slug** do
 * documento que deveria responder — é o que transforma "foi recuperado alguma
 * coisa" em "foi recuperado o certo". Sem ele, a pergunta ainda conta para o
 * levantamento, mas não para o acerto.
 *
 *     [
 *       { "pergunta": "vocês abrem sábado?", "esperado": "empresa" },
 *       { "pergunta": "quanto custa um clareamento?", "esperado": "servicos" }
 *     ]
 *
 * ## Autenticação
 *
 * `MEDIR_COOKIE` com um cookie de sessão, ou `MEDIR_EMAIL` + `MEDIR_SENHA` para
 * entrar pela API. A senha nunca é impressa.
 */
import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

interface Caso {
    pergunta: string
    esperado?: string
}

interface Trecho {
    titulo: string
    deTreinamento: boolean
    similaridade: number
    inicio: string
}

interface Resultado {
    pergunta: string
    consulta: string
    trechos: Trecho[]
}

const [base, agentId, arquivo] = process.argv.slice(2)

if (!base || !agentId || !arquivo) {
    console.error('uso: npm run medir:recuperacao -- <url-base> <agentId> <arquivo.json>')
    process.exit(2)
}

/**
 * Pergunta no terminal. `oculto` apaga o eco, para a senha não ficar na tela.
 *
 * Existe para que medir em produção **não exija senha na linha de comando**: ali
 * ela entraria no histórico do shell, ficaria no `ps` enquanto o processo roda, e
 * sobreviveria à sessão. Perguntar na hora custa um Enter e não deixa rastro.
 */
function perguntar(rotulo: string, oculto = false): Promise<string> {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    return new Promise((resolve) => {
        if (oculto) {
            const saida = process.stdout as NodeJS.WriteStream & { muted?: boolean }
            saida.muted = false
            const escrever = saida.write.bind(saida)
            // Substituição deliberada e temporária do write, desfeita no fim.
            saida.write = (chunk: string, ...resto: unknown[]) =>
                saida.muted ? true : escrever(chunk, ...(resto as []))
            rl.question(rotulo, (resposta) => {
                saida.muted = false
                saida.write = escrever
                process.stdout.write('\n')
                rl.close()
                resolve(resposta.trim())
            })
            saida.muted = true
        } else {
            rl.question(rotulo, (resposta) => {
                rl.close()
                resolve(resposta.trim())
            })
        }
    })
}

async function autenticar(): Promise<string> {
    const cookie = process.env.MEDIR_COOKIE
    if (cookie) return cookie

    // Perguntados na hora quando não vierem do ambiente — ver `perguntar`.
    const email = process.env.MEDIR_EMAIL || (await perguntar('e-mail: '))
    const senha = process.env.MEDIR_SENHA || (await perguntar('senha: ', true))
    if (!email || !senha) {
        console.error('sem credencial; informe e-mail e senha, ou MEDIR_COOKIE')
        process.exit(2)
    }

    const resposta = await fetch(`${base}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: senha }),
    })

    if (!resposta.ok) {
        console.error(`login recusado (${resposta.status})`)
        process.exit(1)
    }

    // `getSetCookie` preserva os cookies separados; `get('set-cookie')` os
    // junta numa string só e quebra quando há mais de um.
    const cookies = resposta.headers.getSetCookie?.() ?? []
    const sessao = cookies.map((c) => c.split(';')[0]).join('; ')
    if (!sessao) {
        console.error('login respondeu sem cookie de sessão')
        process.exit(1)
    }
    return sessao
}

/** O piso do atendimento. Abaixo disto o trecho nem chega ao agente. */
const PISO = 0.35
/** Acima do piso, mas por tão pouco que qualquer reescrita da pergunta derruba. */
const FOLGA_MINIMA = 0.10

function barra(valor: number): string {
    const n = Math.max(0, Math.min(20, Math.round((valor - PISO) / 0.03)))
    return '█'.repeat(n)
}

async function principal() {
    const casos: Caso[] = JSON.parse(readFileSync(arquivo, 'utf8'))
    const cookie = await autenticar()

    const resposta = await fetch(`${base}/api/agents/${agentId}/recuperacao`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ perguntas: casos.map((c) => c.pergunta) }),
    })

    const corpo = (await resposta.json()) as { resultados?: Resultado[]; error?: string }
    if (!resposta.ok || !corpo.resultados) {
        console.error(`medição recusada (${resposta.status}): ${corpo.error ?? ''}`)
        process.exit(1)
    }

    const porDocumento = new Map<string, { vezes: number; melhor: number; primeiro: number }>()
    let acertos = 0
    let comEsperado = 0
    let semNada = 0
    let raspando = 0

    console.log(`\n${corpo.resultados.length} pergunta(s) — piso de similaridade ${PISO}\n`)

    corpo.resultados.forEach((r, i) => {
        const caso = casos[i]
        const topo = r.trechos[0]

        for (const [posicao, t] of r.trechos.entries()) {
            const atual = porDocumento.get(t.titulo) ?? { vezes: 0, melhor: 0, primeiro: 0 }
            atual.vezes++
            atual.melhor = Math.max(atual.melhor, t.similaridade)
            if (posicao === 0) atual.primeiro++
            porDocumento.set(t.titulo, atual)
        }

        if (!topo) {
            semNada++
            console.log(`  ∅  ${r.pergunta}`)
            console.log(`     nada passou do piso\n`)
            return
        }

        const acertou = caso.esperado ? r.trechos.some((t) => t.titulo === caso.esperado) : null
        if (caso.esperado) {
            comEsperado++
            if (acertou) acertos++
        }

        const apertado = topo.similaridade - PISO < FOLGA_MINIMA
        if (apertado) raspando++

        const marca = acertou === null ? '·' : acertou ? 'ok' : 'XX'
        console.log(`  ${marca.padEnd(2)} ${r.pergunta}`)
        console.log(
            `     ${topo.similaridade.toFixed(3)} ${barra(topo.similaridade)} ${topo.titulo}` +
            (apertado ? '   ← raspando o piso' : '')
        )
        if (caso.esperado && !acertou) {
            console.log(`     esperado: ${caso.esperado} — não veio em ${r.trechos.length} trecho(s)`)
        }
        console.log()
    })

    console.log('Por documento — quantas perguntas o trouxeram, e em quantas ele foi o primeiro\n')
    const ordenado = [...porDocumento.entries()].sort((a, b) => b[1].vezes - a[1].vezes)
    for (const [titulo, d] of ordenado) {
        console.log(
            `  ${String(d.vezes).padStart(3)}×  primeiro em ${String(d.primeiro).padStart(3)}  ` +
            `melhor ${d.melhor.toFixed(3)}  ${titulo}`
        )
    }

    console.log('\nResumo')
    if (comEsperado > 0) {
        const taxa = ((acertos / comEsperado) * 100).toFixed(0)
        console.log(`  acerto: ${acertos}/${comEsperado} (${taxa}%) das perguntas com documento esperado`)
    }
    console.log(`  ${semNada} pergunta(s) não recuperaram nada`)
    console.log(`  ${raspando} pergunta(s) com o melhor trecho a menos de ${FOLGA_MINIMA} do piso`)
    console.log(
        '\nLeitura: documento que não aparece para as perguntas dele não pertence ao `rag` —\n' +
        'ou vai para o prompt, ou o texto precisa ser reescrito. O número diz qual dos dois.\n'
    )
}

principal().catch((erro) => {
    // Sem isto, falha de rede ou JSON malformado saía como rejeição não tratada:
    // uma pilha de stack onde devia haver uma frase.
    console.error(`
falhou: ${erro instanceof Error ? erro.message : erro}
`)
    process.exit(1)
})
