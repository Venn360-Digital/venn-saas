/**
 * O formulário de captura — a validação do envio e o que vira ficha.
 *
 *   npm run test:formularios
 *
 * Roda em Node o módulo puro que a página pública, a rota de envio e o editor
 * compartilham. O que protege, em ordem de importância:
 *
 * 1. **o que o portão de publicar recusa** — formulário sem jeito de falar com
 *    o lead captura resposta e não captura lead;
 * 2. **a validação por tipo**, com o erro embaixo do campo certo;
 * 3. **o mapeamento para a ficha**: telefone em dígitos com o país, e-mail em
 *    minúsculas, observações somadas.
 */
import './lib/marca-de-teste.ts'

import {
    CONFIGURACAO_PADRAO,
    camposIniciais,
    digitosDoTelefone,
    extrairContato,
    idParaCampo,
    lerCampos,
    lerConfiguracao,
    motivoParaNaoPublicar,
    resumoDasRespostas,
    validarEnvio,
    type Campo,
} from '@venn/core/lib/formularios/schema'

let passou = 0
let falhou = 0

function conferir(nome: string, real: unknown, esperado: unknown) {
    const a = JSON.stringify(real)
    const b = JSON.stringify(esperado)
    if (a === b) {
        passou++
        console.log(`  ok  ${nome}`)
    } else {
        falhou++
        console.log(`  XX  ${nome}\n        esperado: ${b}\n        veio:     ${a}`)
    }
}

const campos = camposIniciais()

console.log('\n— o portão de publicar —\n')

conferir('os campos iniciais podem ser publicados', motivoParaNaoPublicar(campos), null)
conferir('sem campos não publica', motivoParaNaoPublicar([]) !== null, true)
conferir(
    'sem telefone nem e-mail mapeado não publica',
    motivoParaNaoPublicar([{ id: 'nome', tipo: 'texto', rotulo: 'Nome', obrigatorio: true, largura: 'cheia', mapeia: 'nome' }]) !== null,
    true
)
conferir(
    'escolha sem opções não publica',
    motivoParaNaoPublicar([
        ...campos,
        { id: 'interesse', tipo: 'selecao', rotulo: 'Interesse', obrigatorio: false, largura: 'cheia', mapeia: 'nenhum', opcoes: [] },
    ]) !== null,
    true
)
conferir(
    'ids repetidos não publicam',
    motivoParaNaoPublicar([...campos, { ...campos[0] }]) !== null,
    true
)

console.log('\n— a validação do envio —\n')

conferir(
    'envio completo passa, com telefone em dígitos e e-mail em minúsculas',
    validarEnvio(campos, { nome: ' Ana Paula ', whatsapp: '(31) 98850-1161', email: 'ANA@Exemplo.com' }),
    { ok: true, valores: { nome: 'Ana Paula', whatsapp: '5531988501161', email: 'ana@exemplo.com' } }
)
conferir(
    'obrigatório vazio é erro no campo certo, e o opcional vazio não é erro',
    validarEnvio(campos, { nome: '', whatsapp: '31988501161' }),
    { ok: false, erros: { nome: 'Preencha este campo' } }
)
conferir(
    'telefone curto é recusado',
    validarEnvio(campos, { nome: 'Ana', whatsapp: '1234' }),
    { ok: false, erros: { whatsapp: 'Informe um telefone com DDD' } }
)
conferir(
    'e-mail inválido é recusado',
    validarEnvio(campos, { nome: 'Ana', whatsapp: '31988501161', email: 'ana@' }),
    { ok: false, erros: { email: 'Informe um e-mail válido' } }
)

const extras: Campo[] = [
    { id: 'interesse', tipo: 'selecao', rotulo: 'Interesse', obrigatorio: true, largura: 'cheia', mapeia: 'nenhum', opcoes: ['Avaliação', 'Orçamento'] },
    { id: 'dias', tipo: 'multipla', rotulo: 'Dias', obrigatorio: false, largura: 'cheia', mapeia: 'nenhum', opcoes: ['Seg', 'Ter'] },
    { id: 'idade', tipo: 'numero', rotulo: 'Idade', obrigatorio: false, largura: 'metade', mapeia: 'nenhum', validacao: { min: 0, max: 120 } },
    { id: 'quando', tipo: 'data', rotulo: 'Quando', obrigatorio: false, largura: 'metade', mapeia: 'nenhum' },
    { id: 'aceite', tipo: 'caixa', rotulo: 'Aceito contato', obrigatorio: true, largura: 'cheia', mapeia: 'nenhum' },
    { id: 'obs', tipo: 'paragrafo', rotulo: 'Observações', obrigatorio: false, largura: 'cheia', mapeia: 'observacoes', validacao: { max: 20 } },
    { id: 'cep', tipo: 'texto', rotulo: 'CEP', obrigatorio: false, largura: 'metade', mapeia: 'nenhum', validacao: { padrao: '^[0-9]{5}-?[0-9]{3}$' } },
]

