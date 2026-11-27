import { BRAND_HEX } from '../palette'
import type { Vocabulario } from '../vocabulario'
import { comArtigo } from '../concordancia'
import type { Secao } from './secoes'
import type { TemaDoModelo } from './tema'

/**
 * Os cinco modelos de proposta que a unidade recebe prontos.
 *
 * ## Por que eles existem
 *
 * A semente anterior gravava **corpo de texto da v1**: três blocos de menos de
 * 400 caracteres, sem seção nenhuma e sem tema. Era o que o André homologava
 * em 27/11/2026 quando concluiu que o módulo era "apenas texto" — e ele estava
 * certo sobre o que viu. A máquina de seções existia inteira, com capa, cartões
 * de escopo, linha do tempo e cartões de preço, e **nada a alimentava**.
 *
 * Premissa dele, do mesmo dia: o documento nasce sempre de um modelo, e é
 * preciso haver pelo menos cinco, do mais simples ao mais bonito. Estes são
 * eles. A IA continua existindo para quem quiser o seu próprio — ela não foi
 * desligada nem afastada; ela deixou de ser o único caminho para ver um
 * documento bonito.
 *
 * ## A escada
 *
 * | # | Modelo | Seções | Identidade |
 * |---|---|---|---|
 * | 1 | Essencial | 4 | nenhuma: usa o tema do app |
 * | 2 | Carta | 5 | um acento, capa clara |
 * | 3 | Comercial | 8 | um acento, fonte técnica |
 * | 4 | Consultiva | 11 | dois acentos |
 * | 5 | Estúdio | 12 | três acentos, capa escura |
 *
 * A escada é de **estrutura e identidade juntas**, não só de enfeite: o
 * Essencial serve quem manda orçamento por WhatsApp e quer uma folha; o Estúdio
 * serve quem apresenta um projeto e precisa de capa, sumário e fechamento.
 *
 * ## O que estes modelos NÃO escrevem
 *
 * Preço, prazo, garantia, multa e percentual de resultado ficam **em branco**,
 * com o rótulo preenchido para a pessoa saber o que falta. É a mesma regra que
 * `esvaziarCompromissos` impõe à IA, e ela vale aqui pela mesma razão: quem
 * promete é quem assina. Um modelo nosso que já viesse com "garantia de 12
 * meses" comprometeria a unidade sem ninguém ter decidido.
 *
 * Onde o número tem de aparecer, aparece como **variável** — `{{documento.total}}`
 * vem do cálculo, nunca digitado. É o que mantém a fronteira de dinheiro.
 *
 * ## Módulo neutro
 *
 * Sem `server-only`: a tela de modelos mostra a escada antes de semear, e o
 * bundle do cliente é varrido. Ver [[server-only-no-bundle-do-cliente]].
 */

export interface ModeloPronto {
    /** Estável, e usado como sufixo de id na semente: `seedm_<chave>`. */
    chave: string
    nome: string
    /** A frase que a tela mostra para explicar para quem ele serve. */
    resumo: string
    tema: TemaDoModelo
    secoes: Secao[]
}

/**
 * `Secao` sem o `id`, **distribuindo sobre a união**.
 *
 * `Omit<Secao, 'id'>` direto não serve: `Omit` achata a união discriminada num
 * objeto só, e aí o TypeScript perde a discriminação por `tipo` — toda seção
 * passa a ser lida com os campos da primeira variante, e `titulo` em `carta`
 * vira erro. O `T extends unknown` é o que força a distribuição; foi o que
 * produziu 41 erros antes de entrar.
 */
type SemId<T> = T extends unknown ? Omit<T, 'id'> : never

/** Numera os ids dentro de um modelo: `s1`, `s2`… como o editor espera. */
function comIds(secoes: SemId<Secao>[]): Secao[] {
    return secoes.map((s, i) => ({ ...s, id: `s${i + 1}` }) as Secao)
}

