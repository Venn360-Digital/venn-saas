'use client'

import { useEffect, useMemo, useState } from 'react'
import {
    ArrowLeft,
    Bot,
    CalendarPlus,
    ChevronDown,
    ChevronRight,
    Compass,
    CreditCard,
    GraduationCap,
    LifeBuoy,
    Mail,
    MessageCircle,
    MessagesSquare,
    QrCode,
    Search,
    Sparkles,
    Users,
    type LucideIcon,
} from 'lucide-react'

import { Logo } from '@/components/brand/Logo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { EmptyState } from '@/components/shared/EmptyState'
import {
    DOCUMENTOS,
    SECAO_EXEMPLOS,
    type DocumentoDeTreinamento,
    type ModoDoDocumento,
} from '@/lib/treinamento/documentos'
import { BRAND } from '@/config/brand'
import { cn } from '@/lib/utils'
import { normalizeSearch } from '@/lib/search'

/**
 * A central de ajuda, dentro do próprio produto.
 *
 * **Sem widget de terceiro, de propósito.** Um balão de chat de outro
 * fornecedor dentro de um produto que já é uma tela de conversa confunde: a
 * atendente passa o dia respondendo paciente num balão e encontraria um
 * segundo balão, de outra cor, para falar com a gente.
 *
 * Mora em `/suporte` e não numa guia da Conta porque não é ajuste de conta — é
 * conteúdo, e conteúdo com vida própria: um dia vira
 * `suporte.odontobox.venn360.com` e sai do shell sem reescrever nada, porque o
 * que esta tela usa do sistema são tokens e componentes, não a moldura.
 */

const WHATSAPP = process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP?.replace(/\D/g, '') ?? ''
const EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? ''

/** "553131918001" → "(31) 3191-8001", que é como se lê um telefone. */
function telefoneLegivel(digitos: string): string {
    const nacional = digitos.replace(/^55/, '')
    if (nacional.length === 10) return `(${nacional.slice(0, 2)}) ${nacional.slice(2, 6)}-${nacional.slice(6)}`
    if (nacional.length === 11) return `(${nacional.slice(0, 2)}) ${nacional.slice(2, 7)}-${nacional.slice(7)}`
    return digitos
}

// ─── Ilustrações ──────────────────────────────────────────────────────────
/**
 * Mini-maquetes da tela de que o passo fala.
 *
 * Desenhadas, e não capturadas: print envelhece na primeira mudança de layout e
 * ninguém lembra de trocar — uma ajuda que mostra a tela de três versões atrás
 * é pior que nenhuma. Em `currentColor` e tokens, então acompanham o tema.
 */
function Maquete({ children, titulo }: { children: React.ReactNode; titulo: string }) {
    return (
        <svg
            viewBox="0 0 320 150"
            role="img"
            aria-label={titulo}
            className="h-auto w-full max-w-[320px] rounded-lg border border-border bg-card text-muted-foreground"
        >
            <rect x="0" y="0" width="320" height="26" className="fill-muted" />
            <circle cx="14" cy="13" r="3.5" className="fill-border" />
            <circle cx="26" cy="13" r="3.5" className="fill-border" />
            <circle cx="38" cy="13" r="3.5" className="fill-border" />
            {children}
        </svg>
    )
}

const ILUSTRACOES: Record<string, React.ReactNode> = {
    whatsapp: (
        <>
            <text x="14" y="48" className="fill-current text-[9px] font-semibold">Canais de atendimento</text>
            <rect x="14" y="58" width="292" height="34" rx="5" className="fill-none stroke-border" strokeWidth="1" />
            <text x="24" y="72" className="fill-current text-[8px]">WhatsApp · Unidade Centro</text>
            <text x="24" y="84" className="fill-current text-[7px] opacity-70">não conectado</text>
            <rect x="232" y="66" width="62" height="18" rx="4" className="fill-primary" />
            <text x="263" y="78" textAnchor="middle" className="fill-primary-foreground text-[8px] font-semibold">Conectar</text>
            <rect x="14" y="100" width="292" height="34" rx="5" className="fill-none stroke-border" strokeWidth="1" strokeDasharray="3 3" />
            <text x="160" y="121" textAnchor="middle" className="fill-current text-[8px] opacity-70">o QR Code aparece aqui</text>
        </>
    ),
    agenda: (
        <>
            <text x="14" y="48" className="fill-current text-[9px] font-semibold">Novo compromisso</text>
            <rect x="14" y="58" width="140" height="18" rx="4" className="fill-none stroke-border" strokeWidth="1" />
            <text x="22" y="70" className="fill-current text-[7px] opacity-70">Paciente</text>
            <rect x="166" y="58" width="140" height="18" rx="4" className="fill-none stroke-border" strokeWidth="1" />
            <text x="174" y="70" className="fill-current text-[7px] opacity-70">Especialista</text>
            <rect x="14" y="84" width="140" height="18" rx="4" className="fill-none stroke-primary" strokeWidth="1.5" />
            <text x="22" y="96" className="fill-current text-[7px]">Limpeza · 30 min</text>
            <rect x="166" y="84" width="140" height="18" rx="4" className="fill-none stroke-border" strokeWidth="1" />
            <text x="174" y="96" className="fill-current text-[7px] opacity-70">09:00</text>
            <rect x="244" y="112" width="62" height="18" rx="4" className="fill-primary" />
            <text x="275" y="124" textAnchor="middle" className="fill-primary-foreground text-[8px] font-semibold">Criar</text>
        </>
    ),
    fila: (
        <>
            <text x="14" y="48" className="fill-current text-[9px] font-semibold">Ficha do usuário</text>
            <text x="14" y="66" className="fill-current text-[8px] opacity-70">Departamentos</text>
            <rect x="14" y="74" width="10" height="10" rx="2" className="fill-primary" />
            <text x="30" y="83" className="fill-current text-[8px]">Comercial</text>
            <rect x="14" y="92" width="10" height="10" rx="2" className="fill-primary" />
            <text x="30" y="101" className="fill-current text-[8px]">Recepção</text>
            <rect x="14" y="110" width="10" height="10" rx="2" className="fill-none stroke-border" strokeWidth="1.2" />
            <text x="30" y="119" className="fill-current text-[8px] opacity-60">Ortodontia</text>
        </>
    ),
}

