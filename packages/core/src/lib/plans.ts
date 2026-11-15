/**
 * The commercial plans, defined once.
 *
 * They were defined twice before — one set in the onboarding step, another in the
 * subscription API — with different names and different prices (97/197/497
 * against 690/890/1290). Whichever screen you happened to open told you something
 * different, and neither matched what the workspace actually got, because
 * onboarding never created a subscription at all.
 *
 * The limits here are not decoration: they are written onto the workspace's
 * subscription when the plan is chosen, and enforced when agents and WhatsApp
 * connections are created.
 */

import {
    PLAN_LIMITS,
    PLAN_NAMES,
    PLAN_PRICES,
    PRECO_ADICIONAL,
    TREINAMENTO,
    precoDoTreinamento,
    type BillingCycle,
    type PlanId,
    type PlanLimits,
} from './plan-limits'
import { InstagramIcon, WhatsAppIcon } from '../components/shared/BrandIcons'
import { Globe } from 'lucide-react'
import type { Vocabulario } from './vocabulario'
import { comArtigo } from './concordancia'

// Reexportados para quem já importava daqui — a definição mora em
// `plan-limits.ts`, que o worker também lê.
export { type PlanId, type BillingCycle }

/**
 * **Havia uma segunda lista de canais aqui, técnica, e ela foi removida em
 * 2026-10-20.** `PLAN_CHANNELS` e `CANAIS_EM_DESENVOLVIMENTO` existiam para o
 * painel, ao lado de `redesDoPlanoTodas`, que é a comercial — e as duas
 * divergiram, como duas listas da mesma coisa sempre divergem.
 *
 * O que elas discordavam era grave na tela: a técnica trazia o Facebook, que
 * saiu do produto em 2026-10-16, e tratava WhatsApp API e Instagram como
 * ligáveis agora, enquanto a comercial os marca `emBreve` porque a revisão da
 * Meta não saiu. O painel então contava, para um Plano Digital, quatro canais
 * — somando WhatsApp API, Instagram e o site, que é do Prime para cima — e
 * ainda pintava de vermelho a linha da Meta como se tivesse caído.
 *
 * Agora há uma lista só: `redesDoPlanoTodas`, filtrada por `redesDoPlano(plano)`.
 * Quem precisa do nome da coluna no banco traduz na própria tela — é o que o
 * painel faz com `CANAL_NO_BANCO`.
 */
export interface PlanFeature {
    text: string
    /** Em negrito no cartão. Para o item que vende o plano. */
    strong?: boolean
}

/**
 * As redes que o cartão de plano anuncia — lista **comercial**, não operacional.
 *
 * Separada de `PLAN_CHANNELS` porque as duas respondem perguntas diferentes.
 * `PLAN_CHANNELS` é técnica: tem `whatsapp_qr` e `whatsapp_business` separados,
 * e o painel precisa disso, porque são duas integrações com status
 * independentes. O cartão de plano responde "com quais redes eu falo com o
 * paciente", e para essa pergunta as duas formas de conectar o WhatsApp são **o
 * WhatsApp** — foi por isso que um QR Code e um selo de verificação na fileira
 * de ícones não quiseram dizer nada para ninguém.
 */
export interface RedeDoPlano {
    id: string
    label: string
    /**
     * Aceita tanto os glifos de marca daqui quanto um ícone do Lucide — o do
     * site não é marca nenhuma, é um globo.
     */
    icon: React.ComponentType<{ className?: string }>
    /**
     * Marca no canto do ícone, para distinguir duas conexões da mesma rede.
     *
     * Só o WhatsApp tem: a mesma rede entra por leitura de QR Code ou pela API
     * oficial da Meta, e são produtos diferentes para a clínica — a oficial não
     * depende de um celular ligado. Sem a marca, seriam dois ícones idênticos
     * lado a lado, que é pior que não mostrar.
     */
    marca?: string
    /** O produto ainda não atende. O cartão não pode prometer o que não existe. */
    emBreve?: boolean
    /**
     * Em quais planos esta conexão entra. Ausente: em todos.
     *
     * O agente no site é item do Prime para cima, e sem este recorte o cartão do
     * Digital mostraria o ícone do site na fileira enquanto a lista de itens
     * logo abaixo não o traz — a mesma tela dizendo duas coisas.
     */
    planos?: PlanId[]
}