export function modelosProntos(v: Vocabulario): ModeloPronto[] {
    /** "a clínica", "o estúdio" — a concordância é do vocabulário de cada app. */
    const aOrganizacao = comArtigo(v, 'organizacao')
    const oServico = comArtigo(v, 'servico')

    /**
     * A abertura que quase todo modelo usa, em graus diferentes de formalidade.
     * Sai daqui para os cinco não divergirem em saudação.
     */
    const saudacao =
        'Olá, {{cliente.primeiro_nome}}.\n\n' +
        `Obrigado pelo interesse. Abaixo está o que ${aOrganizacao} propõe, com o que está incluso, ` +
        'as condições e o valor.'

    const condicoesPadrao =
        'Validade da proposta: {{documento.validade}}.\n\n' +
        'Forma de pagamento: a combinar.\n\n' +
        'Prazo de execução: a combinar.'

    const aceitePadrao =
        'Ao aceitar, {{cliente.nome}} concorda com o escopo, os valores e as condições descritos ' +
        'neste documento ({{documento.numero}}, emitido em {{documento.data}}).'

    return [
        // ── 1. Essencial ────────────────────────────────────────────────────
        {
            chave: 'essencial',
            nome: 'Essencial',
            resumo: 'Uma folha: a abertura, os itens, as condições e o aceite.',
            tema: { acentos: [], fonte: 'padrao', capa: 'clara', logo: true },
            secoes: comIds([
                { tipo: 'texto', titulo: '{{documento.titulo}}', corpo: saudacao },
                { tipo: 'itens', titulo: 'Itens e valores', fixa: true },
                { tipo: 'condicoes', titulo: 'Condições', corpo: condicoesPadrao },
                { tipo: 'aceite', texto: aceitePadrao, fixa: true },
            ]),
        },

        // ── 2. Carta ────────────────────────────────────────────────────────
        {
            chave: 'carta',
            nome: 'Carta',
            resumo: 'Capa e carta de apresentação antes do preço. Para quem apresenta a proposta.',
            tema: { acentos: [BRAND_HEX.teal], fonte: 'padrao', capa: 'clara', logo: true },
            secoes: comIds([
                { tipo: 'capa', titulo: '{{documento.titulo}}', subtitulo: `Preparada para {{cliente.nome}} por ${aOrganizacao}.` },
                {
                    tipo: 'carta',
                    titulo: 'Apresentação',
                    corpo:
                        saudacao +
                        '\n\nQualquer ponto pode ser ajustado antes do aceite. ' +
                        'Estou à disposição para conversar sobre o que fizer mais sentido para você.' +
                        '\n\n{{responsavel.nome}}',
                },
                { tipo: 'itens', titulo: 'Itens e valores', fixa: true },
                { tipo: 'condicoes', titulo: 'Condições', corpo: condicoesPadrao },
                { tipo: 'aceite', texto: aceitePadrao, fixa: true },
            ]),
        },

        // ── 3. Comercial ────────────────────────────────────────────────────
        {
            chave: 'comercial',
            nome: 'Comercial',
            resumo: 'Escopo em cartões e cartão de investimento. O formato mais usado em venda consultiva.',
            tema: { acentos: [BRAND_HEX.navy], fonte: 'tecnica', capa: 'clara', logo: true },
            secoes: comIds([
                { tipo: 'capa', titulo: '{{documento.titulo}}', subtitulo: 'Proposta comercial para {{cliente.nome}}.' },
                { tipo: 'carta', titulo: 'O que entendi da sua necessidade', corpo: saudacao },
                {
                    tipo: 'escopo',
                    titulo: `O que está incluso`,
                    cartoes: [
                        { titulo: 'Entrega principal', descricao: `Descreva aqui ${oServico} central desta proposta.` },
                        { titulo: 'Acompanhamento', descricao: 'Descreva o acompanhamento que vai junto.' },
                        { titulo: 'Suporte', descricao: 'Descreva o suporte depois da entrega.' },
                    ],
                },
                { tipo: 'itens', titulo: 'Itens e valores', fixa: true },
                {
                    tipo: 'investimento',
                    titulo: 'Investimento',
                    introducao: 'O valor abaixo vem dos itens desta proposta.',
                    cartoes: [
                        {
                            titulo: 'Total desta proposta',
                            // Variável, nunca digitado: o dinheiro vem do cálculo.
                            valor: '{{documento.total}}',
                            periodo: '',
                            inclui: ['Tudo o que está no escopo acima'],
                        },
                    ],
                },
                { tipo: 'condicoes', titulo: 'Condições', corpo: condicoesPadrao },
                { tipo: 'aceite', texto: aceitePadrao, fixa: true },
                {
                    tipo: 'fechamento',
                    chamada: 'Obrigado.',
                    corpo: 'Qualquer dúvida, fale comigo.\n\n{{responsavel.nome}} · {{organizacao.telefone}}',
                },
            ]),
        },

        // ── 4. Consultiva ───────────────────────────────────────────────────
        {
            chave: 'consultiva',
            nome: 'Consultiva',
            resumo: 'Sumário, números em destaque, fases e garantia. Para projeto com etapas.',
            tema: { acentos: [BRAND_HEX.navy, BRAND_HEX.amber], fonte: 'tecnica', capa: 'clara', logo: true },
            secoes: comIds([
                { tipo: 'capa', titulo: '{{documento.titulo}}', subtitulo: 'Proposta preparada para {{cliente.nome}}.' },
                { tipo: 'sumario' },
                { tipo: 'carta', titulo: 'Apresentação', corpo: saudacao },
                {
                    tipo: 'destaques',
                    titulo: 'Em resumo',
                    // Valor VAZIO: número de resultado é compromisso de quem assina.
                    itens: [
                        { valor: '', rotulo: 'Prazo de entrega', legenda: 'Preencha depois de fechar o escopo' },
                        { valor: '', rotulo: 'Etapas', legenda: 'Quantas fases o projeto tem' },
                        { valor: '', rotulo: 'Acompanhamento', legenda: 'Por quanto tempo' },
                    ],
                },
                {
                    tipo: 'escopo',
                    titulo: 'O que será entregue',
                    cartoes: [
                        { titulo: 'Entrega principal', descricao: `Descreva ${oServico} central.` },
                        { titulo: 'Entregas de apoio', descricao: 'Descreva o que acompanha a entrega principal.' },
                        { titulo: 'O que não está incluso', descricao: 'Deixe explícito o que fica de fora.' },
                    ],
                },
                {
                    tipo: 'fases',
                    titulo: 'Como vamos trabalhar',
                    // Prazo VAZIO, pela mesma razão do destaque.
                    fases: [
                        { nome: 'Alinhamento', descricao: 'O que acontece no começo.', prazo: '', responsavel: '' },
                        { nome: 'Execução', descricao: 'O corpo do trabalho.', prazo: '', responsavel: '' },
                        { nome: 'Entrega', descricao: 'Como termina e o que fica.', prazo: '', responsavel: '' },
                    ],
                },
                { tipo: 'itens', titulo: 'Itens e valores', fixa: true },
                {
                    tipo: 'investimento',
                    titulo: 'Investimento',
                    introducao: 'O total vem dos itens acima.',
                    cartoes: [
                        { titulo: 'Total desta proposta', valor: '{{documento.total}}', periodo: '', inclui: ['Todo o escopo descrito'] },
                    ],
                },
                {
                    tipo: 'garantia',
                    titulo: 'Garantia e bônus',
                    // Texto VAZIO: garantia é compromisso.
                    blocos: [{ titulo: 'Garantia', texto: '' }],
                },
                { tipo: 'condicoes', titulo: 'Condições', corpo: condicoesPadrao },
                { tipo: 'aceite', texto: aceitePadrao, fixa: true },
                { tipo: 'fechamento', chamada: 'Obrigado.', corpo: '{{responsavel.nome}} · {{organizacao.telefone}}' },
            ]),
        },

        // ── 5. Estúdio ──────────────────────────────────────────────────────
        {
            chave: 'estudio',
            nome: 'Estúdio',
            resumo: 'Capa escura, três acentos e o documento completo. O mais apresentável dos cinco.',
            /**
             * Três acentos e capa escura: é o desenho da proposta que o André
             * tomou como referência em 27/11/2026, onde cada bloco de cartões
             * recebe uma cor diferente e a capa inverte o documento. Ver
             * `variaveisDoTema`, que distribui os acentos por posição.
             */
            tema: {
                acentos: [BRAND_HEX.amber, BRAND_HEX.sky, BRAND_HEX.mintDeep],
                fonte: 'tecnica',
                capa: 'escura',
                logo: true,
            },
            secoes: comIds([
                { tipo: 'capa', titulo: '{{documento.titulo}}', subtitulo: 'Proposta comercial · {{cliente.nome}}' },
                { tipo: 'sumario' },
                {
                    tipo: 'carta',
                    titulo: 'Apresentação',
                    corpo: saudacao + '\n\n{{responsavel.nome}}',
                },
                {
                    tipo: 'destaques',
                    titulo: 'Em números',
                    itens: [
                        { valor: '', rotulo: 'Prazo', legenda: 'Do aceite à entrega' },
                        { valor: '', rotulo: 'Etapas', legenda: 'Quantas fases' },
                        { valor: '', rotulo: 'Suporte', legenda: 'Depois da entrega' },
                    ],
                },
                {
                    tipo: 'escopo',
                    titulo: 'O que será entregue',
                    cartoes: [
                        { titulo: 'Entrega principal', descricao: `Descreva ${oServico} central desta proposta.` },
                        { titulo: 'Entregas de apoio', descricao: 'Descreva o que acompanha.' },
                        { titulo: 'O que não está incluso', descricao: 'Deixe explícito o que fica de fora.' },
                    ],
                },
                {
                    tipo: 'fases',
                    titulo: 'Como vamos trabalhar',
                    fases: [
                        { nome: 'Alinhamento', descricao: 'Reunião inicial e coleta do que for preciso.', prazo: '', responsavel: '' },
                        { nome: 'Execução', descricao: 'O corpo do trabalho, com validações no caminho.', prazo: '', responsavel: '' },
                        { nome: 'Entrega', descricao: 'Ajustes finais, treinamento e virada.', prazo: '', responsavel: '' },
                    ],
                },
                { tipo: 'itens', titulo: 'Itens e valores', fixa: true },
                {
                    tipo: 'investimento',
                    titulo: 'Investimento',
                    introducao: 'O total vem dos itens desta proposta.',
                    cartoes: [
                        { titulo: 'Total desta proposta', valor: '{{documento.total}}', periodo: '', inclui: ['Todo o escopo descrito acima'] },
                        { titulo: 'Acompanhamento mensal', valor: '', periodo: 'por mês', inclui: ['Descreva o que o acompanhamento inclui'] },
                    ],
                },
                {
                    tipo: 'garantia',
                    titulo: 'Garantia e bônus',
                    blocos: [
                        { titulo: 'Garantia', texto: '' },
                        { titulo: 'Bônus', texto: '' },
                    ],
                },
                { tipo: 'condicoes', titulo: 'Condições', corpo: condicoesPadrao },
                { tipo: 'aceite', texto: aceitePadrao, fixa: true },
                {
                    tipo: 'fechamento',
                    chamada: 'Obrigado.',
                    corpo:
                        'Fico à disposição para qualquer ajuste antes do aceite.\n\n' +
                        '{{responsavel.nome}} · {{organizacao.telefone}}\n{{organizacao.nome}} · {{organizacao.cnpj}}',
                },
            ]),
        },
    ]
}