conferir(
    'os outros tipos: escolha fora da lista, número fora da faixa, data inválida, caixa desmarcada, texto longo, formato errado',
    validarEnvio(extras, { interesse: 'Outra', dias: ['Seg', 'Qua'], idade: '130', quando: '2026-13-40', aceite: false, obs: 'x'.repeat(21), cep: 'abc' }),
    {
        ok: false,
        erros: {
            interesse: 'Opção inválida',
            idade: 'O máximo é 120',
            quando: 'Informe uma data válida',
            aceite: 'Marque esta opção para continuar',
            obs: 'No máximo 20 caracteres',
            cep: 'O valor não está no formato esperado',
        },
    }
)
conferir(
    'os outros tipos, certos: múltipla fica só com as opções válidas, número vira número, caixa vira booleano',
    validarEnvio(extras, { interesse: 'Orçamento', dias: ['Seg', 'Qua'], idade: '42', quando: '2026-12-01', aceite: 'on', obs: 'manhã', cep: '30130-010' }),
    { ok: true, valores: { interesse: 'Orçamento', dias: ['Seg'], idade: 42, quando: '2026-12-01', aceite: true, obs: 'manhã', cep: '30130-010' } }
)
conferir('campo que não está no desenho é ignorado', validarEnvio(campos, { nome: 'Ana', whatsapp: '31988501161', hack: 'x' }), {
    ok: true,
    valores: { nome: 'Ana', whatsapp: '5531988501161' },
})

console.log('\n— o telefone —\n')

conferir('celular com DDD ganha o país', digitosDoTelefone('(31) 98850-1161'), '5531988501161')
conferir('fixo com DDD ganha o país', digitosDoTelefone('31 3131-9180'), '553131319180')
conferir('já com país fica como está', digitosDoTelefone('+55 31 98850-1161'), '5531988501161')
conferir('zero à esquerda do DDD sai', digitosDoTelefone('031 98850-1161'), '5531988501161')

console.log('\n— o que vira ficha —\n')

const valores = validarEnvio([...campos, ...extras], {
    nome: 'Ana',
    whatsapp: '31988501161',
    email: 'ana@exemplo.com',
    interesse: 'Orçamento',
    aceite: true,
    obs: 'manhã',
})
conferir('o envio composto passa', valores.ok, true)
if (valores.ok) {
    conferir('o mapeamento para a ficha', extrairContato([...campos, ...extras], valores.valores), {
        nome: 'Ana',
        telefone: '5531988501161',
        email: 'ana@exemplo.com',
        observacoes: 'manhã',
    })
    conferir(
        'o resumo lista rótulo e resposta, booleano como Sim',
        resumoDasRespostas([...campos, ...extras], valores.valores),
        'Nome: Ana\nWhatsApp: 5531988501161\nE-mail: ana@exemplo.com\nInteresse: Orçamento\nAceito contato: Sim\nObservações: manhã'
    )
}

console.log('\n— leitura tolerante e ids —\n')

conferir('campo inválido gravado sai, o resto fica', lerCampos([campos[0], { tipo: 'nada' }, campos[1]]).length, 2)
conferir('configuração vazia vira o padrão', lerConfiguracao(null), CONFIGURACAO_PADRAO)
conferir(
    'configuração com um campo quebrado mantém os outros',
    lerConfiguracao({ textoDoBotao: 'Quero', aparencia: 'x' }).textoDoBotao,
    'Quero'
)
conferir('id vem do rótulo, sem acento, único', [idParaCampo('Qual o interesse?', []), idParaCampo('Nome', ['nome'])], ['qual-o-interesse', 'nome-2'])

console.log('\n— o que o envio produz, e a aparência —\n')

/**
 * Os três interruptores de "Depois do envio" nascem ligados: o formulário que
 * alguém acabou de criar tem de captar lead de verdade sem passar por
 * configuração. Quem quiser só a lista de envios desliga "criar contato" — e
 * aí os outros dois não têm de onde pender.
 */
conferir(
    'os três nascem ligados',
    [CONFIGURACAO_PADRAO.criarContato, CONFIGURACAO_PADRAO.criarNegocio, CONFIGURACAO_PADRAO.iniciarConversa],
    [true, true, true]
)
conferir(
    'desligar o contato é o que fica gravado',
    lerConfiguracao({ criarContato: false }).criarContato,
    false
)
conferir(
    'valor sem sentido nos interruptores volta ao padrão',
    lerConfiguracao({ criarContato: 'talvez', iniciarConversa: 3 }),
    CONFIGURACAO_PADRAO
)

// O fundo: sólido por padrão, porque o transparente só faz sentido embutido e
// mudaria a cara de todo formulário que já existe.
conferir('o fundo nasce sólido', CONFIGURACAO_PADRAO.aparencia.fundo, 'solido')
conferir(
    'o fundo transparente fica gravado',
    lerConfiguracao({ aparencia: { cor: '#0E7C86', raio: 'suave', tema: 'claro', fundo: 'transparente' } }).aparencia.fundo,
    'transparente'
)
conferir(
    'fundo que não existe volta ao sólido',
    lerConfiguracao({ aparencia: { fundo: 'vidro' } }).aparencia.fundo,
    'solido'
)

console.log(`\n${passou} ok, ${falhou} falha(s)\n`)
process.exit(falhou > 0 ? 1 : 0)
