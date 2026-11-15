/**
 * Provas da concordância do vocabulário.
 *
 * Texto quebrado por gênero errado não falha em teste nenhum e não lança: ele
 * aparece na tela do cliente, escrito "a estúdio". Então cada combinação de
 * eixo × contração × gênero × número é conferida contra o português, à mão.
 *
 *     pnpm run test:concordancia
 */
import './lib/marca-de-teste.ts'

import { comArtigo } from '@venn/core/lib/concordancia'
import type { Vocabulario } from '@venn/core/lib/vocabulario'
import { BRAND } from '@venn/core/marca'

let passou = 0
let falhou = 0

function conferir(nome: string, obtido: unknown, esperado: unknown) {
    const ok = obtido === esperado
    console.log(`  ${ok ? 'ok ' : 'FALHOU'} ${nome}`)
    if (!ok) {
        console.log(`        esperado: ${JSON.stringify(esperado)}`)
        console.log(`        obtido:   ${JSON.stringify(obtido)}`)
        falhou++
    } else passou++
}

/**
 * A marca de teste tem gênero MISTO de propósito — organização e pessoa
 * femininas, profissional e serviço masculinos. Sem isso metade dos casos
 * ficaria sem exercício, que é como um bug de gênero sobrevive a uma suíte
 * verde.
 */
const V = BRAND().vocabulario

console.log('\nArtigo definido, os dois gêneros e os dois números')
conferir('feminino singular', comArtigo(V, 'organizacao'), 'a organização')
conferir('feminino plural', comArtigo(V, 'organizacoes'), 'as organizações')
conferir('masculino singular', comArtigo(V, 'profissional'), 'o profissional')
conferir('masculino plural', comArtigo(V, 'profissionais'), 'os profissionais')

console.log('\nde + artigo — 74 das ocorrências medidas')
conferir('da organização', comArtigo(V, 'organizacao', 'de'), 'da organização')
conferir('das organizações', comArtigo(V, 'organizacoes', 'de'), 'das organizações')
conferir('do serviço', comArtigo(V, 'servico', 'de'), 'do serviço')
conferir('dos serviços', comArtigo(V, 'servicos', 'de'), 'dos serviços')

console.log('\na + artigo — e a crase, que concatenar erraria')
conferir('à organização (não "aa")', comArtigo(V, 'organizacao', 'a'), 'à organização')
conferir('às organizações', comArtigo(V, 'organizacoes', 'a'), 'às organizações')
conferir('ao profissional', comArtigo(V, 'profissional', 'a'), 'ao profissional')
conferir('aos profissionais', comArtigo(V, 'profissionais', 'a'), 'aos profissionais')

console.log('\npor + artigo — "pelo" não se parece com nenhuma das partes')
conferir('pela pessoa', comArtigo(V, 'pessoa', 'por'), 'pela pessoa')
conferir('pelas pessoas', comArtigo(V, 'pessoas', 'por'), 'pelas pessoas')
conferir('pelo serviço', comArtigo(V, 'servico', 'por'), 'pelo serviço')
conferir('pelos serviços', comArtigo(V, 'servicos', 'por'), 'pelos serviços')

console.log('\nem + artigo')
conferir('na organização', comArtigo(V, 'organizacao', 'em'), 'na organização')
conferir('no serviço', comArtigo(V, 'servico', 'em'), 'no serviço')

console.log('\nDemonstrativo e indefinido — 38 das ocorrências medidas')
conferir('esta pessoa', comArtigo(V, 'pessoa', 'este'), 'esta pessoa')
conferir('estes profissionais', comArtigo(V, 'profissionais', 'este'), 'estes profissionais')
conferir('essa organização', comArtigo(V, 'organizacao', 'esse'), 'essa organização')
conferir('uma pessoa', comArtigo(V, 'pessoa', 'um'), 'uma pessoa')
conferir('um serviço', comArtigo(V, 'servico', 'um'), 'um serviço')
conferir('umas pessoas', comArtigo(V, 'pessoas', 'um'), 'umas pessoas')

console.log('\nA forma capitalizada põe a maiúscula no DETERMINANTE')
conferir('A pessoa (início de frase)', comArtigo(V, 'Pessoa'), 'A pessoa')
conferir('O profissional', comArtigo(V, 'Profissional'), 'O profissional')
conferir('Os profissionais', comArtigo(V, 'Profissionais'), 'Os profissionais')
conferir('Da organização', comArtigo(V, 'Organizacao', 'de'), 'Da organização')
conferir('À organização', comArtigo(V, 'Organizacao', 'a'), 'À organização')

console.log('\nO gênero vem da MARCA: a mesma chamada muda de artigo com outra marca')
const outroNicho: Vocabulario = {
    ...V,
    genero: { ...V.genero, organizacao: 'm', pessoa: 'm' },
    organizacao: 'estúdio',
    organizacoes: 'estúdios',
    pessoa: 'hóspede',
    pessoas: 'hóspedes',
}
conferir('o estúdio, onde era "a organização"', comArtigo(outroNicho, 'organizacao'), 'o estúdio')
conferir('do estúdio', comArtigo(outroNicho, 'organizacao', 'de'), 'do estúdio')
conferir('ao estúdio, onde era "à"', comArtigo(outroNicho, 'organizacao', 'a'), 'ao estúdio')
conferir('este hóspede, onde era "esta pessoa"', comArtigo(outroNicho, 'pessoa', 'este'), 'este hóspede')
conferir('pelos hóspedes', comArtigo(outroNicho, 'pessoas', 'por'), 'pelos hóspedes')

console.log('\nPalavra composta — onde deduzir o gênero por terminação erraria')
const composto: Vocabulario = {
    ...V,
    genero: { ...V.genero, profissional: 'f' },
    profissional: 'equipe de atendimento',
    profissionais: 'equipes de atendimento',
}
conferir('a equipe de atendimento', comArtigo(composto, 'profissional'), 'a equipe de atendimento')
conferir('das equipes de atendimento', comArtigo(composto, 'profissionais', 'de'), 'das equipes de atendimento')

console.log(`\n${passou} ok, ${falhou} falha(s)\n`)
process.exit(falhou > 0 ? 1 : 0)
