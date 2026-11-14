/**
 * Os casos da marcação do WhatsApp na bolha.
 *
 *   npm run test:marcacao
 *
 * Metade destes casos não é sobre formatar: é sobre **não** formatar. Uma regra
 * frouxa de asterisco e sublinhado transforma prosa normal — "2 * 3",
 * "arquivo_final_v2", uma lista escrita com "* " — em negrito e itálico
 * aleatórios dentro da conversa do paciente, e isso é pior do que mostrar o
 * caractere cru. Por isso cada afrouxamento futuro tem de passar por aqui
 * antes.
 *
 * O analisador é puro e não toca em React, então a decisão inteira se exercita
 * sem navegador.
 */
import { analisarTextoDeWhatsApp, semMarcacao, temMarcacao } from '@venn/core/lib/texto-whatsapp'

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

/** A árvore achatada numa notação curta, para o caso caber numa linha. */
function forma(texto: string): string {
    const render = (nos: ReturnType<typeof analisarTextoDeWhatsApp>): string =>
        nos
            .map((no) => {
                switch (no.tipo) {
                    case 'texto':
                        return no.texto
                    case 'mono':
                        return `mono(${no.texto})`
                    case 'blocoMono':
                        return `bloco(${no.texto})`
                    case 'negrito':
                        return `B(${render(no.filhos)})`
                    case 'italico':
                        return `I(${render(no.filhos)})`
                    case 'tachado':
                        return `S(${render(no.filhos)})`
                    case 'citacao':
                        return `Q(${render(no.filhos)})`
                }
            })
            .join('')
    return render(analisarTextoDeWhatsApp(texto))
}

console.log('\n— o que deve formatar —\n')

conferir('negrito simples', forma('fica *urgente* hoje'), 'fica B(urgente) hoje')
conferir('itálico simples', forma('a _dor_ passou'), 'a I(dor) passou')
conferir('tachado', forma('~terça~ quarta'), 'S(terça) quarta')
conferir('monoespaçada', forma('o código `A1B2`'), 'o código mono(A1B2)')
conferir('negrito e itálico combinados', forma('*_muito urgente_*'), 'B(I(muito urgente))')
conferir('itálico dentro de negrito, parcial', forma('*já _hoje_*'), 'B(já I(hoje))')
conferir('duas marcas na mesma frase', forma('*sim* e _não_'), 'B(sim) e I(não)')
conferir('marca colada em pontuação', forma('(*sim*)'), '(B(sim))')
conferir('bloco monoespaçado', forma('veja:\n```linha 1\nlinha 2```'), 'veja:\nbloco(linha 1\nlinha 2)')
conferir('dentro do bloco nada é marcação', forma('```*não* _e_```'), 'bloco(*não* _e_)')
conferir('dentro da monoespaçada nada é marcação', forma('`*cru*`'), 'mono(*cru*)')
// A quebra entre a citação e a linha seguinte não vem no texto: a citação
// é renderizada como bloco, e um `\n` a mais abriria um vão duplo.
conferir('citação de uma linha', forma('> dito antes\nagora'), 'Q(dito antes)agora')
conferir('citação com negrito dentro', forma('> é *sim*'), 'Q(é B(sim))')

console.log('\n— o que NÃO deve formatar —\n')

conferir('multiplicação com espaços', forma('2 * 3 * 4'), '2 * 3 * 4')
conferir('sublinhado no meio de identificador', forma('arquivo_final_v2.pdf'), 'arquivo_final_v2.pdf')
conferir('asterisco de lista no começo da linha', forma('* leite\n* pão'), '* leite\n* pão')
conferir('delimitador sem par', forma('o *preço ficou'), 'o *preço ficou')
conferir('espaço depois do abre', forma('* nada *'), '* nada *')
conferir('espaço antes do fecha', forma('*nada *'), '*nada *')
conferir('asterisco entre letras', forma('a*b'), 'a*b')
conferir('par vazio', forma('**'), '**')
conferir('e-mail com sublinhado', forma('joao_silva@exemplo.com'), 'joao_silva@exemplo.com')
conferir('til de aproximação', forma('custa ~ 300 reais'), 'custa ~ 300 reais')
conferir('bloco sem par fica cru', forma('```sem fim'), '```sem fim')

console.log('\n— a prévia de uma linha (cartão da lista, citação de resposta) —\n')

conferir('prévia tira os delimitadores', semMarcacao('*urgente*: a _dor_ voltou'), 'urgente: a dor voltou')
conferir('prévia junta as linhas', semMarcacao('oi\n\n  tudo bem?'), 'oi tudo bem?')
conferir('prévia preserva o que não era marcação', semMarcacao('2 * 3 = 6'), '2 * 3 = 6')
conferir('prévia de texto sem marcação não muda', semMarcacao('bom dia'), 'bom dia')

console.log('\n— o atalho de remontagem —\n')

conferir('tem marcação', temMarcacao('a *b* c'), true)
conferir('não tem marcação', temMarcacao('a b c'), false)
conferir('asterisco que não é marcação não conta', temMarcacao('2 * 3'), false)
conferir('texto vazio', temMarcacao(''), false)

console.log(`\n${passou} ok, ${falhou} falhas\n`)
if (falhou > 0) process.exit(1)
