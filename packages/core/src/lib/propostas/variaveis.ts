/**
 * Os marcadores `{{...}}` que um documento aceita.
 *
 * ## Por que um conjunto próprio, e não `CamposDaMesclagem`
 *
 * Os campos de campanha são três (`nome`, `nomeCompleto`, `unidade`) e o
 * comentário em `lib/email/blocos.ts` explica que são curtos **de propósito**:
 * num disparo em massa, campo que falta num contato vira buraco no meio da
 * frase para metade da base.
 *
 * Num documento a conta é outra. A proposta é escrita para UMA pessoa, revisada
 * por quem a manda, e o valor é o motivo de ela existir — `{{total}}` não pode
 * faltar, e se faltar quem revisa vê. Então aqui o conjunto é largo.
 *
 * O que NÃO muda é a regra de substituição: ela é a de `blocos.ts`, importada
 * (`substituirMarcadores`). Marcador desconhecido fica **visível** no texto, e
 * substituição vazia engole a pontuação órfã. Duplicar aquela regra aqui seria
 * reescrever um acerto fino e errar as mesmas frases de novo.
 *
 * ## `{{itens}}` é o único que não é texto
 *
 * Todos os outros resolvem para uma palavra ou um número. `{{itens}}` resolve
 * para a tabela, e por isso ele é tratado em `render.ts`, antes de o texto
 * passar por aqui — se passasse junto, o HTML da tabela seria escapado.
 */
import { substituirMarcadores } from '../email/blocos'

/**
 * O que um documento sabe sobre si.
 *
 * Tudo opcional: o rascunho existe antes de ter valor, validade ou
 * responsável, e a prévia na tela tem de funcionar com ele pela metade.
 */
export interface VariaveisDoDocumento {
    /** Quem recebe. Nome do contato do negócio. */
    cliente?: string | null
    /** Quem manda. Nome da unidade. */
    organizacao?: string | null
    /** "Proposta 1042" — o número que se dita ao telefone. */
    numero?: string | null
    /** O título do documento. */
    titulo?: string | null
    /** Data de emissão, já formatada em pt-BR. */
    data?: string | null
    /** Até quando vale, já formatada. Vazio quando não há prazo. */
    validade?: string | null
    /** O total, já em moeda. */
    total?: string | null
    /** O subtotal, antes do desconto. */
    subtotal?: string | null
    /** O desconto em dinheiro. Vazio quando é zero — ver `PADRAO_DE_QUEDA`. */
    desconto?: string | null
    /** O vendedor responsável. */
    responsavel?: string | null
    /** O profissional que vai executar, quando o negócio tem um. */
    profissional?: string | null
    /** A observação que o vendedor escreveu na revisão. */
    observacao?: string | null
}

/**
 * O que sai quando o campo não tem valor e o marcador não traz queda escrita.
 *
 * **Vazio para todos**, pela mesma razão de `blocos.ts`: uma palavra genérica
 * não conhece a frase em volta. Vazio vem acompanhado de engolir a pontuação
 * órfã, então "Validade: {{validade}}." não deixa um ponto solto atrás de nada.
 *
 * Este mapa também declara **quais** marcadores existem: `{{preco}}` não está
 * aqui, então fica visível no texto em vez de sumir calado — e quem revisa a
 * prévia vê o erro de digitação antes de o documento sair.
 */
const PADRAO_DE_QUEDA: Record<keyof VariaveisDoDocumento, string> = {
    cliente: '',
    organizacao: '',
    numero: '',
    titulo: '',
    data: '',
    validade: '',
    total: '',
    subtotal: '',
    desconto: '',
    responsavel: '',
    profissional: '',
    observacao: '',
}

/** Os marcadores aceitos, para a ajuda do editor. */
export const MARCADORES = Object.keys(PADRAO_DE_QUEDA) as (keyof VariaveisDoDocumento)[]

/**
 * A ajuda que o editor mostra ao lado do campo.
 *
 * Mora aqui e não no componente porque marcador novo tem de aparecer na ajuda
 * no mesmo commit em que passa a funcionar — separados, a lista envelhece e
 * quem escreve o template descobre o marcador por tentativa.
 */
export const AJUDA_DO_MARCADOR: Record<keyof VariaveisDoDocumento, string> = {
    cliente: 'o nome de quem recebe o documento',
    organizacao: 'o nome da unidade que o emite',
    numero: 'o número do documento',
    titulo: 'o título do documento',
    data: 'a data de emissão',
    validade: 'até quando o documento vale',
    total: 'o valor total, já com desconto',
    subtotal: 'o valor antes do desconto',
    desconto: 'o desconto em dinheiro',
    responsavel: 'quem está vendendo',
    profissional: 'quem vai executar',
    observacao: 'a observação escrita na revisão',
}

/** Troca os marcadores pelos valores. `{{itens}}` não passa por aqui — ver `render.ts`. */
export function aplicarVariaveis(texto: string, variaveis: VariaveisDoDocumento): string {
    return substituirMarcadores(texto, variaveis, PADRAO_DE_QUEDA)
}

/**
 * O marcador existe?
 *
 * Usado pela prévia para listar o que o template referencia e não existe —
 * mesma informação que ficar visível no texto dá, mas em forma de aviso.
 */
export function ehMarcador(nome: string): nome is keyof VariaveisDoDocumento {
    return nome in PADRAO_DE_QUEDA
}

/** O marcador da tabela de itens, tratado à parte porque resolve para HTML. */
export const MARCADOR_DE_ITENS = 'itens'

/**
 * Os marcadores que o texto usa, na ordem em que aparecem, sem repetir.
 *
 * Alimenta o aviso "este modelo cita {{preco}}, que não existe" na tela de
 * template. A expressão é a mesma de `substituirMarcadores`, deliberadamente:
 * o que a prévia lista tem de ser exatamente o que o motor reconhece.
 */
export function marcadoresCitados(texto: string): string[] {
    const achados = new Set<string>()
    for (const m of texto.matchAll(/\{\{\s*(\w+)\s*(?:\|[^}]*)?\}\}/g)) {
        achados.add(m[1])
    }
    return [...achados]
}
