/**
 * A menção numa nota interna: quem foi marcado, e como o texto mostra isso.
 *
 * É o gesto único do item 6 — comentar e marcar `@alguém` é o que põe a pessoa
 * a **colaborar** na conversa. Não existe botão de assinar: a visibilidade é
 * consequência de colaborar, nunca uma inscrição à parte. (Medido no
 * respond.io, em `docs/re-respond-io/`: o modelo deles não tem entidade de
 * follow; tem comentário com menção e o filtro "Colaborações" — de onde o nome
 * veio.)
 *
 * ## O formato guarda o id, e não o nome
 *
 * A menção é gravada como `@[Ana Paula](cku123…)`. A alternativa — guardar
 * `@Ana Paula` e resolver pelo nome na leitura — quebra com **duas Anas na
 * mesma clínica**, e quebra de novo quando alguém troca o nome no perfil: a
 * nota passaria a marcar outra pessoa, ou ninguém.
 *
 * E o id fica dentro do próprio texto em vez de numa lista ao lado por um
 * motivo: com dois campos, eles divergem. Uma nota dizendo "@Ana" com uma
 * lista contendo o Carlos é um estado que não dá para renderizar honestamente,
 * e é o tipo de coisa que só aparece em produção. Um campo, uma verdade.
 *
 * O nome é copiado junto porque a nota é **registro histórico**: ela mostra o
 * nome que a pessoa tinha quando a nota foi escrita, igual a qualquer citação.
 * Quem precisa do nome de agora resolve pelo id.
 */

/** Uma marcação encontrada no texto. */
export interface Mencao {
    /** O id do usuário marcado. */
    userId: string
    /** O nome como estava quando a nota foi escrita. */
    nome: string
}

/**
 * `@[Nome](id)`, **uma instância nova por chamada**.
 *
 * O nome aceita qualquer coisa menos `]`, porque nome de gente tem acento,
 * hífen, apóstrofo e espaço. O id é restrito ao alfabeto de cuid/uuid — é o
 * que impede `@[x](javascript:…)` de ser lido como menção, e o que faz um
 * parêntese solto em prosa não virar marcação.
 *
 * **Função e não constante, e isto não é estilo.** Uma regex `/g` guarda
 * `lastIndex` entre usos, e `matchAll` **copia** esse índice ao clonar a
 * expressão. Com a regex compartilhada num módulo, um `temMencao()` — que usa
 * `.test()` e avança o cursor — faz o `extrairMencoes()` seguinte começar do
 * meio do texto e **perder a primeira menção**.
 *
 * Não é teórico: foi o que aconteceu. O caso "duas Anas" reprovou devolvendo
 * só a segunda, e o defeito dependia da ordem das chamadas — em produção seria
 * uma nota marcando certo e a próxima perdendo quem foi marcado, sem erro
 * nenhum em log.
 */
function mencaoRegex(): RegExp {
    return /@\[([^\]\n]{1,80})\]\(([A-Za-z0-9_-]{1,64})\)/g
}

/**
 * As pessoas marcadas, sem repetição e na ordem em que aparecem.
 *
 * Sem repetição porque marcar alguém duas vezes na mesma nota é ênfase, não
 * dois colaboradores — e a tabela tem chave única por (conversa, pessoa) de todo
 * jeito. Manter a ordem é o que faz o teste ler como o texto.
 */
export function extrairMencoes(texto: string): Mencao[] {
    if (!texto) return []

    const vistos = new Set<string>()
    const achadas: Mencao[] = []

    for (const m of texto.matchAll(mencaoRegex())) {
        const userId = m[2]
        if (vistos.has(userId)) continue
        vistos.add(userId)
        achadas.push({ userId, nome: m[1] })
    }

    return achadas
}

/** Só os ids, que é o que a gravação do colaborador precisa. */
export function idsMencionados(texto: string): string[] {
    return extrairMencoes(texto).map((m) => m.userId)
}

/** Tem alguma marcação? Serve para não ir ao banco por nada. */
export function temMencao(texto: string): boolean {
    return mencaoRegex().test(texto)
}

export type PedacoDeNota =
    | { tipo: 'texto'; texto: string }
    | { tipo: 'mencao'; userId: string; nome: string }

/**
 * O texto partido em pedaços, para a nota renderizar a menção em destaque.
 *
 * Devolve pedaços e não HTML pelo mesmo motivo do analisador de marcação do
 * WhatsApp: texto que passa por aqui vem de quem atende, e string de HTML no
 * caminho é o que transforma um `<img onerror>` em injeção.
 */
export function partirNota(texto: string): PedacoDeNota[] {
    if (!texto) return []

    const pedacos: PedacoDeNota[] = []
    let cursor = 0

    for (const m of texto.matchAll(mencaoRegex())) {
        const inicio = m.index ?? 0
        if (inicio > cursor) {
            pedacos.push({ tipo: 'texto', texto: texto.slice(cursor, inicio) })
        }
        pedacos.push({ tipo: 'mencao', userId: m[2], nome: m[1] })
        cursor = inicio + m[0].length
    }

    if (cursor < texto.length) {
        pedacos.push({ tipo: 'texto', texto: texto.slice(cursor) })
    }

    return pedacos
}

/**
 * O mesmo texto como se lê numa linha — `@Ana Paula`, sem a sintaxe.
 *
 * Para a prévia da nota no fio e para o corpo do e-mail de aviso: ali mostrar
 * `@[Ana Paula](cku123)` seria vazar a implementação na cara de quem lê.
 */
export function notaEmTextoSimples(texto: string): string {
    return partirNota(texto)
        .map((p) => (p.tipo === 'mencao' ? `@${p.nome}` : p.texto))
        .join('')
}

/**
 * Quem a menção **de fato** põe a colaborar.
 *
 * Três recusas, e nenhuma é detalhe:
 *
 * 1. **quem escreveu** não se chama a si mesmo ao se marcar por engano;
 * 2. **o responsável** já vê a conversa — virar colaborador dela não
 *    acrescenta nada, e deixaria a lista de colaboradores repetindo o nome que
 *    já está no cartão;
 * 3. **quem não é da unidade** não entra. A menção abre um buraco na parede do
 *    departamento de propósito, mas nunca na parede da **unidade** — essa
 *    continua fechada, e é a diferença entre pedir ajuda a uma colega e expor
 *    a conversa de um paciente para outra clínica.
 *
 * Pura: recebe a lista de quem é da unidade e decide. Quem vai ao banco é a
 * rota.
 */
export function quemPassaAColaborar(entrada: {
    mencionados: string[]
    autorId: string
    donoId: string | null
    idsDaUnidade: string[]
}): string[] {
    const daUnidade = new Set(entrada.idsDaUnidade)

    return entrada.mencionados.filter(
        (id) => id !== entrada.autorId && id !== entrada.donoId && daUnidade.has(id)
    )
}
