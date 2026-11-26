'use client'

import { useCallback, useEffect, useState } from 'react'
import {
    BadgeCheck,
    ChevronRight,
    Facebook,
    Globe,
    Loader2,
    Pencil,
    PlugZap,
    Plus,
    QrCode,
    Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { WidgetDoSite } from '../WidgetDoSite'
import { WIDGET_PADRAO, type ConfiguracaoDoWidget } from '../../../../lib/widget-config'

import { Button } from '@venn/ui/button'
import { Input } from '@venn/ui/input'
import { Switch } from '@venn/ui/switch'
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectLabel,
    SelectSeparator,
    SelectTrigger,
    SelectValue,
} from '@venn/ui/select'
import type {
    EstrategiaDeDistribuicao,
    PoliticaDoCanal,
} from '../../../../lib/conversas/distribuicao'
import { ConfirmDialog } from '../../../shared/ConfirmDialog'
import { SettingsCard, SettingsRow } from '../../../shared/TabsFrame'
import { InstagramConnect } from '../InstagramConnect'
import { MetaEmbeddedSignup } from '../MetaEmbeddedSignup'
import { apelidoDaLinha } from '../../../../lib/linha'
import { formatPhone } from '../../../../lib/phone'
import { cn } from '@venn/ui/utils'
import { WhatsAppQRModal } from '../WhatsAppQRModal'
import { useVocab } from '../../../../hooks/useVocab'
import { comArtigo } from '../../../../lib/concordancia'
import type { Vocabulario } from '../../../../lib/vocabulario'

/**
 * Os canais do agente — e, no WhatsApp, as **linhas** dele.
 *
 * A aba oferecia um cartão por canal e um botão Conectar, o que embutia na tela
 * a regra de um número por agente: não havia onde um segundo número aparecer.
 * Uma clínica com duas unidades no mesmo agente precisava de dois agentes
 * iguais, cada um com seu número, e as conversas das duas unidades se
 * misturavam num fio só.
 *
 * Aqui o WhatsApp é uma lista: cada linha tem nome, número, estado e as suas
 * ações. O teto é o do plano, dito antes do clique em vez de depois.
 */

interface Line {
    id: string
    label: string | null
    departmentId: string | null
    /** A origem que esta linha semeia na ficha de quem escreve por ela. */
    defaultOriginId: string | null
    phoneNumber: string | null
    status: string
    connectedAt: string | null
    lastActiveAt: string | null
    errorMessage: string | null
    paired: boolean
}

interface LineLimit {
    used: number
    max: number
    remaining: number
}

interface CanaisTabProps {
    agentId?: string | null
    /**
     * Se quem olha pode mexer nas linhas.
     *
     * Conectar e desconectar um número é de administrador: um clique errado
     * aqui derruba o WhatsApp da clínica inteira. Quem não administra lê a
     * lista — qual número, qual fila, se está no ar — e não vê os botões.
     */
    canManage?: boolean
}

/**
 * Os canais que ainda não existem, ditos como tal.
 *
 * Dois saíram daqui ao ganhar botão: o WhatsApp oficial e, depois dele, o
 * Instagram — que passou a ter cartão próprio, logo abaixo. Sobrou o Facebook,
 * que é de verdade o único ainda por fazer.
 */
/** Função, não constante: o texto usa o vocabulário da unidade, que vem do
 * hook no componente. No cliente `vocab()` não serve — `BRAND()` lança no
 * navegador —, e hook não alcança nível de módulo. */
function OUTROS_CANAIS(v: Vocabulario) {
    return [
    {
        id: 'facebook',
        name: 'Messenger',
        description: `Mensagens da página ${comArtigo(v, 'organizacao', 'de')} no Facebook`,
        icon: Facebook,
    },
]
}



/** O nome da linha na tela: o apelido, senão o número, senão "Linha sem número". */
function nomeDaLinha(line: Line): string {
    return apelidoDaLinha(line, 'Linha sem número')
}

/**
 * O comando da linha — o mesmo em todos os canais da tela.
 *
 * A guia tinha seis jeitos de dizer duas coisas: "Conectar", "Reconectar",
 * "Desconectar", "Desligado", "Não conectado" e "Desconectada". O Andre
 * padronizou em 2026-10-20: **uma chave, no fim da linha, e duas palavras** —
 * No ar e Fora do ar. Vale para WhatsApp QR, site, canal oficial e Instagram.
 *
 * **O terceiro estado não é de repouso, é a travessia.** Desligar é nosso e
 * vale no clique; ligar nem sempre — uma linha que nunca pareou precisa de QR
 * Code no celular, e a Meta pode levar um minuto. Uma chave que acende e volta
 * sozinha para cinza lê como defeito do sistema, não como "não deu certo".
 * Então enquanto a resposta não vem ela não acende: fica desabilitada, com o
 * giro ao lado e dizendo o que espera.
 *
 * A largura mínima prende as chaves na mesma vertical de linha para linha e de
 * cartão para cartão. Sem ela, "Fora do ar" empurra o interruptor para um lado
 * e "No ar" para outro, e a coluna deixa de ser coluna.
 */
function Chave({
    estado,
    rotulo,
    nome,
    disabled,
    onChange,
}: {
    estado: 'ok' | 'fora' | 'indo'
    /** O que a chave espera, quando está em travessia. */
    rotulo?: string
    /** O nome da linha, para quem lê a tela com leitor de tela. */
    nome: string
    disabled?: boolean
    onChange: (ligar: boolean) => void
}) {
    const texto = estado === 'indo' ? (rotulo ?? 'Aguardando…') : estado === 'ok' ? 'No ar' : 'Fora do ar'

    return (
        <span className="flex min-w-[7rem] items-center justify-end gap-2">
            {estado === 'indo' ? (
                <Loader2 className="size-3 shrink-0 animate-spin text-warning-subtle-foreground" />
            ) : null}
            <span
                className={cn(
                    'whitespace-nowrap text-[11px]',
                    estado === 'ok' && 'font-semibold text-success-subtle-foreground',
                    estado === 'indo' && 'font-semibold text-warning-subtle-foreground',
                    estado === 'fora' && 'text-muted-foreground'
                )}
            >
                {texto}
            </span>
            <Switch
                checked={estado === 'ok'}
                disabled={disabled || estado === 'indo'}
                onCheckedChange={onChange}
                aria-label={`${estado === 'ok' ? 'Desligar' : 'Ligar'} ${nome}`}
            />
        </span>
    )
}

