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

// PRIMEIRO de todos: registra uma marca fictícia, porque este script roda
// código do core e o core PEDE a marca. Ver `./lib/marca-de-teste.ts`.
import './lib/marca-de-teste.ts'

import {
    CACHE_DO_RETRATO,
    CACHE_DO_SEM_RETRATO,
    bytesDoEmbutido,
    chaveDoRetrato,
    enderecoDoRetrato,
    formaDoRetrato,
} from '@venn/core/lib/retratos'

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

/**
 * O endereço **não depende mais do valor da coluna**, e é isso que estas provas
 * travam. A versão anterior recebia `avatar` e devolvia `null` sem foto —
 * economia aparente que obrigava toda lista a trazer a foto inteira do banco
 * para decidir um booleano (275 kB em dois usuários, medido em produção).
 */
conferir('o endereço de um usuário', enderecoDoRetrato('usuario', 'u1', quando), `/api/retratos/usuario/u1?v=${v}`)
conferir('o endereço de um agente', enderecoDoRetrato('agente', 'a1', quando), `/api/retratos/agente/a1?v=${v}`)

conferir(
    'id com caractere especial é escapado',
    enderecoDoRetrato('usuario', 'a/b?c', quando),
    `/api/retratos/usuario/a%2Fb%3Fc?v=${v}`
)

conferir('sem updatedAt o v é 0', enderecoDoRetrato('usuario', 'u1', null), '/api/retratos/usuario/u1?v=0')

// Trocar a foto muda o `updatedAt`, logo muda o endereço — é o que fura o cache
// de um ano sem precisar de hash nem de invalidação.
const depois = new Date(quando.getTime() + 1000)
conferir(
    'updatedAt novo é endereço novo — é o que fura o cache',
    enderecoDoRetrato('usuario', 'u1', quando) !== enderecoDoRetrato('usuario', 'u1', depois),
    true
)

console.log('\n— a chave no acervo —\n')

/**
 * Determinística de propósito: trocar a foto sobrescreve a mesma chave. Chave
 * aleatória por upload deixaria a foto antiga no bucket para sempre, sem
 * ninguém apontando para ela.
 */
conferir('png', chaveDoRetrato('ws1', 'usuario', 'u1', 'image/png'), 'ws1/retratos/usuario/u1.png')
conferir('jpeg vira jpg', chaveDoRetrato('ws1', 'usuario', 'u1', 'image/jpeg'), 'ws1/retratos/usuario/u1.jpg')
conferir('webp', chaveDoRetrato('ws1', 'agente', 'a1', 'image/webp'), 'ws1/retratos/agente/a1.webp')
conferir(
    'a mesma pessoa dá a mesma chave, trocando a foto',
    chaveDoRetrato('ws1', 'usuario', 'u1', 'image/png') ===
        chaveDoRetrato('ws1', 'usuario', 'u1', 'image/png'),
    true
)

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

/**
 * O 404 também é cacheado, e **por uma hora e não por um ano**: quem acabou de
 * subir uma foto quer vê-la hoje. Sem cabeçalho nenhum, cada carga de lista
 * bateria na rota uma vez por pessoa sem foto.
 */
conferir('o 404 é cacheado por uma hora', CACHE_DO_SEM_RETRATO, 'private, max-age=3600')

console.log(`\n${ok} ok, ${falhas} falhas\n`)
if (falhas) process.exit(1)