// ─── Primeiros passos ─────────────────────────────────────────────────────
const PASSOS = [
    {
        id: 'whatsapp',
        icone: QrCode,
        titulo: 'Conectar o WhatsApp a um agente',
        resumo: 'O número que a clínica já usa passa a ser atendido pelo agente. Leva dois minutos e não perde conversa nenhuma.',
        passos: [
            'Atendimento → Agentes e abra o agente que vai atender esse número.',
            'Vá na guia Canais e aperte Conectar na linha de WhatsApp.',
            'Um QR Code aparece. No celular que tem o número: WhatsApp → Aparelhos conectados → Conectar um aparelho.',
            'Aponte a câmera para o QR. Quando a linha ficar verde, o agente já responde.',
            'Dê um apelido à linha ("Unidade Centro") — é por ele que a conversa diz de onde veio.',
        ],
        nota: 'Um agente pode ter vários números, um por unidade. O mesmo número em dois agentes não dá: os dois responderiam à mesma mensagem.',
    },
    {
        id: 'agenda',
        icone: CalendarPlus,
        titulo: 'Criar um compromisso na agenda',
        resumo: 'O horário sai do especialista e a duração sai do serviço — você não precisa calcular o fim.',
        passos: [
            'Vendas → Agenda e clique no horário desejado, ou use Novo compromisso.',
            'Escolha o paciente. Se ainda não existe, cadastre ali mesmo pelo campo.',
            'Escolha o especialista: a agenda só oferece os horários em que ele atende.',
            'Escolha o serviço ou procedimento. A duração dele define o tamanho do bloco.',
            'Confirme. O paciente entra na agenda e o compromisso aparece na ficha dele.',
        ],
        nota: 'A duração vem do cadastro em Vendas → Procedimentos. Se o bloco sair do tamanho errado, é lá que se corrige — num lugar só, para todos os compromissos futuros.',
    },
    {
        id: 'fila',
        icone: Users,
        titulo: 'Dar acesso de fila a alguém da equipe',
        resumo: 'Quem atende vê as filas dos departamentos de que faz parte. É assim que a Recepção cobre o Comercial num dia de falta.',
        passos: [
            'Conta → Usuários e abra a ficha da pessoa.',
            'Em Departamentos, marque as filas que ela vai atender. Pode ser mais de uma.',
            'Pronto: as conversas que chegarem pelas linhas desses departamentos aparecem para ela.',
        ],
        nota: 'Sem departamento marcado, a pessoa vê só a fila geral — as linhas sem dono. A tela de Usuários avisa quando alguém está nessa situação.',
    },
]

// ─── Treinamento do agente ────────────────────────────────────────────────
/**
 * O roteiro de preenchimento dos oito documentos.
 *
 * **Deriva do catálogo, e isso não é elegância — é a única forma de não
 * mentir.** Se esta tela repetisse à mão os nomes das seções, os modos e os
 * tetos, divergiria do produto no primeiro ajuste do catálogo, e uma ajuda que
 * ensina a escrever um documento que o sistema já não aceita é pior que
 * nenhuma. Aqui o nome, o modo, o teto e as seções vêm de
 * `lib/treinamento/documentos.ts`; o que mora nesta tela é só o conselho.
 */

/** O que cada modo significa para quem escreve — não para quem programa. */
const MODO: Record<ModoDoDocumento, { rotulo: string; onde: string }> = {
    prompt: {
        rotulo: 'Vai em toda mensagem',
        onde: 'O agente lê este documento inteiro a cada resposta. É onde mora o que não pode depender de a busca acertar.',
    },
    rag: {
        rotulo: 'Consultado quando a conversa pede',
        onde: 'O agente busca aqui o trecho que responde à pergunta. É onde mora o fato, que custaria caro se fosse em toda mensagem.',
    },
    procedimento: {
        rotulo: 'Entra quando a situação acontece',
        onde: 'Só o título e o gatilho vão em toda mensagem. Os passos chegam quando a conversa entra na situação.',
    },
}

/**
 * O conselho por documento: o que escrever, e o erro que mais aparece.
 *
 * Cada "erro comum" saiu de documento de cliente real ou de medição, não de
 * suposição sobre o que alguém poderia errar.
 */
const CONSELHO: Record<string, { escreva: string; erro: string }> = {
    'instrucoes-centrais': {
        escreva: 'Quem o agente é, como escreve, o que ele busca na conversa, e o que o sistema não deixa ele fazer. Seja concreto no tom: tamanho da mensagem, emoji ou não, uma pergunta por vez.',
        erro: '“Seja simpático” não muda comportamento nenhum — o modelo não sabe o que fazer com isso. E limite de conduta profissional não é daqui: é de Privacidade, que tem precedência maior que a deste documento.',
    },
    empresa: {
        escreva: 'Endereço com uma referência de como chegar, horário incluindo o que não abre, e dois ou três diferenciais verificáveis.',
        erro: 'Contar a história da empresa. Este documento vai em toda mensagem — escreva o que o paciente pergunta, não o institucional.',
    },
    servicos: {
        escreva: 'Um subtítulo de terceiro nível (###) por serviço, com o que é, para quem serve e quanto tempo leva. E o que não está incluído, que é a maior fonte de frustração depois da venda.',
        erro: 'Pôr tudo sob um cabeçalho só. Cada subtítulo vira um trecho da busca; com um bloco único, a pergunta sobre um serviço devolve o documento inteiro e o agente se perde. Seção maior que 1.500 caracteres é cortada por dentro, no meio da frase.',
    },
    'processo-comercial': {
        escreva: 'A sequência que o agente segue, o que perguntar antes de encaminhar, e o que ele não faz por política — preço, prazo, desconto.',
        erro: 'Escrever o manual em vez da regra. O que vai em toda mensagem custa em toda mensagem, e texto longo aqui disputa a atenção do modelo em cada resposta.',
    },
    'tecnicas-de-venda': {
        escreva: 'Os princípios de condução, as perguntas que fazem a pessoa falar do problema, e um subtítulo de terceiro nível (###) por objeção que você de fato ouve.',
        erro: 'Escrever a resposta pronta para decorar. Roteiro decorado soa decorado, e a pessoa percebe. Escreva o princípio da resposta.',
    },
    faq: {
        escreva: 'Um subtítulo de terceiro nível (###) por pergunta, com as palavras que o paciente usa — inclusive erradas. E a lista de sinônimos: como ele chama, seguido do termo que a clínica usa.',
        erro: 'Escrever a pergunta no termo técnico. “Formas de pagamento” não é recuperado por quem digita “vcs aceita pix?”. A seção de sinônimos é a mais subestimada do método: sem ela, a busca não acha o assunto pelo nome popular.',
    },
    privacidade: {
        escreva: 'O que o agente nunca faz por ser papel de um profissional, o que fazer com quem já é paciente, e que dado ele não pede.',
        erro: 'Deixar vazio por parecer burocrático. Este documento tem a maior precedência de todas: quando qualquer outro conflita com ele, ele ganha. É o que impede o palpite que prejudica alguém.',
    },
    cenarios: {
        escreva: 'Um subtítulo de terceiro nível (###) por situação, com uma linha “Quando:” descrevendo o gatilho e uma lista “Passos:” numerada.',
        erro: 'Esquecer o “Quando:” ou os “Passos:”. Sem gatilho o cenário nunca é reconhecido; sem passos não há o que executar. O formato não é enfeite — é o que o sistema lê.',
    },
}

