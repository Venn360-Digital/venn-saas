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
 * sete desde já, e cada modelo real entra sem tocar em tela nem em rota.
 *
 * **Os cabeçalhos de 2º nível TÊM de ser os do catálogo**, e isso é conferido
 * por teste. Se divergirem, a conferência de estrutura passa a acusar falta no
 * próprio modelo que acabou de ser inserido — a pessoa clica em "Inserir
 * modelo" e a tela responde "sem conteúdo em: …", o que destrói a confiança na
 * conferência inteira. É a mesma forma de defeito de sempre: um valor em dois
 * lugares, e o segundo não acompanha.
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
