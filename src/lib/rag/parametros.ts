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

/**
 * Trechos entregues ao modelo por resposta. Zero desliga a busca.
 *
 * **Era 4, e subiu para 5 com a busca híbrida.** O corte do acervo passou de
 * caractere cego para seção do autor, e o comentário do chunker já avisava que
 * "trecho menor e mais preciso pede mais trechos por resposta" — o 4 não
 * acompanhou. Com o teto por documento, cinco vagas passam a caber em pelo
 * menos duas fontes, que é o que uma pergunta de preço precisa: o serviço e a
 * condição de pagamento moram em documentos diferentes.
 */
export const TRECHOS_PADRAO = 5

/**
 * Quantos candidatos cada perna da busca traz, antes da fusão.
 *
 * Doze e não cinco: a fusão só tem como corrigir a ordem se receber mais do que
 * vai entregar. Com 12 por perna, um trecho que o vetor põe em 9º e o lexical
 * põe em 1º ainda tem chance de entrar — e é exatamente o caso das perguntas de
 * preço, onde o número casa no texto e não no vetor.
 *
 * Custa duas consultas num plano só, numa ida ao banco. Não custa embedding nem
 * token: o que o modelo recebe continua sendo `TRECHOS_PADRAO`.
 */
export const CANDIDATOS_PADRAO = 12

/**
 * Teto de trechos do mesmo documento numa resposta.
 *
 * Existe porque um documento bem escrito ocupava a resposta inteira: a medição
 * mostrou `faq` em primeiro lugar em 13 de 14 recuperações, por ser escrita em
 * forma de pergunta. Três de cinco deixa o documento dominante responder sem
 * calar os outros.
 */
export const MAX_POR_DOCUMENTO = 3

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

/** Candidatos por perna da busca, antes da fusão. */
export function candidatosDaBusca(): number {
    return numeroDoAmbiente(process.env.AI_RAG_CANDIDATOS, 1, 200) ?? CANDIDATOS_PADRAO
}

/** Teto por documento na resposta. Zero desliga o teto. */
export function maxPorDocumento(): number {
    return numeroDoAmbiente(process.env.AI_RAG_MAX_POR_DOC, 0, 50) ?? MAX_POR_DOCUMENTO
}
