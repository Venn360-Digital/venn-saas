/**
 * As provas do retrato — a leitura do valor guardado e o endereço que sai dele.
 *
 * O que se afirma aqui, e por que cada coisa:
 *
 * 1. **data URI é reconhecido**, porque é a forma em que os retratos de usuário
 *    estão guardados hoje em produção.
 * 2. **SVG é recusado**, porque SVG servido do nosso domínio executa script no
 *    nosso domínio. É a afirmação mais importante do arquivo.
 * 3. **sem foto devolve `null`**, e não um endereço que daria 404 — é o que faz
 *    o cartão escrever o nome sem gastar uma requisição para descobrir isso.
 * 4. **o `v` muda com o `updatedAt`**, que é o que fura o cache quando a pessoa
 *    troca a foto, e o que permite o `immutable` de um ano.
 */

import {
    CACHE_DO_RETRATO,
    bytesDoEmbutido,
    enderecoDoRetrato,
    formaDoRetrato,
} from '../src/lib/retratos'

let ok = 0
let falhas = 0

function conferir(nome: string, obtido: unknown, esperado: unknown) {
    const a = JSON.stringify(obtido)
    const b = JSON.stringify(esperado)
    if (a === b) {
        ok++
        console.log(`  ok  ${nome}`)
    } else {
        falhas++
        console.log(`  XX  ${nome}\n      esperado: ${b}\n      obtido:   ${a}`)
    }
}

console.log('\n— a forma do que está guardado —\n')

conferir('nulo é nenhum', formaDoRetrato(null), { tipo: 'nenhum' })
conferir('vazio é nenhum', formaDoRetrato(''), { tipo: 'nenhum' })

conferir('data URI de png', formaDoRetrato('data:image/png;base64,iVBORw0KGgo='), {
    tipo: 'embutido',
    mime: 'image/png',
    base64: 'iVBORw0KGgo=',
})

conferir('data URI de jpeg', formaDoRetrato('data:image/jpeg;base64,/9j/4AAQ'), {
    tipo: 'embutido',
    mime: 'image/jpeg',
    base64: '/9j/4AAQ',
})

conferir('MIME em maiúscula normaliza', formaDoRetrato('data:IMAGE/PNG;base64,AAAA'), {
    tipo: 'embutido',
    mime: 'image/png',
    base64: 'AAAA',
})

// A afirmação que protege o domínio: SVG não passa, mesmo bem formado.
conferir(
    'SVG é recusado — serviria script do nosso domínio',
    formaDoRetrato('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='),
    { tipo: 'nenhum' }
)
conferir(
    'HTML disfarçado de imagem é recusado',
    formaDoRetrato('data:text/html;base64,PHNjcmlwdD4='),
    { tipo: 'nenhum' }
)

conferir('data URI sem base64 não casa', formaDoRetrato('data:image/png,abc'), {
    tipo: 'nenhum',
})
conferir('data URI sem conteúdo não casa', formaDoRetrato('data:image/png;base64,'), {
    tipo: 'nenhum',
})

conferir('referência de acervo', formaDoRetrato('ref:publico:ws/agents/a1.png'), {
    tipo: 'acervo',
    valor: 'ref:publico:ws/agents/a1.png',
})
conferir('URL antiga de acervo', formaDoRetrato('https://cdn.exemplo/a.png'), {
    tipo: 'acervo',
    valor: 'https://cdn.exemplo/a.png',
})

conferir('lixo é nenhum', formaDoRetrato('foto-da-rachel'), { tipo: 'nenhum' })

console.log('\n— o endereço —\n')

const quando = new Date('2026-11-06T12:00:00.000Z')
const v = quando.getTime().toString(36)

conferir(
    'usuário com data URI ganha endereço',
    enderecoDoRetrato('usuario', 'u1', 'data:image/png;base64,AAAA', quando),
    `/api/retratos/usuario/u1?v=${v}`
)

conferir(
    'agente com referência ganha endereço',
    enderecoDoRetrato('agente', 'a1', 'ref:publico:ws/agents/a1.png', quando),
    `/api/retratos/agente/a1?v=${v}`
)

// Sem foto é `null`, e é o que manda o cartão escrever o nome.
conferir('sem foto é null, não é endereço que daria 404', enderecoDoRetrato('usuario', 'u1', null, quando), null)
conferir('SVG também devolve null', enderecoDoRetrato('usuario', 'u1', 'data:image/svg+xml;base64,AA', quando), null)

conferir(
    'id com caractere especial é escapado',
    enderecoDoRetrato('usuario', 'a/b?c', 'data:image/png;base64,AAAA', quando),
    `/api/retratos/usuario/a%2Fb%3Fc?v=${v}`
)

const depois = new Date(quando.getTime() + 1000)
const antes = enderecoDoRetrato('usuario', 'u1', 'data:image/png;base64,AAAA', quando)
const agora = enderecoDoRetrato('usuario', 'u1', 'data:image/png;base64,BBBB', depois)
conferir('trocar a foto muda o endereço — é o que fura o cache', antes !== agora, true)

conferir('sem updatedAt o v é 0', enderecoDoRetrato('usuario', 'u1', 'data:image/png;base64,AAAA', null), '/api/retratos/usuario/u1?v=0')

console.log('\n— os bytes e o cache —\n')

// "AAAA" em base64 é 0x00 0x00 0x00.
conferir('decodifica base64 para bytes', [...bytesDoEmbutido('AAAA')], [0, 0, 0])
// "iVBORw0KGgo=" é a assinatura de um PNG: 89 50 4E 47 0D 0A 1A 0A.
conferir(
    'a assinatura do PNG sobrevive',
    [...bytesDoEmbutido('iVBORw0KGgo=')],
    [137, 80, 78, 71, 13, 10, 26, 10]
)

conferir('o cache é privado e imutável', CACHE_DO_RETRATO, 'private, max-age=31536000, immutable')

console.log(`\n${ok} ok, ${falhas} falhas\n`)
if (falhas) process.exit(1)
