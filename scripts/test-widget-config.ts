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
// PRIMEIRO de todos: registra uma marca fictícia, porque este script roda
// código do core e o core PEDE a marca. Ver `./lib/marca-de-teste.ts`.
import './lib/marca-de-teste.ts'

import {
    WIDGET_PADRAO,
    hostDe,
    lerConfiguracaoDoWidget,
    origemPermitida,
} from '@venn/core/lib/widget-config'

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
conferir('tira esquema, porta e caminho', hostDe('https://exemplo.com.br:443/precos?x=1'), 'exemplo.com.br')
conferir('aceita host nu', hostDe('exemplo.com.br'), 'exemplo.com.br')
conferir('minúsculas', hostDe('WWW.exemplo.COM.BR'), 'www.exemplo.com.br')
conferir('vazio é nulo', hostDe('   '), null)
conferir('lixo é nulo', hostDe('://'), null)

console.log('\norigemPermitida — a regra de autorização')
conferir('lista vazia libera (é o estado de todo widget já colado)', origemPermitida('https://qualquer.com', []), true)
conferir('sem Origin libera', origemPermitida(null, ['exemplo.com.br']), true)
conferir('host exato entra', origemPermitida('https://exemplo.com.br/precos', ['exemplo.com.br']), true)
conferir('subdomínio entra', origemPermitida('https://www.exemplo.com.br', ['exemplo.com.br']), true)
conferir('porta não muda nada', origemPermitida('https://exemplo.com.br:8443', ['exemplo.com.br']), true)
conferir('http também entra — o esquema não diz de quem é o site', origemPermitida('http://exemplo.com.br', ['exemplo.com.br']), true)
conferir('outro domínio é recusado', origemPermitida('https://copiou.com', ['exemplo.com.br']), false)
conferir(
    'sufixo colado NÃO entra — "maliciosaexemplo.com.br" não é subdomínio',
    origemPermitida('https://maliciosaexemplo.com.br', ['exemplo.com.br']),
    false
)
conferir(
    'domínio que CONTÉM o permitido no meio é recusado',
    origemPermitida('https://exemplo.com.br.evil.com', ['exemplo.com.br']),
    false
)
conferir('o pai não entra pelo filho', origemPermitida('https://exemplo.com.br', ['www.exemplo.com.br']), false)
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
        dominios: ['https://exemplo.com.br/x', 'exemplo.com.br', 'WWW.exemplo.com.br', '   ', 42],
    }).dominios,
    ['exemplo.com.br', 'www.exemplo.com.br']
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
