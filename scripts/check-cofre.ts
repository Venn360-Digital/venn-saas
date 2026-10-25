/**
 * Prova do cofre da aplicação.
 *
 * A extensão de cofre anterior cifrava no banco e nós confiávamos nela. Agora a
 * cifra é nossa (`src/lib/secrets/envelope.ts`), e cifra própria sem teste é
 * cifra que ninguém sabe se funciona. Este script confere as propriedades que
 * importam, não só que o ciclo fecha: que adulterar o texto cifrado **falha**
 * em vez de devolver lixo, que o nonce muda a cada gravação, que chave errada é
 * recusada, e que os cinco segredos reais medidos na VPS mapeiam para os nomes
 * de variável esperados.
 *
 *     npm run check:cofre
 */
import { cifrar, decifrar, ehEnvelope, gerarChave, CHAVE_ENV, ChaveAusenteError } from '@/lib/secrets/envelope'
import { nomeDeAmbiente, segredoDeAmbiente, definidoNoAmbiente } from '@/lib/secrets/ambiente'
import { PLATFORM_PROVIDERS, variaveisDoProvedor } from '@/lib/platform-credentials'
import { META_VERIFY_TOKEN_SECRET } from '@/lib/meta/webhook'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

async function main() {

    let falhas = 0
    const ok = (nome: string, cond: boolean) => {
        console.log(`${cond ? 'PASS' : 'FAIL'}  ${nome}`)
        if (!cond) falhas++
    }

    // 1. Sem chave, nada funciona — e falha com erro nomeado, não genérico.
    delete process.env[CHAVE_ENV]
    try {
        await cifrar('x')
        ok('sem chave recusa cifrar', false)
    } catch (e) {
        ok('sem chave recusa cifrar com ChaveAusenteError', e instanceof ChaveAusenteError)
    }

    // 2. Chave gerada tem 32 bytes.
    const chave = gerarChave()
    ok('gerarChave devolve 32 bytes em base64', Buffer.from(chave, 'base64').length === 32)
    process.env[CHAVE_ENV] = chave

    // 3. Ciclo completo, incluindo acento e caractere fora do ASCII.
    const segredo = 'aact_prod_çãõ€🦷::token-com-dois-pontos'
    const env1 = await cifrar(segredo)
    ok('envelope reconhecido por ehEnvelope', ehEnvelope(env1))
    ok('envelope não contém o valor em claro', !JSON.stringify(env1).includes('aact_prod'))
    ok('decifrar devolve o original', (await decifrar(env1)) === segredo)

    // 4. Nonce novo a cada gravação: dois envelopes do mesmo valor diferem.
    const env2 = await cifrar(segredo)
    ok('iv diferente a cada cifragem', env1.iv !== env2.iv)
    ok('ct diferente a cada cifragem', env1.ct !== env2.ct)
    ok('ambos decifram para o mesmo valor', (await decifrar(env2)) === segredo)

    // 5. GCM autentica: adulterar o texto cifrado tem de falhar, não devolver lixo.
    const adulterado = { ...env1, ct: env1.ct.slice(0, -4) + (env1.ct.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA') }
    try {
        await decifrar(adulterado)
        ok('adulteração é rejeitada', false)
    } catch {
        ok('adulteração é rejeitada', true)
    }

    // 6. Chave errada não decifra.
    process.env[CHAVE_ENV] = gerarChave()
    try {
        await decifrar(env1)
        ok('chave errada é rejeitada', false)
    } catch {
        ok('chave errada é rejeitada', true)
    }

    // 7. Chave de tamanho inválido é recusada na importação.
    process.env[CHAVE_ENV] = Buffer.from('curta').toString('base64')
    try {
        await cifrar('x')
        ok('chave de 5 bytes é recusada', false)
    } catch (e) {
        ok('chave de 5 bytes é recusada', String(e).includes('32'))
    }

    // 8. Mapeamento de nomes dos cinco segredos medidos na VPS.
    const esperado: Record<string, string> = {
        'platform:asaas:clientId': 'PLATFORM_ASAAS_CLIENT_ID',
        'platform:asaas:clientSecret': 'PLATFORM_ASAAS_CLIENT_SECRET',
        'platform:instagram_login:clientSecret': 'PLATFORM_INSTAGRAM_LOGIN_CLIENT_SECRET',
        'platform:meta_messaging:clientSecret': 'PLATFORM_META_MESSAGING_CLIENT_SECRET',
        'platform:meta_messaging:verifyToken': 'PLATFORM_META_MESSAGING_VERIFY_TOKEN',
    }
    ok(
        'nomeDeAmbiente acerta os cinco segredos reais',
        Object.entries(esperado).every(([k, v]) => nomeDeAmbiente(k) === v)
    )

    /**
     * 9. O que `cloudflare.config.ts` DECLARA tem de ser o que o código LÊ.
     *
     * Esta é a falha que não dá erro. O nome de cada segredo de plataforma é
     * derivado — `nomeDeAmbiente(platformSecretName(provedor, campo))` — mas a
     * declaração no config é uma lista escrita à mão. Um `PLATFORM_` digitado
     * errado ali faz o operador gravar a credencial num nome que ninguém
     * consulta: o deploy passa, a tela diz "pendente", e a conclusão natural é
     * que o `wrangler secret put` não funcionou.
     *
     * Confere nas duas direções, porque os dois erros existem: declarado sem
     * ninguém ler, e lido sem estar declarado — e o segundo é pior, porque
     * `cloudflare.config.ts` é declarativo e **remove no deploy seguinte** o
     * segredo que não está nele.
     */
    const config = readFileSync(join(process.cwd(), 'cloudflare.config.ts'), 'utf8')
    const declarados = new Set(
        [...config.matchAll(/^\s*(PLATFORM_[A-Z0-9_]+):\s*bindings\.secret\(\)/gm)].map(
            (m) => m[1]!
        )
    )

    const derivados = new Set<string>()
    for (const p of PLATFORM_PROVIDERS) {
        const v = variaveisDoProvedor(p.provider)
        derivados.add(v.id)
        derivados.add(v.segredo)
    }
    derivados.add(nomeDeAmbiente(META_VERIFY_TOKEN_SECRET))

    const orfaos = [...declarados].filter((n) => !derivados.has(n))
    ok(
        `config: nenhum PLATFORM_ declarado que o código não leia${orfaos.length ? ` — ${orfaos.join(', ')}` : ` (${declarados.size} declarado(s))`}`,
        orfaos.length === 0
    )

    /**
     * A VOLTA NÃO É EXIGIDA, e a razão é o deploy quebrado de 2026-10-24.
     *
     * A primeira versão desta guarda exigia que todo provedor "em uso"
     * estivesse declarado. Parecia simétrico e estava errado:
     * `bindings.secret()` é **exigência de deploy**, não declaração. Com os
     * nove declarados e nenhum gravado, `cf deploy` recusou publicar e `main`
     * ficou impublicável — "The following required secrets have not been set".
     *
     * A regra verdadeira é de ORDEM, e nenhum teste em CI a alcança, porque
     * depende do que está gravado no Worker, que o CI não consulta: grave
     * primeiro, declare no mesmo commit que põe em uso, publique depois. Está
     * escrita no comentário de `cloudflare.config.ts`, onde quem for declarar
     * vai ler.
     *
     * O que sobra aqui é a metade que um teste PODE provar, e é a que pega o
     * erro silencioso: nome declarado que o código não lê. O contrário —
     * gravado e não declarado — é apagado no deploy seguinte, e isso o
     * comentário do config avisa.
     */

    // 10. Precedência e vazio-como-ausente.
    process.env.PLATFORM_ASAAS_CLIENT_SECRET = '  '
    ok('secret vazio conta como ausente', !definidoNoAmbiente('platform:asaas:clientSecret'))
    process.env.PLATFORM_ASAAS_CLIENT_SECRET = 'valor-do-ambiente'
    ok('secret definido é encontrado', segredoDeAmbiente('platform:asaas:clientSecret') === 'valor-do-ambiente')

    console.log(falhas === 0 ? '\nTODOS OS TESTES PASSARAM' : `\n${falhas} FALHA(S)`)
    process.exit(falhas === 0 ? 0 : 1)

}

void main()