/**
 * O prompt que organiza material fora do padrão, montado **a partir do
 * catálogo**.
 *
 * Quem já tem material escrito — um manual de atendimento, um documento do
 * consultor, um PDF de treinamento — não deveria ter de redigitar tudo em oito
 * blocos. Este prompt faz a separação, e a parte que importa dele é a divisão
 * entre o que vai no prompt e o que vai na busca: é a decisão que o cliente não
 * tem como adivinhar sozinho, e a que mais custa caro quando sai errada.
 *
 * Montado por função e não escrito à mão pelo mesmo motivo do resto desta tela:
 * catálogo que muda sem o prompt acompanhar produziria arquivos que o sistema
 * recusa.
 */
function promptDeConversao(): string {
    const linha = (d: DocumentoDeTreinamento) =>
        `${d.slug}.md — ${d.titulo}\n` +
        `  Destino: ${d.modo === 'prompt' ? 'PROMPT (lido em toda mensagem)' : d.modo === 'rag' ? 'RAG (buscado quando a conversa pede)' : 'PROCEDIMENTO (gatilho no prompt, passos sob demanda)'}\n` +
        `  Seções obrigatórias, nesta ordem e com dois ##:\n` +
        d.secoes.map((s) => `    ## ${s}`).join('\n') +
        `\n  Teto: ${d.teto.toLocaleString('pt-BR')} caracteres.`

    return [
        'Você vai reorganizar o material de treinamento abaixo em arquivos Markdown separados, seguindo exatamente a estrutura que eu descrevo. Não invente conteúdo: use só o que está no material. O que faltar, deixe como comentário de HTML no formato <!-- confirmar: o que falta -->.',
        '',
        'A REGRA QUE DECIDE ONDE CADA COISA VAI',
        '',
        'Há três tipos de texto, e cada um tem um destino:',
        '',
        '1. REGRA — quem o agente é, o que ele nunca faz, como conduz, os limites. Vai no PROMPT, porque o agente precisa disso em toda resposta e não pode depender de uma busca acertar.',
        '2. FATO — serviços, preços, endereço, horário, perguntas e respostas. Vai no RAG, porque é consultado quando a conversa pede e custaria caro em toda mensagem.',
        '3. PROCEDIMENTO — "quando acontecer X, faça 1, 2, 3". Vai no documento de cenários: o gatilho fica sempre à mão e os passos chegam quando a situação aparece.',
        '',
        'Na dúvida entre regra e fato, pergunte: "se a busca não encontrar isto, o agente erra feio?" Se sim, é regra e vai no prompt.',
        '',
        'OS ARQUIVOS QUE VOCÊ DEVE PRODUZIR',
        '',
        DOCUMENTOS.map(linha).join('\n\n'),
        '',
        'REGRAS DE FORMATO, TODAS OBRIGATÓRIAS',
        '',
        '- Cada arquivo começa com um único "# " e o título indicado.',
        '- Os cabeçalhos "##" são exatamente os listados, sem acrescentar nem omitir.',
        `- Nos documentos de RAG e de procedimento, use "###" por item dentro da seção: um "###" por serviço, um por pergunta, um por objeção, um por situação. Cada "###" vira um trecho da busca; um bloco único faz a pergunta devolver o documento inteiro.`,
        '- Nenhuma seção pode passar de 1.500 caracteres, ou ela é cortada no meio de uma frase. Se passar, divida em mais "###".',
        `- No documento de cenários, cada "###" precisa de uma linha "Quando:" com o gatilho e uma lista "Passos:" numerada. Sem as duas, o cenário é ignorado.`,
        `- A seção "${SECAO_EXEMPLOS}" é reservada: coloque ali as falas de exemplo, e só ali. Elas mostram o jeito de responder e nunca são usadas como fonte de verdade.`,
        '- Não escreva preço, prazo, condição comercial ou política que não esteja no material. Prefira deixar <!-- confirmar: ... --> a escrever um número que ninguém confirmou.',
        '',
        'SAÍDA',
        '',
        'Devolva um arquivo de cada vez, com o nome dele antes do conteúdo. No fim, liste o que você deixou marcado como "confirmar" e o que do material original não coube em nenhum arquivo.',
        '',
        'MATERIAL A REORGANIZAR',
        '',
        '<cole aqui o seu material>',
    ].join('\n')
}

const PROMPT_DE_CONVERSAO = promptDeConversao()

/** Tudo o que a seção de treinamento diz, para a busca varrer. */
const TEXTO_TREINAMENTO = normalizeSearch(
    [
        'treinamento do agente roteiro preencher documentos prompt rag',
        ...DOCUMENTOS.map(
            (d) =>
                `${d.titulo} ${d.item} ${d.explicacao} ${MODO[d.modo].rotulo} ${MODO[d.modo].onde} ` +
                `${CONSELHO[d.slug]?.escreva ?? ''} ${CONSELHO[d.slug]?.erro ?? ''} ${d.secoes.join(' ')}`
        ),
        PROMPT_DE_CONVERSAO,
    ].join(' ')
)

// ─── Perguntas frequentes ────────────────────────────────────────────────
/**
 * O `resumo` e o `icone` existem desde a tela de 2026-11-09: no índice de
 * tópicos cada grupo é um cartão, e cartão com só o nome e a contagem não
 * ajuda a escolher entre seis. Uma linha dizendo o que se resolve ali ajuda.
 */
