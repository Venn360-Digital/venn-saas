/**
 * Manda um e-mail de teste pelo SES, com as credenciais do ambiente.
 *
 *   npx tsx --conditions=react-server scripts/testar-ses.ts --para alguem@exemplo.com
 *
 * A condicao `react-server` e obrigatoria: `src/lib/email/ses.ts` tem
 * `import 'server-only'`, que no Node comum resolve para o modulo que LANCA.
 * Com ela o pacote resolve para o vazio, e o guarda continua valendo onde
 * importa — num bundle de cliente, que nao passa essa condicao.
 *
 * Prova o caminho inteiro **sem Worker e sem banco**: credencial, assinatura
 * SigV4, região, identidade verificada e configuration set. É o único pedaço
 * desta feature que se prova nesta máquina — fila, cron e disparo precisam de
 * staging, porque o workerd não roda aqui (ver CLAUDE.md).
 *
 * O que cada falha costuma significar está em `diagnostico()`, no fim: o erro
 * cru do SES diz o código e nada sobre o que fazer com ele.
 */
import { credenciaisDoSes, enviarPorSes } from '../src/lib/email/ses'
import { campanhaEmTexto, renderCampanha, type Bloco } from '../src/lib/email/blocos'

function argumento(nome: string): string | undefined {
    const i = process.argv.indexOf(`--${nome}`)
    return i >= 0 ? process.argv[i + 1] : undefined
}

const para = argumento('para')
if (!para) {
    console.error(
        'uso: npx tsx --conditions=react-server scripts/testar-ses.ts --para alguem@exemplo.com [--de contato@dominio]'
    )
    process.exit(1)
}

const cred = credenciaisDoSes()
if (!cred) {
    console.error('SES_ACCESS_KEY_ID e SES_SECRET_ACCESS_KEY precisam estar no ambiente.')
    console.error('Ver docs/ses-credenciais.md, passo 5.')
    process.exit(1)
}

const de = argumento('de') ?? process.env.SES_FROM
if (!de) {
    console.error('Informe o remetente com --de, num domínio já verificado no SES.')
    process.exit(1)
}

const blocos: Bloco[] = [
    { tipo: 'titulo', texto: 'Oi {{nome}}, isto é um teste' },
    {
        tipo: 'texto',
        texto:
            'Se esta mensagem chegou, o caminho do SES está de pé: credencial, assinatura, região e domínio verificado.\n\nEla foi montada pelo mesmo renderizador que as campanhas usam.',
    },
    { tipo: 'botao', texto: 'Um botão de exemplo', url: 'https://exemplo.com.br' },
]

const casca = {
    blocos,
    campos: { nome: 'Maria', nomeCompleto: 'Maria Silva', unidade: 'Teste' },
    assinatura: 'Envio de teste · nenhuma campanha foi disparada',
    descadastroUrl: 'https://exemplo.com.br/descadastro/teste',
    preheader: 'Teste de configuração do SES',
}

console.log(`região:      ${cred.region}`)
console.log(`de:          ${de}`)
console.log(`para:        ${para}`)
console.log(`config set:  ${process.env.SES_CONFIGURATION_SET ?? '(nenhum — sem recibos)'}`)
console.log('')

const resultado = await enviarPorSes({
    de,
    nomeDoRemetente: 'Teste',
    responderPara: de,
    para,
    assunto: 'Teste de configuração do SES',
    html: renderCampanha(casca),
    texto: campanhaEmTexto(casca),
    configurationSet: process.env.SES_CONFIGURATION_SET,
    descadastroUrl: casca.descadastroUrl,
    tags: { teste: 'configuracao' },
})

if (resultado.ok) {
    console.log(`✓ aceito pelo SES — MessageId ${resultado.messageId}`)
    console.log('')
    console.log('Aceito não é entregue: confira a caixa de destino. Se não chegar,')
    console.log('veja SES → Account dashboard, e a pasta de spam.')
    process.exit(0)
}

console.error(`✗ ${resultado.error}`)
console.error(`  (${resultado.definitivo ? 'definitivo — repetir não ajuda' : 'momentâneo — vale repetir'})`)
console.error('')
console.error(diagnostico(resultado.error ?? ''))
process.exit(1)

/** O que o código de erro do SES costuma querer dizer, em português. */
function diagnostico(erro: string): string {
    if (erro.includes('MessageRejected') && erro.includes('not verified')) {
        return [
            'O domínio do remetente não está verificado nesta região.',
            `Confira em SES → Identities, com a região em ${cred?.region}.`,
            'Identidade verificada em outra região não vale aqui.',
        ].join('\n')
    }
    if (erro.includes('AccountSendingPaused') || erro.includes('SendingPaused')) {
        return 'O envio está suspenso para esta conta. Veja SES → Account dashboard.'
    }
    if (erro.includes('NotFoundException') && process.env.SES_CONFIGURATION_SET) {
        return [
            `O configuration set "${process.env.SES_CONFIGURATION_SET}" não existe nesta região.`,
            'Crie-o antes (docs/ses-credenciais.md, passo 2) ou rode sem a variável.',
        ].join('\n')
    }
    if (erro.includes('AccessDenied') || erro.includes('not authorized')) {
        return [
            'A política do usuário IAM não permite esta ação.',
            'Compare com o passo 3 de docs/ses-credenciais.md — e confira que o ARN',
            'do configuration set na política é o mesmo que está sendo usado.',
        ].join('\n')
    }
    if (erro.includes('Email address is not verified')) {
        return [
            'A conta ainda está no sandbox: só manda para endereço verificado.',
            'Verifique o destinatário em SES → Identities, ou peça a saída do',
            'sandbox (docs/ses-credenciais.md, passo 6).',
        ].join('\n')
    }
    return 'Sem diagnóstico conhecido para este erro. O código acima é do SES.'
}
