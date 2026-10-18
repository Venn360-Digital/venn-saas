'use client'

import { useEffect, useMemo, useState } from 'react'
import {
    CalendarPlus,
    ChevronDown,
    LifeBuoy,
    Mail,
    MessageCircle,
    QrCode,
    Search,
    Users,
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
        nota: 'A duração vem do cadastro em Vendas → Serviços e procedimentos. Se o bloco sair do tamanho errado, é lá que se corrige — num lugar só, para todos os compromissos futuros.',
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

// ─── Perguntas frequentes ────────────────────────────────────────────────
const FAQ: { grupo: string; itens: { p: string; r: string }[] }[] = [
    {
        grupo: 'Agente e WhatsApp',
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
        grupo: 'Agenda e serviços',
        itens: [
            { p: 'De onde sai a duração de um compromisso?', r: 'Do item cadastrado em Vendas → Serviços e procedimentos. Avaliação 30 minutos, implante 120 — e é isso que impede o agente de encaixar uma cirurgia no buraco de uma consulta.' },
            { p: 'Como marco que a clínica atende num feriado?', r: 'Conta → Agenda da clínica. Os feriados nacionais já vêm bloqueando; desligue o que a clínica atende. A decisão vale para todos os especialistas.' },
            { p: 'Como cadastro um recesso ou fechamento?', r: 'Na mesma tela, em Novo fechamento: nome, data de início e fim. Pode ser o dia todo ou só um pedaço — dedetização das 14h às 18h, por exemplo.' },
            { p: 'Qual a diferença entre serviço, procedimento e produto?', r: 'Serviço e procedimento ocupam cadeira e por isso têm duração; produto é mercadoria e não entra na agenda. A diferença entre serviço e procedimento é de catálogo, para a clínica se organizar.' },
            { p: 'Por que meu serviço não aparece na agenda?', r: 'Verifique se ele está cadastrado como serviço ou procedimento (produto não aparece) e se o especialista tem esse item liberado na janela de atendimento dele.' },
        ],
    },
    {
        grupo: 'Pacientes e negócios',
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

export default function SuportePage() {
    const [busca, setBusca] = useState('')
    const [topico, setTopico] = useState<string>('todos')
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

    const resultado = useMemo(() => {
        const base = buscando || topico === 'todos' ? FAQ : FAQ.filter((g) => g.grupo === topico)
        if (!buscando) return base
        return base
            .map((g) => ({ ...g, itens: g.itens.filter((i) => INDICE.get(i.p)?.includes(termo)) }))
            .filter((g) => g.itens.length > 0)
    }, [termo, buscando, topico])

    /**
     * Os guias também entram na busca.
     *
     * Antes eles sumiam enquanto se buscava — então procurar "agenda" escondia
     * justamente o guia de criar compromisso na agenda, que é a melhor
     * resposta para quem digitou aquilo.
     */
    const guias = useMemo(
        () => (buscando ? PASSOS.filter((t) => INDICE_PASSOS.get(t.id)?.includes(termo)) : PASSOS),
        [termo, buscando]
    )

    const achadosFaq = resultado.reduce((n, g) => n + g.itens.length, 0)
    /** Guia encontrado é resultado como outro qualquer — e às vezes o melhor. */
    const achados = achadosFaq + (buscando ? guias.length : 0)

    return (
        <div className="pb-16">
            {/* ─── Capa: a busca é o elemento principal de uma base de
                conhecimento; os canais ficam logo abaixo, à vista, sem tomar
                o lugar dela. ──────────────────────────────────────────── */}
            <header className="border-b border-border bg-card">
                <div className="mx-auto w-full max-w-4xl px-4 py-10 text-center md:px-8 md:py-14">
                    {/* `mx-auto` porque o `Logo` sai como `block`: o
                        `text-center` do cabeçalho alinha texto, não bloco — ele
                        ficava encostado à esquerda. */}
                    <Logo variant="wordmark" height={90} priority className="mx-auto" />
                    <h1 className="mt-5 text-[26px] font-bold tracking-tight md:text-[32px]">
                        Central de ajuda
                    </h1>
                    <p className="mx-auto mt-1.5 max-w-[48ch] text-sm text-muted-foreground">
                        {TOTAL_FAQ} respostas e {PASSOS.length} guias sobre o que a clínica faz todo dia.
                    </p>

                    <div className="relative mx-auto mt-6 max-w-xl">
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
                        <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-sm">
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
                {/* Os guias entram na busca como o resto: quem procura "agenda"
                    tem no guia da agenda a melhor resposta possível. */}
                {guias.length > 0 ? (
                    <section className="pt-10">
                        <h2 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                            {buscando ? `Guias (${guias.length})` : 'Guias'}
                        </h2>
                        <div className={cn('mt-3 grid gap-4', guias.length > 1 && 'lg:grid-cols-3')}>
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

                {/* ─── Tópicos à esquerda, respostas à direita: é assim que se
                    navega uma base de conhecimento — browsing, não só busca.
                    Abaixo de `lg` a coluna vira uma fileira rolável. ────── */}
                <section className="grid gap-8 py-10 lg:grid-cols-[216px_1fr]">
                    <nav aria-label="Tópicos" className="lg:sticky lg:top-6 lg:self-start">
                        <h2 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                            Tópicos
                        </h2>
                        <ul className="flex gap-1.5 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
                            {[{ grupo: 'todos', n: TOTAL_FAQ }, ...FAQ.map((g) => ({ grupo: g.grupo, n: g.itens.length }))].map((t) => (
                                <li key={t.grupo} className="shrink-0 lg:shrink">
                                    <button
                                        type="button"
                                        onClick={() => { setTopico(t.grupo); setBusca('') }}
                                        aria-pressed={!buscando && topico === t.grupo}
                                        className={cn(
                                            'flex w-full items-center justify-between gap-3 whitespace-nowrap rounded-lg px-3 py-2 text-left text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                                            !buscando && topico === t.grupo
                                                ? 'bg-primary-subtle font-semibold text-primary-subtle-foreground'
                                                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                                        )}
                                    >
                                        {t.grupo === 'todos' ? 'Todas as respostas' : t.grupo}
                                        <span className="num text-[11px] opacity-70">{t.n}</span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </nav>

                    <div className="min-w-0">
                        {buscando ? (
                            <p className="mb-3 text-sm text-muted-foreground">
                                {achados === 0
                                    ? 'Nada encontrado para '
                                    : `${achados} ${achados === 1 ? 'resultado' : 'resultados'} para `}
                                <strong className="text-foreground">“{busca.trim()}”</strong>
                            </p>
                        ) : null}

                        {achadosFaq === 0 && achados > 0 ? null : achados === 0 ? (
                            <EmptyState
                                variant="inline"
                                icon={Search}
                                title="Nada encontrado"
                                description="Tente outra palavra — ou mande a dúvida no WhatsApp. Toda pergunta que chega três vezes vira uma resposta aqui."
                            />
                        ) : (
                            <div className="flex flex-col gap-7">
                                {resultado.map((g) => (
                                    <div key={g.grupo}>
                                        <h3 className="mb-2.5 text-[15px] font-bold">{g.grupo}</h3>
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
                        )}

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
                </section>
            </div>
        </div>
    )
}
