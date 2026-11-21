import 'server-only'

import type { Prisma } from '@venn/db'

import { comArtigo } from '../concordancia'
import type { Vocabulario } from '../vocabulario'
import { MARCADOR_DE_ITENS } from './variaveis'
import { ROTULO_DO_TIPO, TIPOS_DE_DOCUMENTO, type TipoDeDocumento } from './estados'

/**
 * Os três modelos com que uma unidade nasce — um por tipo de documento.
 *
 * ## Por que semear, e não deixar vazio
 *
 * `renderDocumento` já responde sem template nenhum (há um corpo padrão lá), e
 * isso cobre a primeira proposta. Mas um modelo vazio não é editável: quem quer
 * mudar a saudação não tem onde. Três modelos prontos dão o ponto de partida —
 * e são a documentação viva dos marcadores, porque mostram cada um em uso.
 *
 * ## Por que o texto nasce do vocabulário, e não escrito aqui
 *
 * `scripts/lint-vocabulario.mjs` e `scripts/audit-isolation.mjs` **reprovam o
 * build** se uma palavra de nicho aparecer literal em `packages/`. E com razão:
 * "nossa clínica" num template do stagent360 seria texto errado na cara do
 * cliente de uma agência. Então o que varia vem de `comArtigo(v, ...)` e das
 * formas do eixo, e a ESTRUTURA do texto é uma só nos três produtos.
 *
 * ## O que o texto NÃO diz
 *
 * Nenhum prazo, nenhuma condição de pagamento, nenhuma garantia. É a mesma
 * regra dos passos de funil (`scripts/check-funil.ts`: "nenhum passo de
 * mensagem traz texto pronto"): texto escrito por nós sairia no nome da
 * organização prometendo o que não sabemos. O que o modelo traz é a moldura;
 * o compromisso é de quem vende.
 */

/** O corpo do modelo de proposta e de orçamento — mudam o título e o fecho. */
function corpoComercial(v: Vocabulario, tipo: 'proposta' | 'orcamento'): string {
    const aOrganizacao = comArtigo(v, 'organizacao')

    /**
     * O demonstrativo vem junto com a palavra, não concatenado na frase.
     *
     * "proposta" é feminino e "orçamento" é masculino — um `este ${palavra}`
     * escreve "este proposta" no documento que o cliente lê. Não é caso de
     * `comArtigo`: estas duas palavras são nossas, não do vocabulário do nicho,
     * então não há gênero declarado para consultar.
     */
    const esteDocumento = tipo === 'proposta' ? 'esta proposta' : 'este orçamento'

    return `# {{titulo}}

Para: {{cliente}}

Emitido em {{data}}{{validade| }}

{{${MARCADOR_DE_ITENS}}}

{{observacao}}

Qualquer dúvida sobre ${esteDocumento}, fale com {{responsavel}} — ${aOrganizacao} fica à disposição.`
}

/**
 * O corpo do modelo de contrato.
 *
 * Mais seco de propósito, e com um aviso: o texto é uma moldura, não uma minuta.
 * Cláusula jurídica não se gera — quem assina tem de ter escrito.
 */
function corpoDeContrato(v: Vocabulario): string {
    /**
     * `'por'` contrai: "pela clínica", não "por a clínica".
     *
     * É para isto que a tabela de `concordancia.ts` é escrita por extenso —
     * "por" + "a" = "pela" não se parece com nenhum dos dois, e concatenar a
     * preposição com o resultado sem contração põe erro de português no
     * contrato.
     */
    const pelaOrganizacao = comArtigo(v, 'organizacao', 'por')

    return `# {{titulo}}

Contratante: {{cliente}}

Contratada: {{organizacao}}

Data: {{data}}

# Objeto

O presente instrumento tem por objeto a prestação dos itens discriminados abaixo.

{{${MARCADOR_DE_ITENS}}}

# Condições

{{observacao}}

# Aceite

Ao aceitar este documento, o contratante declara ter lido e concordado com as condições acima.

Responsável ${pelaOrganizacao}: {{responsavel}}`
}

export function corpoDoModelo(v: Vocabulario, tipo: TipoDeDocumento): string {
    if (tipo === 'contrato') return corpoDeContrato(v)
    return corpoComercial(v, tipo)
}

/**
 * Os três modelos, prontos para `createMany`.
 *
 * Exportado separado da gravação para o verificador poder conferir o texto sem
 * banco — é o que prova que nenhuma palavra de nicho foi escrita literal.
 */
export function modelosSemente(
    v: Vocabulario,
    workspaceId: string
): { workspaceId: string; name: string; kind: TipoDeDocumento; body: string; isDefault: boolean }[] {
    return TIPOS_DE_DOCUMENTO.map((tipo) => ({
        workspaceId,
        // "Proposta padrão", "Orçamento padrão", "Contrato padrão". O nome entra
        // no `@@unique([workspaceId, name])`, então precisa ser distinto entre os
        // três — e legível, porque é o que aparece no seletor.
        name: `${ROTULO_DO_TIPO[tipo]} padrão`,
        kind: tipo,
        body: corpoDoModelo(v, tipo),
        isDefault: true,
    }))
}

/**
 * Semeia os modelos de uma unidade. Idempotente.
 *
 * `skipDuplicates` em vez de `createMany` seco: esta função é chamada tanto na
 * criação da unidade quanto pela tela de modelos ("restaurar os padrões"), e a
 * segunda chamada não pode explodir no `@@unique`. Também não sobrescreve o que
 * a clínica editou — quem quiser o texto original de volta apaga o modelo e
 * semeia de novo.
 */
export async function semearModelos(
    tx: Prisma.TransactionClient,
    v: Vocabulario,
    workspaceId: string
): Promise<number> {
    const resultado = await tx.proposalTemplate.createMany({
        data: modelosSemente(v, workspaceId),
        skipDuplicates: true,
    })
    return resultado.count
}
