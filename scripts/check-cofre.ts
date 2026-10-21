/**
 * Prova do cofre da aplicação.
 *
 * O `supabase_vault` cifrava no banco e nós confiávamos na extensão. Agora a
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

    // 9. Precedência e vazio-como-ausente.
    process.env.PLATFORM_ASAAS_CLIENT_SECRET = '  '
    ok('secret vazio conta como ausente', !definidoNoAmbiente('platform:asaas:clientSecret'))
    process.env.PLATFORM_ASAAS_CLIENT_SECRET = 'valor-do-ambiente'
    ok('secret definido é encontrado', segredoDeAmbiente('platform:asaas:clientSecret') === 'valor-do-ambiente')

    console.log(falhas === 0 ? '\nTODOS OS TESTES PASSARAM' : `\n${falhas} FALHA(S)`)
    process.exit(falhas === 0 ? 0 : 1)

}

void main()
