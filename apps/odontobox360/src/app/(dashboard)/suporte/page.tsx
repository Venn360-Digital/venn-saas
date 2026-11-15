'use client'

import { useEffect, useMemo, useState } from 'react'
import {
    Bot,
    CalendarPlus,
    ChevronDown,
    CreditCard,
    LifeBuoy,
    Mail,
    MessageCircle,
    MessagesSquare,
    Search,
    Users,
    X,
    type LucideIcon,
} from 'lucide-react'

import { Logo } from '@venn/core/components/brand/Logo'
import { Button } from '@venn/ui/button'
import { Input } from '@venn/ui/input'
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from '@venn/ui/collapsible'
import { EmptyState } from '@venn/core/components/shared/EmptyState'
import { cn } from '@venn/ui/utils'
import { normalizeSearch } from '@venn/core/lib/search'

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
        grupo: 'Agenda e servicos',
        resumo:
            'De onde sai a duração, feriado, recesso, e por que um item não aparece.',
        icone: CalendarPlus,
        itens: [
            { p: 'De onde sai a duração de um compromisso?', r: 'Do item cadastrado em Vendas → Procedimentos. Avaliação 30 minutos, implante 120 — e é isso que impede o agente de encaixar uma cirurgia no buraco de uma consulta.' },
            { p: 'Como marco que a clínica atende num feriado?', r: 'Conta → Agenda da clínica. Os feriados nacionais já vêm bloqueando; desligue o que a clínica atende. A decisão vale para todos os profissionais.' },
            { p: 'Como cadastro um recesso ou fechamento?', r: 'Na mesma tela, em Novo fechamento: nome, data de início e fim. Pode ser o dia todo ou só um pedaço — dedetização das 14h às 18h, por exemplo.' },
            { p: 'Qual a diferença entre serviço, servico e produto?', r: 'Serviço e servico ocupam cadeira e por isso têm duração; produto é mercadoria e não entra na agenda. A diferença entre serviço e servico é de catálogo, para a clínica se organizar.' },
            { p: 'Por que meu serviço não aparece na agenda?', r: 'Verifique se ele está cadastrado como serviço ou servico (produto não aparece) e se o profissional tem esse item liberado na janela de atendimento dele.' },
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

/**
 * **O que esta tela deixou de ter, e por quê.**
 *
 * Saíram os três guias desenhados (com as maquetes em SVG), o roteiro de
 * preenchimento dos documentos de treinamento, o prompt de conversão de
 * material pronto e o índice de tópicos em cartões. Decisão do Andre em
 * 2026-11-09, depois de ver o desenho: a central começa na logo e termina nos
 * contatos, ocupando a tela inteira, e **só a busca traz conteúdo**.
 *
 * O que isso resolve: nenhuma das três versões anteriores conseguia ser uma
 * porta de entrada. A de 2026-10-18 empilhava tudo na mesma rolagem; a de
 * 2026-11-09 (manhã) trocou a pilha por seis cartões de tópico, o que é melhor
 * mas ainda é uma página de conteúdo — quem chega com "o agente parou" lê seis
 * títulos antes de digitar. Agora a primeira tela faz uma pergunta só: o que
 * você precisa? E as duas saídas estão as duas à vista — o campo e o WhatsApp.
 *
 * O que foi perdido e vale dizer: o roteiro dos documentos **derivava do
 * catálogo** (`lib/treinamento/documentos.ts`), então nunca divergia do
 * produto. Ele não foi reescrito à mão em outro lugar — simplesmente não tem
 * mais onde morar. Se voltar, o lugar natural é a própria tela de Treinamento
 * do agente, que é onde alguém está com o documento aberto.
 */
export default function SuportePage() {
    const [busca, setBusca] = useState('')
    const [contexto, setContexto] = useState('')

    /**
     * Quem está pedindo ajuda, dito junto com o pedido.
     *
     * Sem isto a primeira resposta do suporte é sempre "de qual unidade você
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
     */
    const termo = normalizeSearch(busca)
    const buscando = termo.length > 0

    /**
     * Os tópicos que a busca encontrou, cada um com as perguntas que casaram.
     *
     * É o único conteúdo que esta tela mostra, e só depois de alguém digitar.
     * Fora da busca não há lista, cartão nem acordeão — ver a nota do alto do
     * arquivo sobre o que saiu daqui em 2026-11-09.
     */
    const encontrados = useMemo(() => {
        if (!buscando) return []
        return FAQ.map((g) => ({
            ...g,
            /** Quantas o tópico tem, para o "3 de 6" ao lado do nome dele. */
            todas: g.itens.length,
            itens: g.itens.filter((i) => INDICE.get(i.p)?.includes(termo)),
        })).filter((g) => g.itens.length > 0)
    }, [termo, buscando])

    const achados = encontrados.reduce((n, g) => n + g.itens.length, 0)

    const canais = WHATSAPP || EMAIL ? (
        <div className="flex flex-wrap items-center justify-center gap-2 text-sm">
            <span className="text-muted-foreground">Prefere falar com alguém?</span>
            {WHATSAPP ? (
                <a
                    href={linkWhatsApp}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                    <MessageCircle className="size-4" aria-hidden="true" />
                    <span className="num">{telefoneLegivel(WHATSAPP)}</span>
                </a>
            ) : null}
            {EMAIL ? (
                <a
                    href={linkEmail}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border px-3.5 py-1.5 text-[13px] font-medium transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                    <Mail className="size-4" aria-hidden="true" />
                    {EMAIL}
                </a>
            ) : null}
        </div>
    ) : (
        <div className="mx-auto max-w-md">
            <EmptyState
                variant="inline"
                icon={LifeBuoy}
                title="Canais de suporte ainda não configurados"
                description="Defina NEXT_PUBLIC_SUPPORT_WHATSAPP e NEXT_PUBLIC_SUPPORT_EMAIL no ambiente."
            />
        </div>
    )

    return (
        /* `min-h-full` com a capa em `flex-1`: parada, ela ocupa a região de
           conteúdo inteira — é a tela toda, como ele pediu. Buscando, deixa de
           crescer e os resultados rolam embaixo dela. */
        <div className="flex min-h-full flex-col">
            <header
                className={cn(
                    'flex shrink-0 flex-col items-center justify-center border-b border-border bg-card px-4 text-center md:px-8',
                    buscando ? 'py-7' : 'flex-1 py-12'
                )}
            >
                {/* `mx-auto` porque o `Logo` sai como `block`: o `text-center`
                    alinha texto, não bloco. A marca encolhe na busca — ali a
                    pessoa já entrou, e tamanho de porta de entrada empurra o
                    que ela procurou para fora da tela. */}
                <Logo
                    variant="wordmark"
                    height={buscando ? 52 : 104}
                    priority
                    className="mx-auto"
                />

                {buscando ? null : (
                    <>
                        <h1 className="mt-6 text-[28px] font-bold tracking-tight md:text-[34px]">
                            Central de ajuda
                        </h1>
                        <p className="mx-auto mt-2 max-w-[46ch] text-[15px] text-muted-foreground">
                            Descreva o que está acontecendo. São {TOTAL_FAQ} respostas sobre o dia a
                            dia do atendimento, da agenda e do plano.
                        </p>
                    </>
                )}

                {/* O campo não encolhe junto com a capa: ele é a saída de
                    qualquer estado da tela, inclusive do "nada encontrado". */}
                <div className="relative mx-auto mt-6 w-full max-w-xl">
                    <Search
                        className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-muted-foreground"
                        aria-hidden="true"
                    />
                    <Input
                        value={busca}
                        onChange={(e) => setBusca(e.target.value)}
                        placeholder="Buscar — por exemplo: parou de responder, QR Code, crédito"
                        aria-label="Buscar na central de ajuda"
                        className="h-12 rounded-full pl-12 pr-11 text-[15px]"
                    />
                    {buscando ? (
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Limpar a busca"
                            onClick={() => setBusca('')}
                            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full text-muted-foreground"
                        >
                            <X className="size-4" />
                        </Button>
                    ) : null}
                </div>

                {/* **A capa termina nos contatos** — pedido dele. Quem não acha
                    a resposta no campo tem a segunda saída no mesmo quadro, sem
                    rolar. */}
                <div className="mt-7">{canais}</div>
            </header>

            {/* ─── O que a busca encontrou ─────────────────────────────────
                A tela se ajusta ao tópico achado: o nome do grupo, a linha que
                diz o que ele resolve, e as perguntas que casaram — abertas num
                clique. Quando a busca cruza dois assuntos, aparecem os dois,
                cada um com o seu nome. ─────────────────────────────────── */}
            {buscando ? (
                <div className="mx-auto w-full max-w-3xl px-4 py-8 md:px-8">
                    <p className="text-sm text-muted-foreground">
                        {achados === 0
                            ? 'Nada encontrado para '
                            : `${achados} ${achados === 1 ? 'resposta' : 'respostas'} em ${encontrados.length} ${encontrados.length === 1 ? 'tópico' : 'tópicos'}, para `}
                        <strong className="font-semibold text-foreground">
                            “{busca.trim()}”
                        </strong>
                    </p>

                    {achados === 0 ? (
                        <div className="mt-5">
                            <EmptyState
                                variant="inline"
                                icon={Search}
                                title="Nada encontrado"
                                description="Tente outra palavra — ou mande a dúvida no WhatsApp. Toda pergunta que chega três vezes vira uma resposta aqui."
                            />
                        </div>
                    ) : (
                        <div className="mt-5 flex flex-col gap-7">
                            {encontrados.map((g) => (
                                <section key={g.grupo}>
                                    <header className="flex items-start gap-3">
                                        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-subtle text-primary-subtle-foreground">
                                            <g.icone className="size-[18px]" aria-hidden="true" />
                                        </span>
                                        <div className="min-w-0">
                                            <h2 className="text-[16px] font-bold leading-snug">
                                                {g.grupo}
                                            </h2>
                                            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                                                {g.resumo}
                                            </p>
                                        </div>
                                        <span className="num ml-auto shrink-0 pt-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                            {g.itens.length} de {g.todas}
                                        </span>
                                    </header>

                                    <div className="mt-3 overflow-hidden rounded-xl border border-border bg-card">
                                        {g.itens.map((item, i) => (
                                            <Collapsible
                                                key={item.p}
                                                /* A primeira resposta do primeiro
                                                   tópico nasce aberta: quem digitou
                                                   o sintoma quer ler, não clicar de
                                                   novo. As outras ficam fechadas,
                                                   senão a tela é uma parede. */
                                                defaultOpen={i === 0 && g.grupo === encontrados[0].grupo}
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
                                </section>
                            ))}
                        </div>
                    )}

                    {WHATSAPP ? (
                        <p className="mt-8 text-center text-xs leading-relaxed text-muted-foreground">
                            Não era isso?{' '}
                            <a
                                href={linkWhatsApp}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-semibold text-primary-subtle-foreground underline underline-offset-2"
                            >
                                Mande a dúvida no WhatsApp
                            </a>{' '}
                            — toda pergunta que chega três vezes vira uma resposta nesta página.
                        </p>
                    ) : null}
                </div>
            ) : null}
        </div>
    )
}
