/**
 * Provas da configuração do widget — a leitura tolerante e a regra de domínio.
 *
 * `origemPermitida` é **autorização**: decide se a página que carregou o script
 * pode abrir o atendimento da clínica. Regra de autorização que só se verifica
 * abrindo o navegador não se verifica — e esta roda em Node puro, porque o
 * módulo é puro de propósito.
 *
 *     npm run test:widget-config
 */
import {
    WIDGET_PADRAO,
    hostDe,
    lerConfiguracaoDoWidget,
    origemPermitida,
} from '../src/lib/widget-config'

let passou = 0
let falhou = 0

function conferir(nome: string, obtido: unknown, esperado: unknown) {
    const ok = JSON.stringify(obtido) === JSON.stringify(esperado)
    console.log(`  ${ok ? 'ok ' : 'FALHOU'} ${nome}`)
    if (!ok) {
        console.log(`        esperado: ${JSON.stringify(esperado)}`)
        console.log(`        obtido:   ${JSON.stringify(obtido)}`)
        falhou++
    } else {
        passou++
    }
}

console.log('\nhostDe — só o host importa')
conferir('tira esquema, porta e caminho', hostDe('https://Clinica.com.br:443/precos?x=1'), 'clinica.com.br')
conferir('aceita host nu', hostDe('clinica.com.br'), 'clinica.com.br')
conferir('minúsculas', hostDe('WWW.Clinica.COM.BR'), 'www.clinica.com.br')
conferir('vazio é nulo', hostDe('   '), null)
conferir('lixo é nulo', hostDe('://'), null)

console.log('\norigemPermitida — a regra de autorização')
conferir('lista vazia libera (é o estado de todo widget já colado)', origemPermitida('https://qualquer.com', []), true)
conferir('sem Origin libera', origemPermitida(null, ['clinica.com.br']), true)
conferir('host exato entra', origemPermitida('https://clinica.com.br/precos', ['clinica.com.br']), true)
conferir('subdomínio entra', origemPermitida('https://www.clinica.com.br', ['clinica.com.br']), true)
conferir('porta não muda nada', origemPermitida('https://clinica.com.br:8443', ['clinica.com.br']), true)
conferir('http também entra — o esquema não diz de quem é o site', origemPermitida('http://clinica.com.br', ['clinica.com.br']), true)
conferir('outro domínio é recusado', origemPermitida('https://copiou.com', ['clinica.com.br']), false)
conferir(
    'sufixo colado NÃO entra — "maliciosaclinica.com.br" não é subdomínio',
    origemPermitida('https://maliciosaclinica.com.br', ['clinica.com.br']),
    false
)
conferir(
    'domínio que CONTÉM o permitido no meio é recusado',
    origemPermitida('https://clinica.com.br.evil.com', ['clinica.com.br']),
    false
)
conferir('o pai não entra pelo filho', origemPermitida('https://clinica.com.br', ['www.clinica.com.br']), false)
conferir('vale qualquer um da lista', origemPermitida('https://b.com', ['a.com', 'b.com']), true)
conferir('origem ilegível com lista cheia é recusada', origemPermitida('://', ['a.com']), false)

console.log('\nlerConfiguracaoDoWidget — tolerante, e sem confiar na forma')
conferir('nulo vira o padrão', lerConfiguracaoDoWidget(null), WIDGET_PADRAO)
conferir('array vira o padrão', lerConfiguracaoDoWidget([1, 2]), WIDGET_PADRAO)
conferir(
    'formato inválido cai no padrão',
    lerConfiguracaoDoWidget({ formato: 'quadrado' }).formato,
    'bolha'
)
conferir('cor sem # é descartada', lerConfiguracaoDoWidget({ cor: '06b6d4' }).cor, null)
conferir('cor de 3 dígitos vale', lerConfiguracaoDoWidget({ cor: '#0bf' }).cor, '#0bf')
conferir(
    'domínios viram host, sem repetição',
    lerConfiguracaoDoWidget({
        dominios: ['https://clinica.com.br/x', 'clinica.com.br', 'WWW.clinica.com.br', '   ', 42],
    }).dominios,
    ['clinica.com.br', 'www.clinica.com.br']
)
conferir(
    'obrigatório sozinho não trava a conversa atrás de um formulário sem campo',
    lerConfiguracaoDoWidget({ captura: { obrigatorio: true } }).captura,
    { nome: false, whatsapp: false, email: false, obrigatorio: false }
)
conferir(
    'obrigatório com campo vale',
    lerConfiguracaoDoWidget({ captura: { nome: true, obrigatorio: true } }).captura,
    { nome: true, whatsapp: false, email: false, obrigatorio: true }
)
conferir(
    'o que os outros canais gravam no mesmo JSON é ignorado, não quebra',
    lerConfiguracaoDoWidget({ qrCode: 'x', sessionId: 'y', accessToken: 'z' }),
    WIDGET_PADRAO
)
conferir(
    'texto em branco vira nulo, para cair no valor do agente',
    lerConfiguracaoDoWidget({ nomeExibido: '   ', saudacao: '' }),
    WIDGET_PADRAO
)

console.log(`\n${passou} ok, ${falhou} falha(s)\n`)
process.exit(falhou > 0 ? 1 : 0)