const FAQ: {
    grupo: string
    resumo: string
    icone: LucideIcon
    itens: { p: string; r: string }[]
}[] = [
    {
        grupo: 'Agente e WhatsApp',
        resumo:
            'Por que o agente parou, mais de um número, QR Code contra API oficial, resposta em áudio.',
        icone: Bot,
        itens: [
            { p: 'O agente parou de responder. O que houve?', r: 'São três causas, nesta ordem de frequência: os créditos de IA acabaram, o agente foi pausado em Atendimento → Agentes, ou o número desconectou. Quando o crédito acaba, o agente avisa o paciente uma vez e silencia — nunca repete o aviso. Nos três casos as conversas continuam chegando e a equipe segue respondendo normalmente.' },
            { p: 'Posso ter mais de um número no mesmo agente?', r: 'Pode, e é o arranjo certo para quem tem duas unidades: uma linha por número, cada uma com seu apelido. A conversa guarda por qual linha entrou, e a resposta sai pela mesma.' },
            { p: 'Dois agentes podem usar o mesmo número?', r: 'Não. Os dois responderiam à mesma mensagem, um por cima do outro. Se precisa de comportamentos diferentes no mesmo número, use um agente só com regras por condição.' },
            { p: 'Qual a diferença entre WhatsApp QR Code e API oficial?', r: 'O QR Code lê o aparelho que já tem o número, como o WhatsApp Web — depende do celular ligado. A API oficial é da Meta, não depende de aparelho e permite o selo de verificação, mas exige aprovação e um número que não esteja em uso no app comum.' },
            { p: 'O agente responde em áudio?', r: 'Responde, se a voz estiver ligada naquele agente — ela sai desligada de propósito. A fala custa cerca de dez vezes o texto, então o plano tem um teto mensal de respostas faladas, mostrado em Plano e créditos.' },
            { p: 'Dá para o agente parar numa conversa específica?', r: 'Dá: assuma a conversa. A partir daí ela é sua, e o agente não responde por cima de quem está atendendo.' },
        ],
    },
    {
        grupo: 'Créditos e plano',
        resumo:
            'O que é um crédito, quando a franquia renova, e o que acontece quando ela acaba.',
        icone: CreditCard,
        itens: [
            { p: 'O que é um crédito de IA?', r: 'Uma ação de IA entregue: uma resposta do agente, um resumo de conversa, uma transcrição de áudio. Conversa que a equipe responde à mão não gasta crédito nenhum.' },
            { p: 'Quando a franquia renova?', r: '30 dias depois da contratação, não na virada do mês. O que sobra é descartado — crédito de plano não acumula.' },
            { p: 'Comprei créditos avulsos. Quando são usados?', r: 'Depois que o crédito do plano acaba. Eles valem 90 dias a partir da compra e não são tocados na renovação: o do plano morreria de qualquer jeito, o avulso é seu.' },
            { p: 'Troquei de plano. O que acontece com os créditos?', r: 'A franquia passa a ser a do plano novo na hora, e o que você já gastou no mês continua contado. Subir de plano dá a franquia maior hoje, não na renovação.' },
            { p: 'Posso comprar crédito durante a avaliação?', r: 'Não. A compra avulsa exige plano ativo — a avaliação já vem com os créditos dela.' },
            { p: 'O que acontece quando o crédito acaba?', r: 'O agente para de responder sozinho. Todo o resto continua: mensagens chegam, a equipe responde, CRM, agenda e relatórios funcionam. O rodapé da barra lateral fica vermelho avisando.' },
        ],
    },
    {
        grupo: 'Conversas e equipe',
        resumo:
            'Fila por departamento, fila geral, transferência, e o que cada papel vê.',
        icone: MessagesSquare,
        itens: [
            { p: 'Por que não vejo a fila de outra unidade?', r: 'A fila é do departamento da linha por onde a conversa entrou. Você vê as filas dos departamentos de que faz parte, mais a fila geral — linhas sem dono.' },
            { p: 'Como dou acesso a mais filas para alguém?', r: 'Conta → Usuários → abra a ficha → marque os departamentos. Pode marcar vários, e é assim que uma pessoa cobre duas filas sem ser transferida de setor.' },
            { p: 'Atendente vê os negócios e pacientes dos outros?', r: 'Não. Ele vê o negócio de que cuida e o paciente com quem fala. Quem administra ou gerencia vê tudo.' },
            { p: 'Como transfiro uma conversa para outra pessoa?', r: 'No cabeçalho da conversa, em Transferir. Só quem tem permissão de transferir vê a opção.' },
            { p: 'O que é a "fila geral"?', r: 'As conversas que não são de ninguém em particular: as que chegaram por linha sem departamento, e as que não têm linha. Todo mundo vê, para que nenhum atendimento fique órfão.' },
            { p: 'Dá para filtrar as conversas por agente?', r: 'Dá, no seletor Agente da barra de conversas — ele aparece quando há mais de um. Útil para quem tem um agente comercial e outro de recepção.' },
        ],
    },
    {
        grupo: 'Agenda e procedimentos',
        resumo:
            'De onde sai a duração, feriado, recesso, e por que um item não aparece.',
        icone: CalendarPlus,
        itens: [
            { p: 'De onde sai a duração de um compromisso?', r: 'Do item cadastrado em Vendas → Procedimentos. Avaliação 30 minutos, implante 120 — e é isso que impede o agente de encaixar uma cirurgia no buraco de uma consulta.' },
            { p: 'Como marco que a clínica atende num feriado?', r: 'Conta → Agenda da clínica. Os feriados nacionais já vêm bloqueando; desligue o que a clínica atende. A decisão vale para todos os especialistas.' },
            { p: 'Como cadastro um recesso ou fechamento?', r: 'Na mesma tela, em Novo fechamento: nome, data de início e fim. Pode ser o dia todo ou só um pedaço — dedetização das 14h às 18h, por exemplo.' },
            { p: 'Qual a diferença entre serviço, procedimento e produto?', r: 'Serviço e procedimento ocupam cadeira e por isso têm duração; produto é mercadoria e não entra na agenda. A diferença entre serviço e procedimento é de catálogo, para a clínica se organizar.' },
            { p: 'Por que meu serviço não aparece na agenda?', r: 'Verifique se ele está cadastrado como serviço ou procedimento (produto não aparece) e se o especialista tem esse item liberado na janela de atendimento dele.' },
        ],
    },
    {
        grupo: 'Pacientes e negócios',
        resumo:
            'Canal contra origem, responsável, ficha repetida, e de onde vêm os contatos.',
        icone: Users,
        itens: [
            { p: 'Qual a diferença entre canal e origem?', r: 'Canal é por onde a mensagem entrou — WhatsApp, Instagram, site — e o sistema grava sozinho. Origem é o que fez o paciente escrever: Facebook, indicação, a agência que trouxe o lead. Nenhum canal entrega essa informação, por isso ela é informada ou semeada pela linha.' },
            { p: 'Como a origem é preenchida sozinha?', r: 'Cada linha pode semear uma origem. Se o anúncio da agência leva ao número dela, toda ficha que nascer por ali já vem atribuída — sem ninguém digitar. Configure em Atendimento → Agentes → Canais.' },
            { p: 'Todo negócio precisa de responsável?', r: 'No cadastro pelo menu, sim: se é um negócio, alguém cuida dele. O negócio que nasce da primeira mensagem do paciente ganha dono quando alguém assume a conversa.' },
            { p: 'O mesmo paciente apareceu duas vezes. O que faço?', r: 'Acontece quando ele escreve de dois números, ou pelo WhatsApp e pelo Instagram — o sistema não tem como saber que é a mesma pessoa. Confira os dados e exclua a ficha repetida; as conversas da excluída vão junto, então mantenha a que tem o histórico.' },
            { p: 'Onde vejo de onde vêm meus pacientes?', r: 'No Dashboard, no gráfico de origem. Se ele mostra "Sem origem" para quase todos, é sinal de que as linhas ainda não semeiam origem e ninguém preencheu à mão.' },
        ],
    },
]

const TOTAL_FAQ = FAQ.reduce((n, g) => n + g.itens.length, 0)

