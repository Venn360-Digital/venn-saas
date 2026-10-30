/**
 * Os números da busca — **um lugar só**, e por que isso importa.
 *
 * O piso de similaridade e a quantidade de trechos decidem o que o agente vê.
 * Até aqui cada leitor tinha a sua cópia, e as três divergiam:
 *
 *   - `retriever.ts` lia `AI_RAG_MIN_SIMILARITY` com padrão `0.35`;
 *   - `scripts/medir-recuperacao.ts` tinha `const PISO = 0.35` **cravado**, então
 *     mudar a variável de ambiente fazia o medidor desenhar a barra e marcar
 *     "raspando o piso" contra um piso que não era mais o do atendimento;
 *   - `EnsaioTab.tsx` marcava o trecho como fraco abaixo de `0.45`, um terceiro
 *     número que não era derivado de nenhum dos dois.
 *
 * É a mesma classe de defeito que `embeddings.ts` foi criado para eliminar: o
 * número que governa a busca declarado em mais de um arquivo. Quem mede e quem
 * ensaia precisam falar do **mesmo** piso que o atendimento usa, senão a medição
 * aprova o que a produção reprova.
 *
 * Este módulo é `lib`, sem `server-only` e sem Prisma, de propósito: ele é lido
 * pelo atendimento (Worker), pelas rotas, pelos scripts em Node e — nas partes
 * que são constante pura — pela tela.
 */

/**
 * O piso padrão, com `text-embedding-3-small`.
 *
 * Separa "fala do mesmo assunto" de "é o texto menos distante que eu tinha".
 * **Precisa ser reavaliado se o modelo de embedding mudar**: a escala de
 * similaridade é propriedade do modelo, não do acervo.
 */
export const PISO_PADRAO = 0.35

/** Trechos entregues ao modelo por resposta. Zero desliga a busca. */
export const TRECHOS_PADRAO = 4

/**
 * Acima do piso, mas por tão pouco que qualquer reescrita da pergunta derruba.
 *
 * Não é limiar de corte: é o que faz o medidor e o console dizerem "este
 * documento só é encontrado raspando". Um trecho que entra a 0,36 com piso 0,35
 * deixa de entrar quando o paciente perguntar com outras palavras — e isso é
 * conserto de **texto**, não de parâmetro.
 */
export const FOLGA_MINIMA = 0.1

function numeroDoAmbiente(bruto: string | undefined, min: number, max: number): number | null {
    const valor = Number(bruto)
    return Number.isFinite(valor) && valor >= min && valor <= max ? valor : null
}

/** O piso em uso. Ajustável por ambiente porque depende do acervo de cada conta. */
export function pisoDeSimilaridade(): number {
    return numeroDoAmbiente(process.env.AI_RAG_MIN_SIMILARITY, 0, 1) ?? PISO_PADRAO
}

/**
 * Quantos trechos o **atendimento** entrega ao modelo.
 *
 * É este o número que a medição tem de usar. Medir com um `limite` maior que o
 * da produção infla a taxa de acerto: um documento que chega em 5º lugar conta
 * como acerto na planilha e nunca chega ao modelo na conversa real.
 */
export function trechosDoAtendimento(): number {
    return numeroDoAmbiente(process.env.AI_RAG_CHUNKS, 0, 50) ?? TRECHOS_PADRAO
}
