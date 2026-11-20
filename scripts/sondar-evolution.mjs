/**
 * Sonda /message/delete e /message/edit no Evolution Go de produção.
 *
 *   CF_ACCESS_CLIENT_ID=... CF_ACCESS_CLIENT_SECRET=... node sondar-evolution.mjs
 *
 * Responde UMA pergunta: por que apagar e editar penduram 20 s em vez de
 * responder. Três desfechos possíveis, e cada um aponta para um conserto
 * diferente:
 *
 *   404            → a rota NÃO está na nossa imagem (recompilar, acrescentar)
 *   400 com motivo → a rota existe e o handler roda (o problema é o nosso corpo)
 *   pendura        → o handler bloqueia (whatsmeow esperando o servidor)
 *
 * ## Não escreve nada
 *
 * A etapa A manda o corpo INCOMPLETO de propósito — sem `messageId` para o
 * delete, sem `message` para o edit. O handler recusa com 400 na validação dele,
 * ANTES de chamar o whatsmeow. Isso prova que a rota existe e que o handler
 * executa, sem apagar nem editar mensagem de ninguém.
 *
 * A etapa B (opcional, --completo) manda o corpo completo com um id inventado.
 * É ela que distingue "o handler roda" de "o whatsmeow pendura" — e é segura
 * porque um id de 22 hex inventado não corresponde a mensagem nenhuma.
 *
 * O token da instância sai do banco, pelo DATABASE_URL do .env: nenhum segredo
 * passa por linha de comando nem aparece na tela.
 */
import { readFileSync } from 'node:fs'
import pg from 'pg'

const BASE = 'https://evo-odontobox.venn360.com'
const COMPLETO = process.argv.includes('--completo')

const id = process.env.CF_ACCESS_CLIENT_ID
const segredo = process.env.CF_ACCESS_CLIENT_SECRET
if (!id || !segredo) {
    console.error('Faltam CF_ACCESS_CLIENT_ID e CF_ACCESS_CLIENT_SECRET no ambiente.')
    process.exit(2)
}

/**
 * De onde vem a linha a sondar — e por que há dois caminhos.
 *
 * **`EVO_TOKEN` + `EVO_NUMERO` no ambiente** é o caminho principal, porque o
 * `.env` desta máquina aponta para `odontobox/stg` e os testes acontecem em
 * PRODUÇÃO: o banco de stg não tem integração nenhuma, e a primeira versão
 * deste script saiu com "nenhuma linha QR conectada" olhando o lugar errado.
 *
 * O caminho do banco fica como queda, e agora ele DIZ qual banco olhou — era a
 * informação que faltava para o erro ser diagnosticável.
 */
let rows = []

if (process.env.EVO_TOKEN && process.env.EVO_NUMERO) {
    rows = [
        {
            token: process.env.EVO_TOKEN,
            phoneNumber: process.env.EVO_NUMERO,
            conta: process.env.EVO_CONTA ?? '(do ambiente)',
        },
    ]
} else {
    const env = readFileSync(new URL('../.env', import.meta.url), 'utf8')
    const url =
        process.env.DATABASE_URL ||
        env.split('\n').find((l) => l.startsWith('DATABASE_URL='))?.slice('DATABASE_URL='.length).trim()
    if (!url) {
        console.error('Sem EVO_TOKEN/EVO_NUMERO e sem DATABASE_URL.')
        process.exit(2)
    }

    const cliente = new pg.Client({ connectionString: url })
    await cliente.connect()
    const ident = await cliente
        .query('SELECT slug, environment FROM app_identity')
        .catch(() => ({ rows: [] }))
    const r = await cliente.query(`
        SELECT ai.config->>'token' AS token, ai."phoneNumber", w.name AS conta
          FROM agent_integrations ai
          JOIN agents a ON a.id = ai."agentId"
          JOIN workspaces w ON w.id = a."workspaceId"
         WHERE ai.channel = 'whatsapp_qr' AND ai.status = 'connected'
         ORDER BY w.name`)
    await cliente.end()
    rows = r.rows

    const onde = ident.rows[0] ? `${ident.rows[0].slug}/${ident.rows[0].environment}` : 'desconhecido'
    console.log(`banco: ${onde}`)
    if (rows.length === 0) {
        console.error(
            `Nenhuma linha QR conectada em ${onde}.\n` +
            'Os testes são em PRODUÇÃO: passe EVO_TOKEN e EVO_NUMERO no ambiente.'
        )
        process.exit(1)
    }
}

const cabecalhos = (token) => ({
    'Content-Type': 'application/json',
    apikey: token,
    'CF-Access-Client-Id': id,
    'CF-Access-Client-Secret': segredo,
})

async function sondar(rotulo, caminho, token, corpo) {
    const t0 = Date.now()
    const ctl = new AbortController()
    const prazo = setTimeout(() => ctl.abort(), 25_000)
    try {
        const r = await fetch(`${BASE}${caminho}`, {
            method: 'POST',
            headers: cabecalhos(token),
            body: JSON.stringify(corpo),
            signal: ctl.signal,
        })
        const texto = (await r.text()).slice(0, 220)
        console.log(`  ${String(r.status).padEnd(4)} ${String(Date.now() - t0).padStart(6)}ms  ${rotulo}\n        ${texto}`)
    } catch (e) {
        console.log(`  ABORT ${String(Date.now() - t0).padStart(5)}ms  ${rotulo}  ← PENDUROU (${e.name})`)
    } finally {
        clearTimeout(prazo)
    }
}

for (const linha of rows) {
    console.log(`\n=== conta ${linha.conta} · linha ${linha.phoneNumber} ===`)
    const t = linha.token
    const numero = linha.phoneNumber

    console.log('\n-- calibração --')
    await sondar('/server/ok (existe)', '/server/ok', t, {})
    await sondar('/message/xyzzy-nao-existe (404 esperado)', '/message/xyzzy-nao-existe', t, {})

    console.log('\n-- etapa A: corpo incompleto, NÃO escreve nada --')
    await sondar('/message/delete sem messageId', '/message/delete', t, { chat: numero })
    await sondar('/message/edit sem message', '/message/edit', t, { chat: numero, messageId: 'X' })

    if (COMPLETO) {
        console.log('\n-- etapa B: corpo completo, id inventado --')
        const falso = '3EB0FFFFFFFFFFFFFFFFFF'
        await sondar('/message/delete completo', '/message/delete', t, { chat: numero, messageId: falso })
        await sondar('/message/delete com JID', '/message/delete', t, { chat: `${numero}@s.whatsapp.net`, messageId: falso })
    }
}
console.log('')
