/**
 * Os modelos de cada documento — o que o botão "Inserir modelo" escreve.
 *
 * **Conteúdo, não código.** Cada entrada é o `.md` que o André fornece, colado
 * como está. Fica em TypeScript e não em arquivo `.md` solto por uma razão
 * prática: importar `.md` como texto exigiria configuração de bundler em dois
 * alvos (aplicação e Worker), e o ganho seria nenhum — ninguém edita isto fora
 * de uma revisão de código.
 *
 * **Vazio cai no esqueleto.** Enquanto um slug não tem modelo escrito aqui,
 * `modeloDoDocumento` devolve só os cabeçalhos do catálogo. O botão funciona nos
 * oito desde já, e cada modelo real entra sem tocar em tela nem em rota.
 *
 * **Os cabeçalhos de 2º nível TÊM de ser os do catálogo**, e isso é conferido
 * por teste.
 *
 * O motivo mudou de forma, e o comentário antigo citava um sintoma que a tela
 * **não produz mais**: a mensagem "sem conteúdo em: …" foi removida quando se
 * descobriu que as seções são da clínica, não nossas. O que a tela mostra hoje é
 * um contador de trechos — e aí está o problema de verdade. Um modelo cujos
 * cabeçalhos divergem do catálogo exibe "0 trechos" com **ícone de aprovado**,
 * porque zero trecho não é erro de estrutura. A pessoa insere o modelo, lê um
 * visto verde, e salva um documento que o método não reconhece.
 *
 * É a mesma forma de defeito de sempre: um valor em dois lugares, e o segundo
 * não acompanha. O teste é o que impede o segundo de divergir.
 */

/**
 * Modelo por slug. Ausente = sem modelo escrito ainda.
 *
 * Para acrescentar: cole o `.md` inteiro, começando por `# <titulo do catálogo>`
 * e usando `##` exatamente nas seções que o catálogo declara para aquele
 * documento. `npm run test:treinamento` reprova a divergência.
 */
export const MODELOS: Readonly<Record<string, string>> = {
    // Aguardando os `.md` do André. Um por slug:
    //   'instrucoes-centrais': `# Instruções centrais\n\n## Identidade do agente\n…`,
}

export function modeloEscrito(slug: string): string | undefined {
    return MODELOS[slug]
}