/**
 * O texto de cada resposta já sem acento e em minúscula, montado uma vez.
 *
 * Sem isto a busca era sensível a acento: quem digitava "negocio" não achava
 * "negócio", e a palavra certa em português é justamente a acentuada — ou
 * seja, o termo que a pessoa consegue digitar rápido era o que não funcionava.
 *
 * É a mesma `normalizeSearch` que o banco usa para a coluna `searchText`, para
 * a busca da ajuda e a do resto do produto se comportarem igual.
 */
const INDICE = new Map(
    FAQ.flatMap((g) => g.itens).map((i) => [i.p, normalizeSearch(`${i.p} ${i.r}`)])
)

/** O mesmo para os guias, que também são conteúdo buscável. */
const INDICE_PASSOS = new Map(
    PASSOS.map((t) => [t.id, normalizeSearch(`${t.titulo} ${t.resumo} ${t.passos.join(' ')} ${t.nota}`)])
)

// ─── Os tópicos ──────────────────────────────────────────────────────────
/**
 * **O índice da central, e o que ele conserta.**
 *
 * A tela de 2026-10-18 mostrava tudo de uma vez: a capa, os três guias
 * desenhados, a seção de treinamento (o roteiro dos oito documentos, o prompt
 * de conversão e um acordeão de 2.500px), e por fim a lista inteira de
 * perguntas, com uma calha de tópicos à esquerda que filtrava só essa última
 * parte. Quem abria por um motivo específico — "o agente parou" — rolava três
 * telas de conteúdo que não pediu antes de chegar na busca do que queria. E a
 * calha filtrava o FAQ mas não os guias nem o treinamento, então "tópico" na
 * tela significava duas coisas diferentes.
 *
 * O desenho de 2026-11-09, pedido pelo Andre com o Respond.io como referência:
 * **a busca é a tela, e abaixo dela só os tópicos**. Cada tópico é um cartão
 * com nome, uma linha do que resolve e a contagem; escolher um abre **só** o
 * conteúdo dele, com volta para o índice. Buscar atravessa os três tipos de
 * conteúdo de uma vez e ignora o tópico aberto — procurar é querer achar em
 * qualquer lugar.
 *
 * Nada de conteúdo foi removido: guias, roteiro de treinamento, prompt de
 * conversão e as 28 respostas continuam todos aqui, e todos continuam
 * alcançáveis pela busca. O que mudou é que nenhum deles chega sem ser
 * chamado.
 *
 * Os dois primeiros tópicos não são grupos do FAQ — são as duas seções
 * próprias da tela —, e por isso a lista é montada aqui em vez de sair direto
 * de `FAQ`.
 */
interface Topico {
    id: string
    nome: string
    resumo: string
    icone: LucideIcon
    /** Quantos itens o tópico guarda. É o número do cartão. */
    n: number
    /** O rótulo do número, porque guia, documento e resposta não se somam. */
    unidade: string
}

const TOPICO_GUIAS = 'guias'
const TOPICO_TREINAMENTO = 'treinamento'

const TOPICOS: Topico[] = [
    {
        id: TOPICO_GUIAS,
        nome: 'Primeiros passos',
        resumo: 'Conectar o WhatsApp a um agente, marcar na agenda, dar acesso de fila a alguém.',
        icone: Compass,
        n: PASSOS.length,
        unidade: 'guias',
    },
    {
        id: TOPICO_TREINAMENTO,
        nome: 'Treinamento do agente',
        resumo: `Como preencher os ${DOCUMENTOS.length} documentos, e o prompt que organiza material que você já tem.`,
        icone: GraduationCap,
        n: DOCUMENTOS.length,
        unidade: 'documentos',
    },
    ...FAQ.map((g) => ({
        id: g.grupo,
        nome: g.grupo,
        resumo: g.resumo,
        icone: g.icone,
        n: g.itens.length,
        unidade: 'respostas',
    })),
]

