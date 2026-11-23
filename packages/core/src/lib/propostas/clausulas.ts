import type { Secao } from './secoes'

/**
 * A biblioteca de cláusulas — o esqueleto de um contrato, sem o compromisso.
 *
 * ## O que ela é, e o que não é
 *
 * É o conjunto de cláusulas que todo contrato de prestação de serviço tem, com
 * o texto que **não depende** da organização: quem é quem, o que é o objeto,
 * que há confidencialidade, que há proteção de dados. O que depende — prazo,
 * multa, foro, forma de pagamento — fica marcado como **a definir**, porque
 * prometer é de quem assina (a mesma regra da IA que monta modelo). Texto
 * escrito por nós prometendo em nome da organização seria a cláusula errada no
 * dia em que alguém a invocasse.
 *
 * Não é parecer jurídico: é ponto de partida que a organização revisa com quem
 * revisa contrato. O rodapé de cada cláusula não diz isso porque o documento é
 * do cliente, não nosso — o aviso fica na tela, ao inserir.
 *
 * ## Por que cláusula é seção `texto`
 *
 * Um tipo `clausula` novo exigiria render, editor, schema plano da IA e
 * verificador. Cláusula é um título e um corpo — exatamente `texto`. O que a
 * distingue é a biblioteca de onde vem, não a forma.
 */

export interface Clausula {
    chave: string
    titulo: string
    corpo: string
}

export const CLAUSULAS: readonly Clausula[] = [
    {
        chave: 'partes',
        titulo: 'Das partes',
        corpo: 'Pelo presente instrumento, {{organizacao.nome}}, inscrita no CNPJ {{organizacao.cnpj}}, com sede em {{organizacao.endereco}}, doravante CONTRATADA, e {{cliente.nome}}, doravante CONTRATANTE, celebram este contrato.',
    },
    {
        chave: 'objeto',
        titulo: 'Do objeto',
        corpo: 'O objeto deste contrato é a prestação, pela CONTRATADA, dos serviços descritos na tabela de itens deste documento, nas condições aqui estabelecidas.',
    },
    {
        chave: 'vigencia',
        titulo: 'Da vigência',
        corpo: 'Este contrato vigora a partir de {{documento.data}} pelo prazo de (prazo a definir), podendo ser renovado por acordo escrito entre as partes.',
    },
    {
        chave: 'valor',
        titulo: 'Do valor e do pagamento',
        corpo: 'Pelos serviços, a CONTRATANTE pagará à CONTRATADA o valor total de {{documento.total}}, na forma de pagamento (a definir) e nas datas (a definir).',
    },
    {
        chave: 'obrigacoes_contratada',
        titulo: 'Das obrigações da contratada',
        corpo: 'A CONTRATADA se obriga a executar os serviços com diligência e técnica adequadas, a manter a CONTRATANTE informada do andamento e a comunicar qualquer fato que possa afetar a execução.',
    },
    {
        chave: 'obrigacoes_contratante',
        titulo: 'Das obrigações da contratante',
        corpo: 'A CONTRATANTE se obriga a fornecer as informações e os acessos necessários à execução, a cumprir os prazos de aprovação e a efetuar os pagamentos nas condições acordadas.',
    },
    {
        chave: 'confidencialidade',
        titulo: 'Da confidencialidade',
        corpo: 'As partes manterão em sigilo as informações a que tiverem acesso em razão deste contrato, não as divulgando a terceiros sem autorização escrita, durante a vigência e pelo período de (prazo a definir) após o seu término.',
    },
    {
        chave: 'dados',
        titulo: 'Da proteção de dados',
        corpo: 'As partes tratarão os dados pessoais envolvidos na execução deste contrato em conformidade com a Lei Geral de Proteção de Dados (Lei nº 13.709/2018), limitando-se às finalidades aqui previstas.',
    },
    {
        chave: 'rescisao',
        titulo: 'Da rescisão',
        corpo: 'Qualquer das partes poderá rescindir este contrato mediante aviso prévio por escrito de (prazo a definir). O descumprimento de obrigação aqui prevista autoriza a rescisão pela parte prejudicada, nas condições (a definir).',
    },
    {
        chave: 'foro',
        titulo: 'Do foro',
        corpo: 'As partes elegem o foro de (comarca a definir) para dirimir as questões oriundas deste contrato.',
    },
]

/** A cláusula como seção `texto`, pronta para entrar no canvas. */
export function secaoDaClausula(chave: string): Secao | null {
    const c = CLAUSULAS.find((x) => x.chave === chave)
    if (!c) return null
    return { id: `cl${chave}${Date.now().toString(36).slice(-4)}`, tipo: 'texto', titulo: c.titulo, corpo: c.corpo }
}