/** O fio que separa mexer na linha de ligar a linha. */
function Fio() {
    return <span aria-hidden="true" className="h-4 w-px shrink-0 bg-border" />
}

interface Escolha {
    valor: string | null
    opcoes: { id: string; name: string }[]
    vazio: string
    onChange: (v: string | null) => void
}

/**
 * O seletor de uma decisão da linha — fila, origem ou mídia.
 *
 * Origem e mídia moravam num cartão à parte, "De onde vem cada linha", montado
 * como tabela de de-para; a fila ficava espremida entre os botões da linha. São
 * três perguntas da mesma natureza — decisão **sobre** a linha, não ação sobre
 * ela —, e ficavam em três lugares. O Andre juntou as três junto do canal em
 * 2026-10-20, e elas viraram colunas.
 *
 * Some quando não há o que escolher: clínica sem departamento não tem fila a
 * decidir, e um seletor com uma opção só é pergunta sem resposta.
 */
function SeletorDaLinha({
    rotulo,
    nome,
    canManage,
    escolha,
}: {
    rotulo: string
    nome: string
    canManage: boolean
    escolha: Escolha
}) {
    return (
        <td className="px-2.5 py-2 align-middle">
            {escolha.opcoes.length === 0 ? (
                <span className="text-[11px] text-muted-foreground">—</span>
            ) : (
                <Select
                    value={escolha.valor ?? 'none'}
                    disabled={!canManage}
                    onValueChange={(v) => escolha.onChange(v === 'none' ? null : v)}
                >
                    <SelectTrigger
                        aria-label={`${rotulo} de ${nome}`}
                        className="h-8 w-full max-w-[11rem] text-xs"
                    >
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="none">{escolha.vazio}</SelectItem>
                        {escolha.opcoes.map((o) => (
                            <SelectItem key={o.id} value={o.id}>
                                {o.name}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            )}
        </td>
    )
}

/**
 * O seletor de **quem recebe** as conversas de um canal.
 *
 * ## Três opções, e o André as fixou
 *
 * Em 26/11/2026: "as opções de atribuição devem ser: atendente específico,
 * rodízio, balanceamento". Mais o item de herança, que não é uma quarta
 * estratégia — é a **ausência** de escolha, e existe porque a regra da conta
 * continua valendo para todo canal que não disser nada.
 *
 * O que ficou fora, de propósito: as variantes "só quem está online". Elas são
 * o interruptor `soDisponiveis`, que é da operação da clínica e vive na tela da
 * conta; repetido por canal, dobraria esta lista para dizer o que já está dito
 * uma vez. Ver `PoliticaDoCanal`.
 *
 * ## Um seletor, não dois
 *
 * A pergunta é uma — quem atende este canal — e as respostas vivem em dois
 * planos: uma estratégia de fila ou uma pessoa. Juntá-las numa lista é o que faz
 * "este canal é da Fulana" ser um clique, em vez de uma estratégia mais um
 * campo que só aparece depois.
 */
const HERANCA = 'heranca'

const OPCOES_DE_FILA: { valor: EstrategiaDeDistribuicao; rotulo: string }[] = [
    { valor: 'rodizio', rotulo: 'Rodízio' },
    { valor: 'balanceado', rotulo: 'Balanceamento' },
]

/** O valor do seletor para o que está gravado. `fixo` carrega a pessoa no valor. */
function valorDaPolitica(p: PoliticaDoCanal | null): string {
    if (!p) return HERANCA
    if (p.estrategia === 'fixo') return p.donoFixoUserId ? `fixo:${p.donoFixoUserId}` : HERANCA
    return OPCOES_DE_FILA.some((o) => o.valor === p.estrategia) ? p.estrategia : HERANCA
}

/** O caminho de volta. `null` devolve o canal à regra da conta. */
function politicaDoValor(valor: string): PoliticaDoCanal | null {
    if (valor === HERANCA) return null
    if (valor.startsWith('fixo:')) {
        return { estrategia: 'fixo', donoFixoUserId: valor.slice('fixo:'.length) }
    }
    const fila = OPCOES_DE_FILA.find((o) => o.valor === valor)
    return fila ? { estrategia: fila.valor, donoFixoUserId: null } : null
}

/**
 * O corpo do seletor, usado nas duas formas de desenho: dentro da tabela do
 * WhatsApp QR e solto na linha dos canais de número único.
 *
 * Um componente e não dois porque a lista de opções é a mesma, e duas cópias
 * dela divergiriam no dia em que uma estratégia nova entrasse — foi exatamente
 * o que aconteceu com a atribuição nascendo só na rota do QR.
 */
function CorpoDaAtribuicao({
    nome,
    canManage,
    politica,
    atendentes,
    onChange,
    className,
}: {
    nome: string
    canManage: boolean
    politica: PoliticaDoCanal | null
    atendentes: { id: string; name: string }[]
    onChange: (p: PoliticaDoCanal | null) => void
    className: string
}) {
    /**
     * A pessoa apontada saiu da clínica — e a tela **tem de dizer isso**.
     *
     * O id do atendente mora no JSON do canal, sem chave estrangeira que o limpe
     * quando alguém é desativado. O sistema já se protege (ela não entra na lista
     * de elegíveis e a conversa cai na fila geral), mas sem este item o seletor
     * ficaria em branco: o canal estaria configurado para ninguém e a tela não
     * saberia explicar por quê.
     */
    const fixoOrfao =
        politica?.estrategia === 'fixo' &&
        !!politica.donoFixoUserId &&
        !atendentes.some((a) => a.id === politica.donoFixoUserId)

    return (
        <Select
            value={valorDaPolitica(politica)}
            disabled={!canManage}
            onValueChange={(v) => onChange(politicaDoValor(v))}
        >
            <SelectTrigger aria-label={`Atribuição de ${nome}`} className={className}>
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                <SelectItem value={HERANCA}>Como na conta</SelectItem>
                <SelectSeparator />
                {OPCOES_DE_FILA.map((o) => (
                    <SelectItem key={o.valor} value={o.valor}>
                        {o.rotulo}
                    </SelectItem>
                ))}
                {atendentes.length > 0 ? (
                    <>
                        <SelectSeparator />
                        {/*
                         * `SelectGroup` é **obrigatório** em volta do
                         * `SelectLabel`, e a falta dele não é detalhe de
                         * marcação: `SelectLabel` lê o contexto do grupo e o
                         * Radix **lança** `must be used within SelectGroup`
                         * quando ele não existe.
                         *
                         * Pior, lança no carregamento e não ao abrir a lista:
                         * `SelectContent` fechado ainda monta os filhos num
                         * DocumentFragment para recolher os itens. Em
                         * 26/11/2026 isso derrubou a aba inteira de Canais em
                         * homologação, no instante em que a primeira linha de
                         * WhatsApp passou a existir — antes dela a tabela não
                         * renderizava célula nenhuma e o defeito ficava
                         * escondido. Varrido por `scripts/lint-select-group.mjs`.
                         */}
                        <SelectGroup>
                            <SelectLabel>Atendente específico</SelectLabel>
                            {atendentes.map((a) => (
                                <SelectItem key={a.id} value={`fixo:${a.id}`}>
                                    {a.name}
                                </SelectItem>
                            ))}
                        </SelectGroup>
                    </>
                ) : null}
                {fixoOrfao ? (
                    <SelectItem value={`fixo:${politica!.donoFixoUserId}`} disabled>
                        Atendente removido — escolha outro
                    </SelectItem>
                ) : null}
            </SelectContent>
        </Select>
    )
}

/** Dentro da tabela do WhatsApp QR, como as outras colunas. */
function SeletorDeAtribuicao(props: {
    nome: string
    canManage: boolean
    politica: PoliticaDoCanal | null
    atendentes: { id: string; name: string }[]
    onChange: (p: PoliticaDoCanal | null) => void
}) {
    return (
        <td className="px-2.5 py-2 align-middle">
            <CorpoDaAtribuicao {...props} className="h-8 w-full max-w-[13rem] text-xs" />
        </td>
    )
}

/** Solto na linha do canal, para os canais de número único. */
function AtribuicaoSolta(props: {
    nome: string
    canManage: boolean
    politica: PoliticaDoCanal | null
    atendentes: { id: string; name: string }[]
    onChange: (p: PoliticaDoCanal | null) => void
}) {
    return <CorpoDaAtribuicao {...props} className="h-8 w-[9.5rem] text-xs" />
}

/** O mesmo seletor fora da tabela, para os canais de linha única. */
function SeletorSolto({
    rotulo,
    nome,
    canManage,
    escolha,
}: {
    rotulo: string
    nome: string
    canManage: boolean
    escolha: Escolha
}) {
    if (escolha.opcoes.length === 0) return null

    return (
        <Select
            value={escolha.valor ?? 'none'}
            disabled={!canManage}
            onValueChange={(v) => escolha.onChange(v === 'none' ? null : v)}
        >
            <SelectTrigger
                aria-label={`${rotulo} de ${nome}`}
                className="h-8 w-[9.5rem] text-xs"
            >
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                <SelectItem value="none">{escolha.vazio}</SelectItem>
                {escolha.opcoes.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                        {o.name}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    )
}


export function CanaisTab({ agentId, canManage = true }: CanaisTabProps) {
    const v = useVocab()

    const [lines, setLines] = useState<Line[]>([])
    const [departments, setDepartments] = useState<{ id: string; name: string }[]>([])
    const [origins, setOrigins] = useState<{ id: string; name: string }[]>([])
    const [medias, setMedias] = useState<{ id: string; name: string }[]>([])
    /**
     * Quem pode ser atendente fixo de uma linha: membro ativo da clínica.
     *
     * Vem junto das linhas, na mesma resposta, pela razão que já valia para
     * departamentos e origens — uma segunda chamada pode discordar desta.
     */
    const [atendentes, setAtendentes] = useState<{ id: string; name: string }[]>([])
    /**
     * Todas as linhas do agente, de qualquer canal, para a atribuição.
     *
     * A lista de cima é só do WhatsApp QR — é a rota dela. Origem, mídia e
     * **atribuição**, porém, valem para Instagram, canal oficial e widget do
     * site: as colunas sempre foram do `AgentIntegration`, e só a tela limitava.
     *
     * A atribuição chegou aqui em 26/11/2026, depois de nascer na rota do QR e
     * o André cobrar o alcance no mesmo dia: "atribuição deve ser por canal.
     * Para todos."
     */
    const [linhasDeAtribuicao, setLinhasDeAtribuicao] = useState<
        {
            id: string
            channel: string
            label: string | null
            phoneNumber: string | null
            /** Para a chave dos canais de linha única saber onde está. */
            status: string
            errorMessage: string | null
            defaultOriginId: string | null
            defaultMediaId: string | null
            /** Quem recebe as conversas deste canal; `null` segue a regra da conta. */
            distribuicao: PoliticaDoCanal | null
        }[]
    >([])
    const [limit, setLimit] = useState<LineLimit | null>(null)
    const [loading, setLoading] = useState(Boolean(agentId))
    const [ocupada, setOcupada] = useState<string | null>(null)
    const [pareando, setPareando] = useState<string | null>(null)
    const [renomeando, setRenomeando] = useState<string | null>(null)
    const [rascunho, setRascunho] = useState('')
    const [aRemover, setARemover] = useState<Line | null>(null)
    const [aDesconectar, setADesconectar] = useState<Line | null>(null)

    /** O canal do site: chave pública e o trecho que a clínica cola. */
    const [site, setSite] = useState<{
        connected: boolean
        snippet?: string
        config?: ConfiguracaoDoWidget
    } | null>(null)
    /** A seção de aparência fica fechada: só quem vai mexer nela a abre. */
    const [configurandoSite, setConfigurandoSite] = useState(false)
    const [ligandoSite, setLigandoSite] = useState(false)
    const [copiado, setCopiado] = useState(false)

    const carregar = useCallback(async () => {
        if (!agentId) return
        try {
            const res = await fetch(`/api/agents/${agentId}/integrations/whatsapp`)
            if (!res.ok) return
            const data = await res.json()
            setLines(data.lines ?? [])
            setLimit(data.limit ?? null)
            setDepartments(data.departments ?? [])
            setOrigins(data.origins ?? [])
        } finally {
            setLoading(false)
        }
    }, [agentId])

    const carregarAtribuicao = useCallback(async () => {
        if (!agentId) return
        try {
            const [linhas, listaDeMidias] = await Promise.all([
                fetch(`/api/agents/${agentId}/integrations/marketing`).then((r) =>
                    r.ok ? r.json() : null
                ),
                fetch('/api/medias').then((r) => (r.ok ? r.json() : [])),
            ])
            setLinhasDeAtribuicao(linhas?.linhas ?? [])
            setAtendentes(linhas?.atendentes ?? [])
            setMedias(Array.isArray(listaDeMidias) ? listaDeMidias : [])
        } catch {
            // Sem a lista, a seção de atribuição não aparece. O resto da aba
            // continua inteiro: conectar número é o que importa aqui.
        }
    }, [agentId])

    /** Grava o par da linha e recarrega, para o seletor refletir o gravado. */
    const atribuir = useCallback(
        async (
            integrationId: string,
            patch: {
                defaultOriginId?: string | null
                defaultMediaId?: string | null
                distribuicao?: PoliticaDoCanal | null
            }
        ) => {
            const res = await fetch(`/api/agents/${agentId}/integrations/marketing`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ integrationId, ...patch }),
            })
            if (!res.ok) {
                const corpo = await res.json().catch(() => ({}))
                toast.error(corpo.error ?? 'Não foi possível salvar')
                return
            }
            await carregarAtribuicao()
        },
        [agentId, carregarAtribuicao]
    )

    useEffect(() => {
        void carregar()
        void carregarAtribuicao()
    }, [carregar, carregarAtribuicao])

    const carregarSite = useCallback(async () => {
        if (!agentId) return
        const res = await fetch(`/api/agents/${agentId}/integrations/site`)
        if (res.ok) setSite(await res.json())
    }, [agentId])

    useEffect(() => {
        void carregarSite()
    }, [carregarSite])

    const alternarSite = async (ligar: boolean) => {
        setLigandoSite(true)
        try {
            const res = await fetch(`/api/agents/${agentId}/integrations/site`, {
                method: ligar ? 'POST' : 'DELETE',
            })
            if (!res.ok) {
                const corpo = await res.json().catch(() => ({}))
                toast.error(corpo.error ?? 'Não foi possível alterar o canal do site')
                return
            }
            toast.success(ligar ? 'Widget do site ligado' : 'Widget do site desligado')
            await carregarSite()
        } finally {
            setLigandoSite(false)
        }
    }

    /**
     * Adicionar uma linha é abrir o pareamento, não gravar um registro.
     *
     * O registro nasce no servidor junto com a instância no provedor, porque o
     * nome dela é o id dele. Aqui só se abre o modal, que o POST atende.
     */
    /**
     * Liga e desliga um canal de linha única, pela rota dele.
     *
     * Uma função só para os dois canais da Meta porque a chave é uma só na
     * tela: se cada canal tivesse o seu jeito de ligar, voltaríamos ao que o
     * Andre chamou de sem padrão. O que muda entre eles é o endereço.
     *
     * **Não serve para conectar pela primeira vez.** Desligado sem linha
     * nenhuma não é um booleano: é um OAuth inteiro, e quem o abre é o
     * componente do canal. Ver o uso de `trigger` e `renderAcao`.
     */
    const alternarCanal = async (rota: 'meta' | 'instagram', ativo: boolean, nome: string) => {
        setOcupada(rota)
        try {
            const res = await fetch(`/api/agents/${agentId}/integrations/${rota}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ativo }),
            })
            const corpo = await res.json().catch(() => ({}))
            if (res.ok) {
                toast.success(`${nome} ${ativo ? 'está no ar' : 'saiu do ar'}`)
            } else {
                toast.error(corpo.error ?? 'Não foi possível alterar o canal')
            }
        } finally {
            /**
             * **Recarregar também quando falha** — e este `finally` é o
             * conserto de um defeito meu, de 2026-10-20.
             *
             * A versão anterior saía antes da recarga no caminho do erro. Como
             * é justamente o erro que marca a linha ("a conexão expirou"), o
             * navegador nunca ficava sabendo da marca — e é a marca que faz a
             * chave abrir o fluxo da Meta em vez de tentar o PATCH de novo. O
             * resultado era um botão que repetia o mesmo erro para sempre, com
             * o caminho de recuperação ali do lado e inalcançável.
             */
            setOcupada(null)
            await carregarAtribuicao()
            await carregar()
        }
    }

    const adicionar = () => setPareando('nova')

    const reconectar = (line: Line) => setPareando(line.id)

    const desconectar = async (line: Line) => {
        setOcupada(line.id)
        try {
            const res = await fetch(
                `/api/agents/${agentId}/integrations/whatsapp?integrationId=${line.id}`,
                { method: 'DELETE' }
            )
            const body = await res.json().catch(() => ({}))
            if (!res.ok) {
                toast.error(body.error ?? 'Não foi possível desconectar')
                return
            }
            toast.success(`${nomeDaLinha(line)} foi desconectada`)
            await carregar()
        } finally {
            setOcupada(null)
        }
    }

    /**
     * Reatar a linha **sem desligá-la**.
     *
     * ## Para que serve, em ordem de frequência
     *
     * **1. A linha que diz "No ar" e está muda.** É o buraco que não tinha
     * ação: `integration-health` só age quando o provedor reporta
     * `!connected`, então soquete morto com estado mentindo "conectado" passa
     * pela cura automática sem ser tocado — o incidente de 2026-10-15
     * invertido. Até hoje a única saída era desliga/liga, que arrisca o laço de
     * QR do Evolution Go. Este botão é o lever que faltava.
     *
     * **2. Trocar o endereço do webhook.** Ele mora no banco do Evolution, por
     * instância, e só é gravado num `/instance/connect` — então mudar
     * `WEBHOOK_BASE_URL` não tem efeito até cada linha passar por isso. Foi o
     * que custou um desliga/liga à mão em 2026-10-24. Motivo real, mas raro:
     * sozinho não pagaria um controle permanente nesta tela.
     *
     * Fica fora da chave de propósito. A chave diz **estado** ("No ar" / "Fora
     * do ar") e essa linguagem foi padronizada em 2026-10-20 justamente para
     * acabar com as seis formas de dizer duas coisas; reatar não muda estado,
     * é manutenção. Por isso é ícone ao lado, só na linha que está no ar.
     */
    const reatar = async (line: Line) => {
        setOcupada(line.id)
        try {
            const res = await fetch(`/api/agents/${agentId}/integrations/whatsapp/reatar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ integrationId: line.id }),
            })
            const body = await res.json().catch(() => ({}))
            if (!res.ok) {
                toast.error(body.error ?? 'Não foi possível reatar a linha')
                return
            }
            if (body.seguiuConectada) {
                toast.success(`${nomeDaLinha(line)} foi reatada e segue no ar`)
            } else {
                // Não é sucesso silencioso: a sessão caiu e quem está na tela
                // precisa saber que o próximo passo é conectar pela chave.
                toast.error(
                    `${nomeDaLinha(line)} saiu do ar ao reatar. Conecte-a de novo pela chave.`
                )
            }
            await carregar()
        } finally {
            setOcupada(null)
        }
    }

    const remover = async (line: Line) => {
        setOcupada(line.id)
        try {
            const res = await fetch(
                `/api/agents/${agentId}/integrations/whatsapp?integrationId=${line.id}&remove=true`,
                { method: 'DELETE' }
            )
            const body = await res.json().catch(() => ({}))
            if (!res.ok) {
                toast.error(body.error ?? 'Não foi possível remover a linha')
                return
            }
            toast.success('Linha removida')
            await carregar()
        } finally {
            setOcupada(null)
        }
    }

    const ajustar = async (
        line: Line,
        patch: { label?: string; departmentId?: string | null; defaultOriginId?: string | null }
    ) => {
        const res = await fetch(`/api/agents/${agentId}/integrations/whatsapp`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ integrationId: line.id, ...patch }),
        })
        if (!res.ok) {
            const body = await res.json().catch(() => ({}))
            toast.error(body.error ?? 'Não foi possível salvar')
            return
        }
        await carregar()
    }

    const renomear = async (line: Line) => {
        const label = rascunho.trim()
        setRenomeando(null)
        if (label === (line.label ?? '')) return
        await ajustar(line, { label })
    }

    const semVaga = limit !== null && limit.remaining <= 0

    /**
     * O par origem/mídia de uma linha, qualquer que seja o canal dela.
     *
     * Vem de outra rota que a lista de linhas do WhatsApp — `marketing` serve
     * todos os canais, `whatsapp` serve só o QR —, então o casamento é por id.
     * Linha recém-criada pode ainda não estar na segunda lista; `undefined` é
     * resposta legítima, e a grade apenas nasce vazia.
     */
    const atribuicaoDe = (id: string) => linhasDeAtribuicao.find((l) => l.id === id)

    /** A linha deste canal, quando existe — para pendurar a grade nela. */
    const linhaDoCanal = (channel: string) => linhasDeAtribuicao.find((l) => l.channel === channel)

    /**
     * Atribuição, origem e mídia de um canal de número único, soltos na própria
     * linha dele.
     *
     * Eles ficam **antes** da chave, nunca depois: a chave encerra a linha em
     * todos os canais, e enfiar um seletor depois dela quebraria a vertical em
     * que as oito chaves da tela se alinham.
     *
     * A atribuição vem **primeiro** entre os três: ela decide quem trabalha, e
     * os outros dois decidem o que a ficha do paciente vai registrar.
     */
    const atribuicaoDoCanal = (channel: string, nome: string) => {
        const linha = linhasDeAtribuicao.find((l) => l.channel === channel)
        if (!linha) return null

        return (
            <>
                <AtribuicaoSolta
                    nome={nome}
                    canManage={canManage}
                    politica={linha.distribuicao}
                    atendentes={atendentes}
                    onChange={(p) => void atribuir(linha.id, { distribuicao: p })}
                />
                <SeletorSolto
                    rotulo="Origem"
                    nome={nome}
                    canManage={canManage}
                    escolha={{
                        valor: linha.defaultOriginId,
                        opcoes: origins,
                        vazio: 'Sem origem',
                        onChange: (v: string | null) =>
                            void atribuir(linha.id, { defaultOriginId: v }),
                    }}
                />
                <SeletorSolto
                    rotulo="Mídia"
                    nome={nome}
                    canManage={canManage}
                    escolha={{
                        valor: linha.defaultMediaId,
                        opcoes: medias,
                        vazio: 'Sem mídia',
                        onChange: (v: string | null) =>
                            void atribuir(linha.id, { defaultMediaId: v }),
                    }}
                />
            </>
        )
    }

    if (!agentId) {
        return (
            <SettingsCard
                title="Canais de atendimento"
                description="Salve o agente antes de conectar um canal — a linha precisa pertencer a alguém."
            >
                <p className="text-xs text-muted-foreground">
                    Depois de salvar, volte aqui para ler o QR Code do WhatsApp.
                </p>
            </SettingsCard>
        )
    }

    return (
        <div className="flex flex-col gap-4">
            <SettingsCard
                title="Linhas de WhatsApp"
                /* O texto é o do Andre, de 2026-11-09. Saiu "a conversa
                   responde pela linha por onde entrou" — comportamento do
                   sistema que a coluna Linha já mostra — e a explicação da
                   fila virou a frase curta dele. */
                description="Cada linha é um número. A fila indica quem vê as conversas; a atribuição, quem as recebe — a da conta, ou só desta linha."
                /*
                 * A ação primária sobe para o cabeçalho, ao lado do medidor.
                 *
                 * Era um rodapé inteiro só para ela, com uma frase à esquerda e
                 * o botão encostado na ponta — e de tão separado do resto ele
                 * parecia solto na tela (o Andre, 2026-10-20). No cabeçalho ele
                 * fica junto da informação com que conversa: quantas vagas
                 * sobram no plano.
                 */
                aside={
                    <div className="flex items-center gap-3">
                        {limit ? (
                            <span className="num whitespace-nowrap text-xs text-muted-foreground">
                                {limit.used} de {limit.max} no plano
                            </span>
                        ) : null}
                        {canManage ? (
                            <Button size="sm" className="h-8" onClick={adicionar} disabled={semVaga}>
                                <Plus className="size-4" />
                                Adicionar número
                            </Button>
                        ) : null}
                    </div>
                }
                /* `p-0` com um respiro só em cima: a tabela desenha as próprias
                   bordas e precisa encostar nas laterais do cartão, mas colada
                   no cabeçalho ela vira continuação dele. */
                contentClassName="p-0 pt-3"
            >
                {loading ? (
                    <div className="flex items-center gap-2 px-5 py-4 text-xs text-muted-foreground">
                        <Loader2 className="size-4 animate-spin" />
                        Carregando as linhas…
                    </div>
                ) : lines.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 px-5 py-6 text-center">
                        <QrCode className="size-8 text-muted-foreground/40" aria-hidden="true" />
                        <p className="text-[13px] font-semibold">Nenhum número conectado</p>
                        <p className="max-w-sm text-xs text-muted-foreground">
                            Enquanto não houver uma linha, o agente não recebe nem responde
                            mensagens no WhatsApp.
                        </p>
                    </div>
                ) : (
                    /*
                     * TABELA, E NÃO UMA LISTA DE FICHAS.
                     *
                     * Cada linha carregava três seletores empilhados sob o
                     * nome, com os rótulos repetidos linha a linha: com seis
                     * números isso são dezoito rótulos e seis blocos de dupla
                     * altura, e a guia só rolava. Em coluna o rótulo é dito uma
                     * vez, no cabeçalho.
                     *
                     * `overflow-x-auto` porque o índice de 208px come largura:
                     * em tela estreita a tabela rola dentro do cartão em vez de
                     * espremer os seletores até o texto sumir.
                     */
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[46rem] border-collapse text-left">
                            <thead>
                                <tr className="border-b border-border">
                                    {['Linha', 'Fila', 'Atribuição', 'Origem', 'Mídia'].map((c) => (
                                        <th
                                            key={c}
                                            className="px-2.5 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground first:pl-5"
                                        >
                                            {c}
                                        </th>
                                    ))}
                                    <th className="px-2.5 pb-1.5 pr-5 text-right text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                        Estado
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {lines.map((line) => {
                                    const trabalhando = ocupada === line.id
                                    const estado: 'ok' | 'fora' | 'indo' =
                                        line.status === 'connected'
                                            ? 'ok'
                                            : line.status === 'pending' || trabalhando
                                              ? 'indo'
                                              : 'fora'

                                    return (
                                        <tr
                                            key={line.id}
                                            className="border-b border-border last:border-b-0"
                                        >
                                            <td className="px-2.5 py-2 pl-5 align-middle">
                                                {canManage && renomeando === line.id ? (
                                                    <Input
                                                        autoFocus
                                                        value={rascunho}
                                                        maxLength={60}
                                                        placeholder="Unidade Centro"
                                                        className="h-8 max-w-[12rem]"
                                                        onChange={(e) => setRascunho(e.target.value)}
                                                        onBlur={() => void renomear(line)}
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter') void renomear(line)
                                                            if (e.key === 'Escape') setRenomeando(null)
                                                        }}
                                                    />
                                                ) : (
                                                    <>
                                                        <p className="whitespace-nowrap text-[13px] font-semibold">
                                                            {nomeDaLinha(line)}
                                                        </p>
                                                        {/* O erro do provedor vale mais que o
                                                            número: é ele que diz por que a
                                                            linha não está no ar. */}
                                                        <p
                                                            className={cn(
                                                                'num text-[11px]',
                                                                line.errorMessage
                                                                    ? 'text-destructive-subtle-foreground'
                                                                    : 'text-muted-foreground'
                                                            )}
                                                        >
                                                            {line.errorMessage ||
                                                                (line.phoneNumber
                                                                    ? formatPhone(line.phoneNumber)
                                                                    : line.paired
                                                                      ? 'Já pareada'
                                                                      : 'Ainda não pareada')}
                                                        </p>
                                                    </>
                                                )}
                                            </td>

                                            <SeletorDaLinha
                                                rotulo="Fila"
                                                nome={nomeDaLinha(line)}
                                                canManage={canManage}
                                                escolha={{
                                                    valor: line.departmentId,
                                                    opcoes: departments,
                                                    vazio: 'Fila geral',
                                                    onChange: (v) =>
                                                        void ajustar(line, { departmentId: v }),
                                                }}
                                            />
                                            <SeletorDeAtribuicao
                                                nome={nomeDaLinha(line)}
                                                canManage={canManage}
                                                politica={atribuicaoDe(line.id)?.distribuicao ?? null}
                                                atendentes={atendentes}
                                                onChange={(p) =>
                                                    void atribuir(line.id, { distribuicao: p })
                                                }
                                            />
                                            <SeletorDaLinha
                                                rotulo="Origem"
                                                nome={nomeDaLinha(line)}
                                                canManage={canManage}
                                                escolha={{
                                                    valor: atribuicaoDe(line.id)?.defaultOriginId ?? null,
                                                    opcoes: origins,
                                                    vazio: 'Sem origem',
                                                    onChange: (v) =>
                                                        void atribuir(line.id, { defaultOriginId: v }),
                                                }}
                                            />
                                            <SeletorDaLinha
                                                rotulo="Mídia"
                                                nome={nomeDaLinha(line)}
                                                canManage={canManage}
                                                escolha={{
                                                    valor: atribuicaoDe(line.id)?.defaultMediaId ?? null,
                                                    opcoes: medias,
                                                    vazio: 'Sem mídia',
                                                    onChange: (v) =>
                                                        void atribuir(line.id, { defaultMediaId: v }),
                                                }}
                                            />

                                            <td className="px-2.5 py-2 pr-5 align-middle">
                                                <div className="flex items-center justify-end gap-2.5">
                                                    {canManage ? (
                                                        <>
                                                            <span className="flex items-center gap-0.5">
                                                                <Button
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    className="size-7"
                                                                    aria-label={`Renomear ${nomeDaLinha(line)}`}
                                                                    onClick={() => {
                                                                        setRascunho(line.label ?? '')
                                                                        setRenomeando(line.id)
                                                                    }}
                                                                >
                                                                    <Pencil className="size-3.5" />
                                                                </Button>
                                                                {/* A lixeira só existe na linha
                                                                    fora do ar: com a chave ao
                                                                    lado, apagar por engano um
                                                                    número conectado fica barato
                                                                    demais. Desligue, depois
                                                                    remova. */}
                                                                {line.status !== 'connected' ? (
                                                                    <Button
                                                                        variant="ghost"
                                                                        size="icon"
                                                                        className="size-7"
                                                                        aria-label={`Remover ${nomeDaLinha(line)}`}
                                                                        disabled={trabalhando}
                                                                        onClick={() => setARemover(line)}
                                                                    >
                                                                        <Trash2 className="size-3.5 text-destructive-subtle-foreground" />
                                                                    </Button>
                                                                ) : (
                                                                    <Button
                                                                        variant="ghost"
                                                                        size="icon"
                                                                        className="size-7"
                                                                        aria-label={`Reconectar ${nomeDaLinha(line)}`}
                                                                        title="Reconectar — reata a linha sem desligá-la, para quando ela aparece no ar mas não recebe"
                                                                        disabled={!canManage || trabalhando}
                                                                        onClick={() => void reatar(line)}
                                                                    >
                                                                        {trabalhando ? (
                                                                            <Loader2 className="size-3.5 animate-spin" />
                                                                        ) : (
                                                                            <PlugZap className="size-3.5 text-muted-foreground" />
                                                                        )}
                                                                    </Button>
                                                                )}
                                                            </span>
                                                            <Fio />
                                                        </>
                                                    ) : null}
                                                    <Chave
                                                        estado={estado}
                                                        rotulo={trabalhando ? 'Desligando…' : 'Lendo QR…'}
                                                        nome={nomeDaLinha(line)}
                                                        disabled={!canManage}
                                                        onChange={(ligar) =>
                                                            ligar ? reconectar(line) : setADesconectar(line)
                                                        }
                                                    />
                                                </div>
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                )}

                {!canManage ? (
                    <p className="px-5 pb-4 text-xs text-muted-foreground">
                        Conectar e desconectar números é do dono ou do administrador {comArtigo(v, 'organizacao', 'de')}.
                    </p>
                ) : semVaga ? (
                    <p className="px-5 pb-4 text-xs text-muted-foreground">
                        O plano está no limite de números. Mude de plano em Gerenciamento → Conta
                        para conectar mais.
                    </p>
                ) : null}
            </SettingsCard>

            {/*
                UM CARTÃO PARA OS DEMAIS CANAIS, E UMA LINHA PARA CADA UM.

                Eram quatro cartões — site, WhatsApp oficial, Instagram e
                Messenger —, cada um para abrigar **uma linha só**: moldura a
                mais, conteúdo de menos, e quatro desenhos diferentes para a
                mesma pergunta ("está ligado? como ligo?"). O Andre chamou a
                tela de sem padrão em 2026-10-20, e a causa era essa.

                A anatomia agora é a mesma em todos, inclusive no WhatsApp
                acima: **nome e estado à esquerda, o que fazer à direita, o que
                a linha decide embaixo**. O botão do widget em particular
                estava sozinho no rodapé do cartão dele, que é o único lugar da
                tela onde a §5 do DESIGN.md não manda pôr ação de linha.
            */}
            <SettingsCard
                title="Outros canais"
                /* A legenda sobre vaga de plano e crédito por mensagem saiu a
                   pedido do Andre em 2026-11-05: era regra comercial no
                   cabeçalho de um cartão de ligar e desligar canal, e o lugar
                   dela é a tela de Assinatura. */
                contentClassName="p-0 pt-2"
            >
                <div className="flex flex-col divide-y divide-border">
                    {/* O SITE */}
                    <div className="px-5 py-2.5">
                        <SettingsRow
                            title={
                                <span className="flex items-center gap-2">
                                    <Globe className="size-4 text-muted-foreground" aria-hidden="true" />
                                    Site {comArtigo(v, 'organizacao', 'de')}
                                </span>
                            }
                            description={
                                site?.connected
                                    ? undefined
                                    : 'Uma bolha de conversa nas páginas do site.'
                            }
                            action={
                                <div className="flex flex-wrap items-center justify-end gap-2.5">
                                    {site?.connected
                                        ? atribuicaoDoCanal('site', `Site ${comArtigo(v, 'organizacao', 'de')}`)
                                        : null}
                                    {site?.connected ? <Fio /> : null}
                                    <Chave
                                        estado={
                                            ligandoSite ? 'indo' : site?.connected ? 'ok' : 'fora'
                                        }
                                        rotulo="Aguardando…"
                                        nome="o widget do site"
                                        disabled={!canManage}
                                        onChange={(ligar) => void alternarSite(ligar)}
                                    />
                                </div>
                            }
                        />

                        {/* O trecho só existe depois de ligado, e é a única coisa
                            desta tela que a clínica leva para fora daqui. */}
                        {site?.connected && site.snippet ? (
                            <div className="mt-2 flex items-start gap-2">
                                <code className="min-w-0 flex-1 overflow-x-auto rounded-md border border-border bg-muted/50 p-2 text-[10.5px] leading-relaxed">
                                    {site.snippet}
                                </code>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8"
                                    onClick={() => {
                                        void navigator.clipboard.writeText(site.snippet ?? '')
                                        setCopiado(true)
                                        setTimeout(() => setCopiado(false), 2000)
                                    }}
                                >
                                    {copiado ? 'Copiado' : 'Copiar'}
                                </Button>
                            </div>
                        ) : null}

                        {/*
                          * Aparência, domínios e captura.
                          *
                          * Fechado por omissão, e **sem depender de o canal
                          * estar ligado**: a ordem natural é escolher a cara e
                          * depois ligar, e quem seguisse essa ordem não teria
                          * onde configurar. O PATCH cria a linha desligada.
                          */}
                        <div className="mt-2">
                            <button
                                type="button"
                                onClick={() => setConfigurandoSite((a) => !a)}
                                aria-expanded={configurandoSite}
                                className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                            >
                                <ChevronRight
                                    className={cn(
                                        'size-3.5 transition-transform',
                                        configurandoSite && 'rotate-90'
                                    )}
                                    aria-hidden="true"
                                />
                                Aparência, domínios autorizados e captura de contato
                            </button>

                            {configurandoSite ? (
                                <WidgetDoSite
                                    agentId={agentId as string}
                                    canManage={canManage}
                                    inicial={site?.config ?? WIDGET_PADRAO}
                                    onSalvo={(config) =>
                                        setSite((atual) => (atual ? { ...atual, config } : atual))
                                    }
                                />
                            ) : null}
                        </div>
                    </div>

                    {/* O WHATSAPP OFICIAL, PELA META */}
                    <div className="px-5 py-2.5">
                        <SettingsRow
                            title={
                                <span className="flex items-center gap-2">
                                    <BadgeCheck className="size-4 text-muted-foreground" aria-hidden="true" />
                                    WhatsApp API Oficial
                                </span>
                            }
                            description={
                                /*
                                 * O erro vale mais que a descrição.
                                 *
                                 * "A conexão com a Meta expirou" é o que diz
                                 * por que a chave não acende, e repetir a
                                 * explicação do canal ali embaixo enterraria
                                 * justamente isso.
                                 */
                                linhaDoCanal('whatsapp_business')?.errorMessage ? (
                                    <span className="text-destructive-subtle-foreground">
                                        {linhaDoCanal('whatsapp_business')?.errorMessage}
                                    </span>
                                ) : (
                                    'Número verificado pela Meta, sem leitura de QR Code e sem depender de um celular ligado.'
                                )
                            }
                            action={
                                canManage ? (
                                    <div className="flex flex-wrap items-center justify-end gap-2.5">
                                        {linhaDoCanal('whatsapp_business')
                                            ? atribuicaoDoCanal(
                                                  'whatsapp_business',
                                                  'WhatsApp API Oficial'
                                              )
                                            : null}
                                        {linhaDoCanal('whatsapp_business') ? <Fio /> : null}
                                        {/*
                                         * A chave é a mesma dos outros canais; o que
                                         * muda é o que ela faz quando acende. Com
                                         * linha, é um PATCH. Sem linha, é o Embedded
                                         * Signup inteiro — e quem o abre é o
                                         * componente da Meta, por isso ele empresta
                                         * o gatilho em vez de desenhar botão.
                                         */}
                                        <MetaEmbeddedSignup
                                            agentId={agentId}
                                            onConectado={() => {
                                                void carregar()
                                                void carregarAtribuicao()
                                            }}
                                            trigger={({ abrir, ocupado, pronto }) => {
                                                const linha = linhaDoCanal('whatsapp_business')
                                                const noAr = linha?.status === 'connected'
                                                return (
                                                    <Chave
                                                        estado={
                                                            ocupado || ocupada === 'meta'
                                                                ? 'indo'
                                                                : noAr
                                                                  ? 'ok'
                                                                  : 'fora'
                                                        }
                                                        rotulo="Aguardando a Meta…"
                                                        nome="o WhatsApp API Oficial"
                                                        disabled={!pronto}
                                                        onChange={(ligar) => {
                                                            /*
                                                             * Sem linha, ou com
                                                             * a linha marcada
                                                             * com erro, ligar é
                                                             * o fluxo da Meta
                                                             * inteiro — não um
                                                             * PATCH. É o caso do
                                                             * token expirado:
                                                             * religar sem
                                                             * credencial nova
                                                             * falharia de novo,
                                                             * com a mesma frase.
                                                             */
                                                            if (!linha || (ligar && linha.errorMessage)) {
                                                                abrir()
                                                                return
                                                            }
                                                            void alternarCanal(
                                                                'meta',
                                                                ligar,
                                                                'O WhatsApp API Oficial'
                                                            )
                                                        }}
                                                    />
                                                )
                                            }}
                                        />
                                    </div>
                                ) : (
                                    <span className="text-[11px] text-muted-foreground">
                                        Só o administrador conecta
                                    </span>
                                )
                            }
                        />
                    </div>

                    {/* O INSTAGRAM VAI DIRETO À META: não há Evolution no
                        caminho, porque ele não tem canal de Instagram — e
                        também não teria o que fazer ali, já que a API de Direct
                        é aberta e gratuita. O componente desenha a linha e
                        guarda os preparos e a confirmação de desligar; a chave
                        é nossa, para ficar igual às outras. */}
                    <div className="px-5 py-2.5">
                        <InstagramConnect
                            agentId={agentId}
                            canManage={canManage}
                            renderAcao={({ conectado, carregando, configurado, conectar, desligar }) => (
                                <div className="flex flex-wrap items-center justify-end gap-2.5">
                                    {conectado
                                        ? atribuicaoDoCanal('instagram', 'Instagram Direct')
                                        : null}
                                    {conectado ? <Fio /> : null}
                                    <Chave
                                        estado={carregando ? 'indo' : conectado ? 'ok' : 'fora'}
                                        rotulo="Abrindo a Meta…"
                                        nome="o Instagram Direct"
                                        disabled={!canManage || configurado !== true}
                                        onChange={(ligar) => (ligar ? conectar() : desligar())}
                                    />
                                </div>
                            )}
                        />
                    </div>

                    {/* O QUE AINDA NÃO EXISTE: a chave fica, apagada. Chave que
                        não se move diz "existe, mas não agora" melhor que um
                        botão cinza — e mantém a vertical das outras sete. */}
                    {OUTROS_CANAIS(v).map((canal) => {
                        const Icone = canal.icon
                        return (
                            <div key={canal.id} className="px-5 py-2.5">
                                <SettingsRow
                                    title={
                                        <span className="flex items-center gap-2">
                                            <Icone className="size-4 text-muted-foreground" aria-hidden="true" />
                                            {canal.name}
                                        </span>
                                    }
                                    description={canal.description}
                                    action={
                                        <span className="flex min-w-[7rem] items-center justify-end gap-2">
                                            <span className="whitespace-nowrap text-[11px] text-muted-foreground">
                                                Em breve
                                            </span>
                                            <Switch
                                                checked={false}
                                                disabled
                                                aria-label={`${canal.name} ainda não está disponível`}
                                            />
                                        </span>
                                    }
                                />
                            </div>
                        )
                    })}
                </div>
            </SettingsCard>

            {/* A ressalva vale para toda a tela, e por isso é dita uma vez só
                aqui embaixo — repeti-la em cada linha era o que fazia o cartão
                de atribuição precisar de uma descrição própria. */}
            {origins.length > 0 || medias.length > 0 ? (
                <p className="px-1 text-xs text-muted-foreground">
                    Origem e mídia valem só para ficha nova — o que já entrou não é reescrito.
                </p>
            ) : null}

            {pareando ? (
                <WhatsAppQRModal
                    agentId={agentId}
                    integrationId={pareando === 'nova' ? null : pareando}
                    isOpen
                    onClose={() => {
                        setPareando(null)
                        void carregar()
                    }}
                    onConnected={() => void carregar()}
                />
            ) : null}

            <ConfirmDialog
                open={aDesconectar !== null}
                onOpenChange={(aberto) => {
                    if (!aberto) setADesconectar(null)
                }}
                title="Desconectar esta linha?"
                description={
                    aDesconectar
                        ? `${nomeDaLinha(aDesconectar)} para de receber e de enviar mensagens na hora. ` +
                          'As conversas e o histórico ficam, e reconectar não pede QR Code novo enquanto ' +
                          'a sessão do aparelho continuar válida. A linha segue ocupando a vaga do plano.'
                        : ''
                }
                confirmLabel="Desconectar"
                cancelLabel="Manter conectada"
                destructive
                onConfirm={() => (aDesconectar ? desconectar(aDesconectar) : Promise.resolve())}
            />

            <ConfirmDialog
                open={aRemover !== null}
                onOpenChange={(aberto) => {
                    if (!aberto) setARemover(null)
                }}
                title="Remover esta linha?"
                description={
                    aRemover
                        ? `${nomeDaLinha(aRemover)} sai da lista e devolve a vaga do plano. ` +
                          'As conversas que entraram por ela continuam guardadas, mas deixam de ' +
                          'registrar por qual número chegaram. Esta ação não tem volta.'
                        : ''
                }
                confirmLabel="Remover linha"
                cancelLabel="Manter na lista"
                destructive
                onConfirm={() => (aRemover ? remover(aRemover) : Promise.resolve())}
            />
        </div>
    )
}