/**
 * **O Messenger saiu em 2026-10-16**, por decisão do Andre: o caso de uso foi
 * retirado do aplicativo na Meta porque acrescentava cinco permissões à revisão,
 * cada uma com o seu próprio vídeo, e exigia publicar uma página do Facebook. DM
 * de Facebook não é argumento de venda para clínica odontológica.
 *
 * Com todos os ícones na mesma cor — pedido dele, e a fileira melhorou —, não há
 * nada que distinga "existe" de "vai existir". Deixá-lo aqui seria prometer o
 * que ninguém está construindo. O glifo continua em `BrandIcons` para quando
 * voltar.
 */
/**
 * Função, e não constante: os rótulos leem o vocabulário do nicho.
 *
 * Uma constante de nível de módulo é avaliada quando a Cloudflare VALIDA o
 * script — sem requisição e sem marca registrada —, e a publicação reprova com
 * `MarcaNaoRegistradaError`. Aconteceu cinco vezes nesta fase, e uma sexta
 * aqui, quando o vocabulário entrou nestes rótulos.
 *
 * ## E por que o vocabulário entra por PARÂMETRO
 *
 * `plans`, `planList` e `redesDoPlano` são lidas por componentes `'use
 * client'` — o passo 2 do onboarding e a guia Plano. No navegador **ninguém
 * registrou a marca**: chamar `vocab()` por dentro lançava
 * `MarcaNaoRegistradaError` na hidratação, depois de compilar, buildar e
 * publicar sem uma reclamação. Medido em 15/11/2026, e era defeito em
 * produção.
 *
 * No cliente as palavras vêm de `useVocab()`; no servidor, de
 * `vocab(settings)`. Obrigatórias na assinatura, a cobrança é do compilador.
 *
 * **A memoização de módulo saiu junto, e tinha de sair**: o resultado agora
 * depende do argumento, e um cache global devolveria a palavra da primeira
 * unidade a todas as outras — que é precisamente o que a camada de override
 * por unidade existe para não acontecer.
 */
export function redesDoPlanoTodas(v: Vocabulario): RedeDoPlano[] {
    return [
        { id: 'site', label: `Site ${comArtigo(v, 'organizacao', 'de')}`, icon: Globe, planos: ['pro', 'advanced'] },
        { id: 'whatsapp', label: 'WhatsApp', icon: WhatsAppIcon },
        { id: 'whatsapp_api', label: 'WhatsApp API Oficial', icon: WhatsAppIcon, marca: 'API', emBreve: true },
        { id: 'instagram', label: 'Instagram Direct', icon: InstagramIcon, emBreve: true },
    ]
}

/** As conexões que este plano anuncia, na ordem da fileira. */
export function redesDoPlano(planId: PlanId, v: Vocabulario): RedeDoPlano[] {
    return redesDoPlanoTodas(v).filter((rede) => !rede.planos || rede.planos.includes(planId))
}

