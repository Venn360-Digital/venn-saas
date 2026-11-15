/**
 * Provas do prefixo de instância e dos nomes do fluxo de pagamento.
 *
 * Os três são nomes que ligam o sistema a algo FORA dele — uma instância criada
 * na Evolution, uma janela do navegador, uma mensagem entre janelas. Trocar
 * qualquer um não renomeia nada do outro lado: só faz o reconhecimento falhar,
 * em silêncio.
 *
 * O prefixo de instância é o mais grave: ele volta em cada webhook e é por ele
 * que o Worker descobre a sala. Trocado, toda linha já conectada passa a ter
 * mensagem descartada como "sala desconhecida" — sem erro, sem log de causa.
 *
 *     pnpm run test:instancia
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

import './lib/marca-de-teste.ts'

import { nomeDaJanelaDePagamento, tipoDaMensagemDePagamento } from '@venn/core/lib/pagamento-janela'
import { nomeDaInstancia, prefixoDaInstancia } from '@venn/core/lib/whatsapp/instancia'
import { BRAND } from '@venn/core/marca'

let passou = 0
let falhou = 0
function ok(nome: string, condicao: boolean, detalhe = '') {
    console.log(`  ${condicao ? 'ok ' : 'FALHOU'} ${nome}${detalhe ? `  — ${detalhe}` : ''}`)
    if (condicao) passou++
    else falhou++
}

/**
 * O prefixo que as instâncias JÁ CRIADAS usam, por app.
 *
 * Escrito à mão, como em `test:cookies`: derivar daqui tornaria o teste
 * tautológico. É esta linha que faz uma mudança de slug reprovar.
 */
const PREFIXO_JA_CRIADO: Record<string, string> = {
    odontobox360: 'odontobox',
}

console.log('\nO prefixo de instância é o das instâncias já criadas na Evolution')
const apps = readdirSync('apps').filter((n) => existsSync(join('apps', n, 'src/config/brand.ts')))
for (const app of apps) {
    const slug = readFileSync(join('apps', app, 'src/config/brand.ts'), 'utf8').match(/^\s+slug: '([^']+)'/m)?.[1]
    const esperado = PREFIXO_JA_CRIADO[app]
    if (esperado === undefined) {
        ok(`${app} está em PREFIXO_JA_CRIADO`, false, 'app novo: acrescente a linha')
        continue
    }
    ok(
        `${app}: o prefixo é "${esperado}" — mudar DESCONECTA as linhas já ligadas`,
        slug === esperado,
        slug === esperado ? slug : `declarado ${slug}, instâncias usam ${esperado}`
    )
}

console.log('\nO nome tem a forma <prefixo>_<id>, que é o que o webhook devolve')
const slug = BRAND().slug
ok('o prefixo é o slug da marca', prefixoDaInstancia() === slug, prefixoDaInstancia())
ok('um id', nomeDaInstancia('abc123') === `${slug}_abc123`, nomeDaInstancia('abc123'))
ok('dois (o caminho da Meta)', nomeDaInstancia('ws1', 'phone2') === `${slug}_ws1_phone2`, nomeDaInstancia('ws1', 'phone2'))
ok('o separador é `_`, e o id é cuid sem `_`', !slug.includes('_'), slug)

console.log('\nOs nomes do pagamento: os dois lados têm de concordar')
/*
 * A tela do plano abre a janela e escuta; a rota de retorno responde. Se os
 * valores divergirem, a confirmação nunca chega e a tela gira sem erro — o pior
 * tipo de falha, porque parece lentidão.
 */
ok('o nome da janela vem do slug', nomeDaJanelaDePagamento() === `${slug}-pagamento`, nomeDaJanelaDePagamento())
ok('o tipo da mensagem vem do slug', tipoDaMensagemDePagamento() === `${slug}:pagamento`, tipoDaMensagemDePagamento())
ok(
    'janela e mensagem são DIFERENTES entre si',
    nomeDaJanelaDePagamento() !== tipoDaMensagemDePagamento(),
    `${nomeDaJanelaDePagamento()} / ${tipoDaMensagemDePagamento()}`
)

console.log(`\n${passou} ok, ${falhou} falha(s)\n`)
process.exit(falhou > 0 ? 1 : 0)