export default function SuportePage() {
    const [busca, setBusca] = useState('')
    /** `null` é o índice de tópicos; qualquer outro valor é um tópico aberto. */
    const [topico, setTopico] = useState<string | null>(null)
    const [promptCopiado, setPromptCopiado] = useState(false)
    /** Os oito documentos nascem fechados; a busca os abre (ver o Collapsible). */
    const [docsAbertos, setDocsAbertos] = useState(false)
    const [contexto, setContexto] = useState('')

    /**
     * Quem está pedindo ajuda, dito junto com o pedido.
     *
     * Sem isto a primeira resposta do suporte é sempre "de qual clínica você
     * fala?" — uma ida e volta inteira antes de começar. Vai no corpo da
     * mensagem, à vista: nada é enviado sem a pessoa apertar enviar.
     */
    useEffect(() => {
        let cancelado = false
        Promise.all([
            fetch('/api/me').then((r) => (r.ok ? r.json() : null)),
            fetch('/api/account/subscription').then((r) => (r.ok ? r.json() : null)),
        ])
            .then(([eu, assinatura]) => {
                if (cancelado) return
                const partes = [
                    eu?.name ? `Sou ${eu.name}` : null,
                    assinatura?.workspaceName ? `da ${assinatura.workspaceName}` : null,
                    assinatura?.planName ? `(${assinatura.planName})` : null,
                ].filter(Boolean)
                setContexto(partes.length ? `${partes.join(' ')}. ` : '')
            })
            .catch(() => { /* sem contexto, a mensagem vai mesmo assim */ })
        return () => { cancelado = true }
    }, [])

    const mensagem = `${contexto}Preciso de ajuda com `
    const linkWhatsApp = `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(mensagem)}`
    const linkEmail = `mailto:${EMAIL}?subject=${encodeURIComponent('Ajuda — OdontoBox360')}&body=${encodeURIComponent(mensagem)}`

    /**
     * A busca varre pergunta **e** resposta: quem não sabe o termo certo
     * descreve o sintoma — "parou de responder" não está em nenhum título.
     *
     * Buscar ignora o tópico escolhido de propósito: procurar é querer achar em
     * qualquer lugar, e um resultado vazio por causa de um filtro que a pessoa
     * esqueceu que estava ligado é o pior tipo de nada encontrado.
     */
    const termo = normalizeSearch(busca)
    const buscando = termo.length > 0

    /**
     * O FAQ que a tela mostra.
     *
     * Buscando: todos os grupos, com as perguntas filtradas pelo termo. Com um
     * tópico de FAQ aberto: aquele grupo inteiro. No índice: nenhum — o índice
     * mostra cartões, não respostas.
     */
    const resultado = useMemo(() => {
        if (buscando) {
            return FAQ.map((g) => ({
                ...g,
                itens: g.itens.filter((i) => INDICE.get(i.p)?.includes(termo)),
            })).filter((g) => g.itens.length > 0)
        }
        if (topico === null || topico === TOPICO_GUIAS || topico === TOPICO_TREINAMENTO) return []
        return FAQ.filter((g) => g.grupo === topico)
    }, [termo, buscando, topico])

    /**
     * Os guias entram na busca como o resto — quem procura "agenda" tem no
     * guia da agenda a melhor resposta possível —, e fora da busca só aparecem
     * no tópico deles.
     */
    const guias = useMemo(() => {
        if (buscando) return PASSOS.filter((t) => INDICE_PASSOS.get(t.id)?.includes(termo))
        return topico === TOPICO_GUIAS ? PASSOS : []
    }, [termo, buscando, topico])

    /** O roteiro de treinamento, pelo mesmo critério. */
    const mostrarTreinamento = buscando
        ? TEXTO_TREINAMENTO.includes(termo)
        : topico === TOPICO_TREINAMENTO

    const achadosFaq = resultado.reduce((n, g) => n + g.itens.length, 0)
    /** Guia e roteiro são resultado como outro qualquer — e às vezes o melhor. */
    const achados = achadosFaq + (buscando ? guias.length + (mostrarTreinamento ? 1 : 0) : 0)

    /** O índice só aparece quando não há busca nem tópico aberto. */
    const noIndice = !buscando && topico === null
    const aberto = topico === null ? null : TOPICOS.find((t) => t.id === topico) ?? null

    /** Sair do tópico é voltar ao índice; buscar também, para não misturar. */
    const abrirTopico = (id: string) => {
        setBusca('')
        setTopico(id)
    }

    return (
        <div className="pb-16">
            {/* ─── Capa ────────────────────────────────────────────────────
                Numa base de conhecimento a busca **é** a tela: é o que resolve
                o caso de quem chegou com um problema na cabeça. Os canais
                ficam logo abaixo, à vista, para quem já sabe que precisa de
                gente. Nada de conteúdo acima da dobra além disso.

                A capa encurta quando se está dentro de um tópico ou de uma
                busca: ali a pessoa já escolheu, e a marca repetida em tamanho
                de página inicial empurra o conteúdo para fora da tela.
                ──────────────────────────────────────────────────────────── */}
            <header className="border-b border-border bg-card">
                <div
                    className={cn(
                        'mx-auto w-full max-w-4xl px-4 text-center md:px-8',
                        noIndice ? 'py-10 md:py-14' : 'py-6 md:py-8'
                    )}
                >
                    {/* `mx-auto` porque o `Logo` sai como `block`: o
                        `text-center` do cabeçalho alinha texto, não bloco — ele
                        ficava encostado à esquerda. */}
                    <Logo
                        variant="wordmark"
                        height={noIndice ? 90 : 56}
                        priority
                        className="mx-auto"
                    />
                    {noIndice ? (
                        <>
                            <h1 className="mt-5 text-[26px] font-bold tracking-tight md:text-[32px]">
                                Central de ajuda
                            </h1>
                            <p className="mx-auto mt-1.5 max-w-[48ch] text-sm text-muted-foreground">
                                {TOTAL_FAQ} respostas, {PASSOS.length} guias e o roteiro de
                                treinamento do agente.
                            </p>
                        </>
                    ) : (
                        <h1 className="mt-3 text-[19px] font-bold tracking-tight">
                            Central de ajuda
                        </h1>
                    )}

                    <div className="relative mx-auto mt-5 max-w-xl">
                        <Search className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-muted-foreground" />
                        <Input
                            value={busca}
                            onChange={(e) => setBusca(e.target.value)}
                            placeholder="Buscar — por exemplo: parou de responder, QR Code, crédito"
                            aria-label="Buscar na central de ajuda"
                            className="h-12 rounded-full pl-12 pr-4 text-[15px] shadow-sm"
                        />
                    </div>

                    {WHATSAPP || EMAIL ? (
                        <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-sm">
                            <span className="text-muted-foreground">Prefere falar com alguém?</span>
                            {WHATSAPP ? (
                                <a
                                    href={linkWhatsApp}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                                >
                                    <MessageCircle className="size-4" />
                                    <span className="num">{telefoneLegivel(WHATSAPP)}</span>
                                </a>
                            ) : null}
                            {EMAIL ? (
                                <a
                                    href={linkEmail}
                                    className="inline-flex items-center gap-1.5 rounded-full border border-border px-3.5 py-1.5 text-[13px] font-medium transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                                >
                                    <Mail className="size-4" />
                                    {EMAIL}
                                </a>
                            ) : null}
                        </div>
                    ) : (
                        <div className="mx-auto mt-6 max-w-md">
                            <EmptyState
                                variant="inline"
                                icon={LifeBuoy}
                                title="Canais de suporte ainda não configurados"
                                description="Defina NEXT_PUBLIC_SUPPORT_WHATSAPP e NEXT_PUBLIC_SUPPORT_EMAIL no ambiente."
                            />
                        </div>
                    )}
                </div>
            </header>

            <div className="mx-auto w-full max-w-6xl px-4 md:px-8">
                {/* ─── O índice de tópicos ─────────────────────────────────
                    Seis cartões e nada mais. Cada um diz o nome, uma linha do
                    que resolve e quantos itens guarda — o bastante para
                    escolher sem abrir. ─────────────────────────────────── */}
                {noIndice ? (
                    <section className="pt-10" aria-labelledby="topicos">
                        <h2
                            id="topicos"
                            className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground"
                        >
                            Tópicos
                        </h2>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            {TOPICOS.map((t) => (
                                <button
                                    key={t.id}
                                    type="button"
                                    onClick={() => abrirTopico(t.id)}
                                    className="group flex flex-col items-start rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/40 hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                                >
                                    <span className="flex size-9 items-center justify-center rounded-lg bg-primary-subtle text-primary-subtle-foreground">
                                        <t.icone className="size-[18px]" aria-hidden="true" />
                                    </span>
                                    <span className="mt-3 flex w-full items-baseline gap-2">
                                        <span className="text-[15px] font-bold leading-snug">
                                            {t.nome}
                                        </span>
                                        <ChevronRight
                                            className="ml-auto size-4 shrink-0 translate-x-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                                            aria-hidden="true"
                                        />
                                    </span>
                                    <span className="mt-1 text-xs leading-relaxed text-muted-foreground">
                                        {t.resumo}
                                    </span>
                                    <span className="num mt-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                        {t.n} {t.unidade}
                                    </span>
                                </button>
                            ))}
                        </div>
                    </section>
                ) : (
                    /* ─── Dentro de um tópico, ou dentro de uma busca ──────
                       A volta é um link e não um botão de contorno: é
                       navegação, e o lugar dela é no alto à esquerda do
                       conteúdo. Buscando, ela limpa a busca — que é o que
                       "voltar" significa ali. ─────────────────────────── */
                    <div className="pt-6">
                        <button
                            type="button"
                            onClick={() => {
                                setBusca('')
                                setTopico(null)
                            }}
                            className="inline-flex items-center gap-1.5 rounded-md text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                        >
                            <ArrowLeft className="size-3.5" aria-hidden="true" />
                            Todos os tópicos
                        </button>

                        {buscando ? (
                            <p className="mt-3 text-sm text-muted-foreground">
                                {achados === 0
                                    ? 'Nada encontrado para '
                                    : `${achados} ${achados === 1 ? 'resultado' : 'resultados'} para `}
                                <strong className="text-foreground">“{busca.trim()}”</strong>
                            </p>
                        ) : aberto ? (
                            <div className="mt-3">
                                <h2 className="text-[22px] font-bold tracking-tight">{aberto.nome}</h2>
                                <p className="mt-1 max-w-[70ch] text-sm text-muted-foreground">
                                    {aberto.resumo}
                                </p>
                            </div>
                        ) : null}
                    </div>
                )}

                {/* ─── Guias ───────────────────────────────────────────────
                    O tópico "Primeiros passos", e qualquer guia que a busca
                    encontre. ─────────────────────────────────────────── */}
                {guias.length > 0 ? (
                    <section className="pt-6">
                        {buscando ? (
                            <h2 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                                Guias ({guias.length})
                            </h2>
                        ) : null}
                        <div
                            className={cn(
                                'grid gap-4',
                                buscando && 'mt-3',
                                guias.length > 1 && 'lg:grid-cols-3'
                            )}
                        >
                            {guias.map((t) => (
                                <article
                                    key={t.id}
                                    className="flex flex-col overflow-hidden rounded-xl border border-border bg-card"
                                >
                                    <div className="border-b border-border p-4">
                                        <span className="flex size-9 items-center justify-center rounded-lg bg-primary-subtle text-primary-subtle-foreground">
                                            <t.icone className="size-[18px]" />
                                        </span>
                                        <h3 className="mt-3 text-[15px] font-bold leading-snug">{t.titulo}</h3>
                                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                                            {t.resumo}
                                        </p>
                                    </div>

                                    <div className="hidden px-4 pt-4 lg:block">
                                        <Maquete titulo={`Ilustração: ${t.titulo}`}>
                                            {ILUSTRACOES[t.id]}
                                        </Maquete>
                                    </div>

                                    <ol className="flex flex-col gap-2.5 p-4">
                                        {t.passos.map((passo, i) => (
                                            <li key={passo} className="flex gap-2.5 text-[13px] leading-relaxed">
                                                <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full border border-border-strong text-[11px] font-semibold text-primary-subtle-foreground">
                                                    {i + 1}
                                                </span>
                                                <span>{passo}</span>
                                            </li>
                                        ))}
                                    </ol>

                                    <p className="mt-auto border-t border-border bg-muted/40 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
                                        {t.nota}
                                    </p>
                                </article>
                            ))}
                        </div>
                    </section>
                ) : null}

                {/* ─── Treinamento do agente ───────────────────────────────
                    O roteiro dos documentos e o prompt de conversão. Era uma
                    seção sempre aberta no meio da tela; agora é um tópico, e
                    só aparece quando alguém o abre ou quando a busca o
                    encontra. ───────────────────────────────────────────── */}
                {mostrarTreinamento ? (
                    <section className="pt-6" aria-labelledby="treinamento">
                        {buscando ? (
                            <h2
                                id="treinamento"
                                className="mb-3 text-[11px] font-bold uppercase tracking-wider text-muted-foreground"
                            >
                                Treinamento do agente
                            </h2>
                        ) : null}

                        <div className="overflow-hidden rounded-xl border border-border bg-card">
                            <div className="border-b border-border p-5">
                                <h3 className="text-[15px] font-bold leading-snug">
                                    Como preencher os {DOCUMENTOS.length} documentos
                                </h3>
                                <p className="mt-1.5 max-w-[70ch] text-[13px] leading-relaxed text-muted-foreground">
                                    Treinar o agente é escrever {DOCUMENTOS.length} documentos, não
                                    ajustar dezenas de campos. Antes de começar, a regra que decide
                                    onde cada coisa vai — é a única decisão que erra caro.
                                </p>

                                <dl className="mt-4 grid gap-3 sm:grid-cols-3">
                                    {[
                                        { t: 'Regra', d: 'Quem o agente é, o que ele nunca faz, como conduz. Vai no prompt: não pode depender de a busca acertar.' },
                                        { t: 'Fato', d: 'Serviços, endereço, horário, perguntas e respostas. Vai na busca: não pode custar em toda mensagem.' },
                                        { t: 'Procedimento', d: '“Quando acontecer X, faça 1, 2, 3.” O gatilho fica à mão; os passos chegam na hora.' },
                                    ].map((x) => (
                                        <div key={x.t} className="rounded-lg border border-border bg-muted/40 p-3">
                                            <dt className="text-[13px] font-semibold">{x.t}</dt>
                                            <dd className="mt-1 text-xs leading-relaxed text-muted-foreground">{x.d}</dd>
                                        </div>
                                    ))}
                                </dl>

                                <p className="mt-3 max-w-[70ch] text-xs leading-relaxed text-muted-foreground">
                                    Na dúvida entre regra e fato, pergunte: <strong>se a busca não
                                    encontrar isto, o agente erra feio?</strong> Se sim, é regra.
                                </p>
                            </div>

                            {/* ─── Os documentos, atrás de um clique ───────────
                                A lista inteira são ~2.500px, quase três telas.
                                Mesmo dentro do tópico ela fica fechada: quem
                                abre "Treinamento" vem primeiro entender a regra
                                que divide prompt e busca.

                                **Mas abre sozinha durante a busca.** Conteúdo
                                colapsado é conteúdo que ninguém acha, e sem
                                isto procurar "cenários" mostraria a seção com a
                                resposta escondida dentro — o pior dos dois
                                mundos. É por isso que o `open` é controlado e
                                não um `defaultOpen`. ──────────────────────── */}
                            <Collapsible
                                open={docsAbertos || buscando}
                                onOpenChange={setDocsAbertos}
                                className="border-t border-border"
                            >
                                <CollapsibleTrigger className="group flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left text-[13.5px] font-semibold hover:bg-muted/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring">
                                    Ver os {DOCUMENTOS.length} documentos, um a um
                                    <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
                                </CollapsibleTrigger>
                                <CollapsibleContent>
                                    {/* Um bloco por documento, na ordem em que as
                                        guias aparecem na tela do agente — quem lê
                                        aqui está com aquela tela aberta do lado. */}
                                    <ol className="divide-y divide-border border-t border-border">
                                        {DOCUMENTOS.map((d, i) => (
                                            <li key={d.slug} className="grid gap-x-5 gap-y-2 p-5 md:grid-cols-[200px_1fr]">
                                                <div>
                                                    <div className="flex items-baseline gap-2">
                                                        <span className="num text-[11px] font-semibold text-muted-foreground">
                                                            {i + 1}
                                                        </span>
                                                        <h4 className="text-[14px] font-bold leading-snug">{d.item}</h4>
                                                    </div>
                                                    <p className="mt-1 text-xs text-muted-foreground">{d.titulo}</p>
                                                    <span className="mt-2 inline-flex rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                                                        {MODO[d.modo].rotulo}
                                                    </span>
                                                </div>

                                                <div className="min-w-0">
                                                    <p className="text-[13px] leading-relaxed">
                                                        {CONSELHO[d.slug]?.escreva}
                                                    </p>
                                                    <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
                                                        <strong className="font-semibold text-foreground">
                                                            O erro mais comum:
                                                        </strong>{' '}
                                                        {CONSELHO[d.slug]?.erro}
                                                    </p>
                                                    <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">
                                                        Seções, nesta ordem:{' '}
                                                        {d.secoes.map((sec, j) => (
                                                            <span key={sec}>
                                                                {j > 0 ? ' · ' : ''}
                                                                <code className="rounded bg-muted px-1 py-0.5 text-[11px]">{sec}</code>
                                                            </span>
                                                        ))}
                                                    </p>
                                                </div>
                                            </li>
                                        ))}
                                    </ol>
                                </CollapsibleContent>
                            </Collapsible>

                            <p className="border-t border-border bg-muted/40 px-5 py-3 text-xs leading-relaxed text-muted-foreground">
                                A seção <code className="rounded bg-muted px-1 py-0.5">{SECAO_EXEMPLOS}</code> existe
                                em todos eles e é reservada: ela mostra o jeito de responder e nunca
                                é usada como fonte de verdade. Escreva ali as falas de exemplo — elas
                                não entram na base consultável, de propósito.
                            </p>
                        </div>

                        {/* ─── O prompt de conversão ──────────────────────────
                            Para quem já tem material escrito e não quer
                            redigitar tudo em blocos. ───────────────────── */}
                        <div className="mt-4 overflow-hidden rounded-xl border border-border bg-card">
                            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-5">
                                <div className="min-w-0">
                                    <span className="flex size-9 items-center justify-center rounded-lg bg-primary-subtle text-primary-subtle-foreground">
                                        <Sparkles className="size-[18px]" />
                                    </span>
                                    <h3 className="mt-3 text-[15px] font-bold leading-snug">
                                        Já tem material escrito? Use este prompt
                                    </h3>
                                    <p className="mt-1.5 max-w-[70ch] text-[13px] leading-relaxed text-muted-foreground">
                                        Se a {BRAND.vocabulario.organizacao} já tem manual de
                                        atendimento, roteiro do consultor ou documento de
                                        treinamento, não redigite nada. Copie o prompt abaixo, cole
                                        numa inteligência artificial junto com o seu material, e
                                        ela devolve os arquivos já separados entre o que vai no
                                        prompt e o que vai na busca.
                                    </p>
                                </div>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 shrink-0"
                                    onClick={() => {
                                        void navigator.clipboard.writeText(PROMPT_DE_CONVERSAO)
                                        setPromptCopiado(true)
                                        setTimeout(() => setPromptCopiado(false), 2000)
                                    }}
                                >
                                    {promptCopiado ? 'Copiado' : 'Copiar prompt'}
                                </Button>
                            </div>

                            {/* `whitespace-pre-wrap` e não `pre`: as linhas
                                deste prompt são parágrafos, não código. Com
                                rolagem horizontal, 2.027px de texto couberam em
                                537px e quem lia via a frase cortada no meio —
                                ninguém rola um bloco para a direita para ler. */}
                            <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap break-words bg-muted/40 p-5 text-[12px] leading-relaxed">
                                <code>{PROMPT_DE_CONVERSAO}</code>
                            </pre>

                            <p className="border-t border-border px-5 py-3 text-xs leading-relaxed text-muted-foreground">
                                Revise antes de publicar. A inteligência artificial organiza o que você
                                deu, mas não confirma preço, prazo nem política — o que faltar vem
                                marcado como <code className="rounded bg-muted px-1 py-0.5">{'<!-- confirmar: ... -->'}</code>,
                                e comentário assim não chega ao agente. Depois é só usar{' '}
                                <strong className="font-semibold text-foreground">Importar .md</strong>{' '}
                                em cada guia de Treinamento, conferir, e publicar.
                            </p>
                        </div>
                    </section>
                ) : null}

                {/* ─── As respostas ────────────────────────────────────────
                    Sem a calha de tópicos à esquerda: ela filtrava só esta
                    parte da tela, e a escolha de tópico agora é o índice. ── */}
                {resultado.length > 0 ? (
                    <section className="pt-6">
                        <div className="flex max-w-4xl flex-col gap-7">
                            {resultado.map((g) => (
                                <div key={g.grupo}>
                                    {/* O nome do grupo só quando há mais de um na
                                        tela — dentro do tópico ele já está no
                                        título, e repetido vira eco. */}
                                    {resultado.length > 1 ? (
                                        <h3 className="mb-2.5 text-[15px] font-bold">{g.grupo}</h3>
                                    ) : null}
                                    <div className="overflow-hidden rounded-xl border border-border bg-card">
                                        {g.itens.map((item, i) => (
                                            <Collapsible
                                                key={item.p}
                                                className={cn(i > 0 && 'border-t border-border')}
                                            >
                                                <CollapsibleTrigger className="group flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left text-[13.5px] font-semibold hover:bg-muted/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring">
                                                    {item.p}
                                                    <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
                                                </CollapsibleTrigger>
                                                <CollapsibleContent className="px-5 pb-4 text-[13px] leading-relaxed text-muted-foreground">
                                                    {item.r}
                                                </CollapsibleContent>
                                            </Collapsible>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>
                ) : null}

                {/* Nada encontrado é estado da busca, não do índice. */}
                {buscando && achados === 0 ? (
                    <div className="max-w-xl pt-8">
                        <EmptyState
                            variant="inline"
                            icon={Search}
                            title="Nada encontrado"
                            description="Tente outra palavra — ou mande a dúvida no WhatsApp. Toda pergunta que chega três vezes vira uma resposta aqui."
                        />
                    </div>
                ) : null}

                {WHATSAPP ? (
                    <div className="mt-8 flex flex-col items-center gap-2.5 rounded-xl border border-dashed border-border px-6 py-7 text-center">
                        <LifeBuoy className="size-5 text-muted-foreground" />
                        <p className="text-sm font-bold">Não achou o que precisava?</p>
                        <p className="max-w-[44ch] text-xs leading-relaxed text-muted-foreground">
                            Toda pergunta que chega três vezes vira uma resposta nesta
                            página. Mandar a sua ajuda quem vier depois.
                        </p>
                        <Button asChild size="sm" className="mt-1">
                            <a href={linkWhatsApp} target="_blank" rel="noopener noreferrer">
                                <MessageCircle className="size-4" />
                                Falar no WhatsApp
                            </a>
                        </Button>
                    </div>
                ) : null}
            </div>
        </div>
    )
}