export interface Plan {
    id: PlanId
    /**
     * O ícone do plano, em `public/planos`.
     *
     * Eram glifos genéricos do Lucide — raio, estrela e coroa —, que não diziam
     * nada sobre o produto e não eram da marca. Estes são desenhados para o
     * sistema: um, dois e três balões de conversa, com o degradê do ciano da
     * marca. A contagem de balões é o degrau do plano, e conversa é o que o
     * produto faz.
     *
     * **São dois jogos, um por tema.** O degradê rico da marca, ciano para
     * marinho, fica lindo no cartão branco e some no cartão do tema escuro, que
     * é marinho (#0e2440): os balões escuros desapareciam dentro do fundo, o
     * Prime virava um balão só e o Multiclínica perdia a estrutura. Medido
     * compondo os ícones sobre os dois fundos antes de instalar.
     *
     * O jogo escuro é o **mesmo desenho recolorido**, não um desenho novo —
     * gerado por edição a partir do arquivo claro. Um segundo desenho mudaria a
     * geometria ao trocar de tema, e forma que muda sozinha lê como defeito, não
     * como tema.
     */
    icon: string
    /** O mesmo desenho, em degradê luminoso, para o cartão do tema escuro. */
    iconDark: string
    name: string
    description: string
    price: number
    badge?: string
    /** Vêm de `plan-limits.ts`, que é a fonte da verdade. */
    limits: PlanLimits
    /**
     * A lista de itens do cartão, embaixo da fileira de canais.
     *
     * **A ordem é hierarquia**, decidida pelo Andre em 2026-10-18: unidades,
     * agentes, números — do continente para o conteúdo —, depois o que não muda
     * entre planos, e crédito por último. Quem compara três cartões lê as três
     * primeiras linhas de cada um; é lá que mora o que diferencia.
     *
     * **Negrito em unidades e crédito, nos três planos.** São as duas pontas do
     * que o cliente dimensiona: quantas clínicas cabem e quanto o agente pode
     * trabalhar. O terceiro negrito, o Diagnóstico de LGPD, existe só no
     * Multiclínica e faz outro trabalho — não é número que se compara, é item
     * que os outros planos não têm.
     *
     * Objeto e não texto puro por causa desse destaque: marcador dentro da
     * string exigiria um interpretador nos dois lugares que desenham o cartão.
     */
    features: PlanFeature[]
}

/** Pela mesma razão de `redesDoPlanoTodas`: as descrições leem o vocabulário. */
export function plans(v: Vocabulario): Record<PlanId, Plan> {
    return {
        flow: {
            id: 'flow',
            icon: '/planos/digital.png',
            iconDark: '/planos/digital-escuro.png',
            name: PLAN_NAMES.flow,
            description:
                `Para ${v.organizacoes} que precisam conectar ${v.pessoas}, WhatsApp e atendimento em um só lugar.`,
            price: PLAN_PRICES.flow,
            limits: PLAN_LIMITS.flow,
            features: [
                { text: `1 unidade (${v.organizacao})`, strong: true },
                { text: '1 agente de atendimento IA' },
                { text: '1 número de WhatsApp' },
                { text: `CRM para ${v.organizacoes} com funil de vendas` },
                { text: 'Usuários ilimitados' },
                { text: 'Dashboard inteligente' },
                { text: 'Agenda integrada com Google Calendar' },
                { text: '10.000 créditos de IA por mês', strong: true },
            ],
        },
        pro: {
            id: 'pro',
            icon: '/planos/prime.png',
            iconDark: '/planos/prime-escuro.png',
            name: PLAN_NAMES.pro,
            description:
                `Para ${v.organizacoes} que precisam distribuir conversas, ampliar o atendimento e administrar mais canais.`,
            price: PLAN_PRICES.pro,
            badge: 'Mais escolhido',
            limits: PLAN_LIMITS.pro,
            features: [
                { text: `1 unidade (${v.organizacao})`, strong: true },
                { text: '2 agentes de atendimento IA' },
                { text: '4 números de WhatsApp' },
                { text: `CRM para ${v.organizacoes} com funil de vendas` },
                { text: 'Usuários ilimitados' },
                { text: 'Dashboard inteligente' },
                { text: `Agente de IA no site ${comArtigo(v, 'organizacao', 'de')}` },
                { text: 'Agenda integrada com Google Calendar' },
                { text: 'Integração com CliniCorp' },
                { text: '20.000 créditos de IA por mês', strong: true },
            ],
        },
        advanced: {
            id: 'advanced',
            icon: '/planos/multiclinica.png',
            iconDark: '/planos/multiclinica-escuro.png',
            name: PLAN_NAMES.advanced,
            description:
                `Para ${v.organizacoes} com operações maiores, múltiplas unidades e maior fluxo de ${v.pessoas}.`,
            price: PLAN_PRICES.advanced,
            limits: PLAN_LIMITS.advanced,
            features: [
                { text: `3 unidades (${v.organizacoes})`, strong: true },
                { text: '3 agentes de atendimento IA' },
                { text: '6 números de WhatsApp' },
                { text: `CRM para ${v.organizacoes} com funil de vendas` },
                { text: 'Usuários ilimitados' },
                { text: 'Dashboard inteligente' },
                { text: `Agente de IA no site ${comArtigo(v, 'organizacao', 'de')}` },
                { text: 'Agenda integrada com Google Calendar' },
                { text: 'Integração com CliniCorp' },
                { text: 'Diagnóstico de LGPD (proteção de dados)', strong: true },
                { text: '30.000 créditos de IA por mês', strong: true },
            ],
        },
    }
}

/** Os três planos na ordem em que a tela os mostra. */
export function planList(v: Vocabulario): Plan[] {
    const todos = plans(v)
    return [todos.flow, todos.pro, todos.advanced]
}

/**
 * Os pacotes de recarga de crédito.
 *
 * **Compra única**, não assinatura: o texto da tela dizia "R$ 49,90 por mês
 * enquanto estiver ativo" enquanto o banco guardava compra única com validade —
 * dois produtos diferentes na mesma tela, e quem comprasse leria um e receberia
 * o outro. Recarga que se repete todo mês é upgrade de plano com outro nome.
 *
 * **O preço por crédito é o mesmo que o plano entrega**, e isso é deliberado: na
 * conta do Andre, 10% da mensalidade é o orçamento de IA, e 10% de R$ 490 são os
 * R$ 49 que compram 10.000 créditos no Essencial. Logo não há arbitragem entre
 * comprar recarga e subir de plano — quem sobe de plano sobe por **estrutura**
 * (números, agentes), não por combustível. É o que mantém a escada de planos
 * honesta.
 *
 * **Três pacotes, não cinco.** Cinco opções espalham a decisão e quase todo o
 * volume cai nas duas primeiras. Cada um destes tem papel: o pico pequeno, o mês
 * de campanha, e a clínica que cresceu. O último também é sinal de que está na
 * hora de trocar de plano — R$ 184 de recarga contra os R$ 200 que separam
 * Essencial de Evolução, que vêm com três números a mais.
 *
 * A validade é a de `PURCHASE_VALIDITY_DAYS` (90 dias). Trinta foi considerado e
 * descartado: 50.000 créditos em 30 dias exigiriam 180 atendimentos por dia
 * contra os 20 de uma clínica de um agente — a clínica queimaria 90% do que
 * pagou, e isso não é desconto, é pegadinha.
 */
export interface CreditPack {
    credits: number
    price: number
    /** Desconto por crédito contra o pacote base, para a tela mostrar. */
    discount: number
}

/**
 * **Sem `pitch`, desde 2026-11-09.** Cada pacote tinha uma frase descrevendo o
 * mês em que ele serve ("para o mês de campanha, quando o movimento triplica").
 * O Andre mandou tirar as três ao compactar o diálogo de adicionais: o que
 * decide a compra é o número de créditos e o preço, que estão em corpo grande
 * logo acima, e três parágrafos lado a lado custavam as linhas que faziam o
 * diálogo rolar. O campo saiu do tipo junto, porque era renderizado num lugar
 * só.
 */
export const CREDIT_PACKS: CreditPack[] = [
    { credits: 10_000, price: 49, discount: 0 },
    { credits: 30_000, price: 125, discount: 0.15 },
    { credits: 50_000, price: 184, discount: 0.25 },
]

/** O pacote com exatamente esta quantidade, ou nada — a lista é fechada. */
export function creditPackFor(credits: unknown): CreditPack | undefined {
    return CREDIT_PACKS.find((pack) => pack.credits === credits)
}

/**
 * A unidade adicional, vendida fora do plano.
 *
 * **Qualquer plano, a qualquer momento** — não é privilégio do Multiclínica. O
 * preço não é arbitrário: o Multiclínica são R$ 890 por três unidades, ou seja
 * R$ 297 cada, e o adicional só torna explícito o preço marginal que o plano já
 * embute. Fica abaixo dos R$ 390 de um Digital avulso, que é a alternativa que o
 * cliente tem hoje, e com ele a clínica mantém uma fatura, uma renovação e a
 * troca de unidade pela própria tela.
 *
 * **Traz 1 agente e 1 número, além da unidade. Crédito não.**
 *
 * A unidade precisa do agente e do número ou nasce muda — era a regra anterior,
 * e ela resolvia o problema pela metade. O crédito, ao contrário, já tem onde
 * ser comprado: 10.000 avulsos por R$ 49. Expandir sai por R$ 339 contra os
 * R$ 390 de uma assinatura Digital nova, e a clínica continua com uma fatura,
 * uma renovação e duas caixas d'água de crédito em vez de três.
 *
 * A escada de planos fica mais firme assim: quem quer 3 agentes paga R$ 890 no
 * Multiclínica com 6 números e 30.000 créditos, contra R$ 970 por Digital + 2
 * adicionais com 3 números e 10.000. O plano ganha em dinheiro e em capacidade.
 */
export const UNIDADE_ADICIONAL = {
    price: PRECO_ADICIONAL,
    name: 'Unidade adicional',
    /**
     * Uma linha, e é a do Andre (2026-11-09). A anterior listava o que vem
     * junto — agenda, pacientes, conversas, 1 agente, 1 número, e de onde sai o
     * crédito — em três linhas dentro de um diálogo que precisava encurtar.
     * "Cadastros independentes" diz o que importa decidir; o detalhe de
     * capacidade está nos cartões de plano, que é onde se compara.
     */
    pitch: 'Mais uma unidade com cadastros independentes na mesma conta.',
}

/**
 * O treinamento de agente, como a tela o vende.
 *
 * O preço, a promoção e a regra do brinde moram em `plan-limits.ts`, com o
 * resto da tabela comercial — o worker precisa deles para cobrar e para aplicar
 * o que o plano inclui. Aqui fica só o que é texto de tela.
 *
 * **O rodapé é pedido do Andre em 2026-11-07, para as duas telas de plano** — a
 * do onboarding e a de gerenciamento. Ele é recomendação, não aviso: fica em
 * letra menor, no fim da tela, depois dos planos, e não disputa com o preço.
 */
export const TREINAMENTO_DE_AGENTE = {
    name: TREINAMENTO.nome,
    pitch:
        'A nossa equipe levanta o conteúdo com você, escreve os documentos do agente e ' +
        'afina as respostas até ele atender como a sua equipe atenderia. É um projeto ' +
        'com começo e fim — compra única, não entra na mensalidade.',
    /**
     * A frase do rodapé das duas telas de plano.
     *
     * "Assertividade" com dois S: foi pedida com um, e um erro de grafia na
     * tela que vende é o tipo de detalhe que o cliente lê como descuido do
     * produto.
     */
    rodape:
        'O treinamento do agente é recomendado para uma maior experiência e ' +
        'assertividade na interação com os leads.',
    /** Para a tela não precisar importar de dois lugares. */
    preco: precoDoTreinamento,
}

export const TRIAL = {
    days: 7,
    credits: 1000,
    headline: 'Você tem 7 dias de avaliação gratuita',
    body: 'São 1.000 créditos de IA para validar o seu agente de atendimento. Não é necessário inserir o cartão de crédito agora, e nada é cobrado até você efetivar a assinatura.',
}

/**
 * Price as "R$ 490,00".
 *
 * Real **fixo**, e não a moeda da conta — não é esquecimento da troca de moeda
 * de 2026-11-03. Esta tabela é o que a Venn360 cobra, o Asaas liquida em reais,
 * e pintar `€` sobre "490" anunciaria um preço que não é o debitado. Quem
 * segue a moeda da conta é `lib/moedas.ts`, e ele cobre os dados do cliente —
 * negócios, painel, serviços, produtos.
 */
export function formatPrice(value: number): string {
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
    }).format(value)
}


/**
 * Falls back to the entry plan rather than throwing on unknown stored values.
 *
 * ⚠️ `id in plans()`, com os parênteses — e eles são o conserto de um defeito
 * que esteve em produção. Quando `plans` era uma constante, `id in plans`
 * perguntava pelas chaves do objeto. Virando função, passou a perguntar pelas
 * propriedades da FUNÇÃO (`name`, `length`), e `'pro' in plans` é `false`:
 * **toda assinatura passou a ser reportada como o plano de entrada**. O
 * TypeScript aceita `in` sobre função sem reclamar, e nenhum teste comparava o
 * nome devolvido com o plano guardado. Medido em 15/11/2026.
 */
export function planFor(id: string | null | undefined, v: Vocabulario): Plan {
    const todos = plans(v)
    return id && id in todos ? todos[id as PlanId] : todos.flow
}
