/**
 * Testes de paridade: OdontoBox360 × respond.io.
 *
 * A base de conhecimento em `docs/re-respond-io/` descreve 13 regras de
 * comportamento do respond.io (R-001..R-013), cada uma com um teste de
 * aceitação (T-001..T-013) em `docs/re-respond-io/clone/parity.md`. O BUILD.md
 * daquela pasta manda **escrever o teste antes de implementar**: a feature está
 * pronta quando o teste passa.
 *
 * Este arquivo é esse conjunto de testes, no idioma dos `scripts/check-*.ts`:
 * self-contained, sem banco e sem rede. Em vez de dirigir o app (o workerd não
 * roda nesta máquina — ver CLAUDE.md), cada teste **lê o código-fonte e o schema
 * Prisma** e afirma o invariante que a regra exige. É uma prova estática de
 * contrato, não um E2E — a UI que só existe em runtime fica anotada como tal.
 *
 * Três vereditos:
 *   - PASS    o OdontoBox360 já reproduz o comportamento. O assert vale como
 *             guarda de regressão: se o código mudar e quebrar, o teste falha.
 *   - PARTIAL reproduz em parte. A parte que existe é afirmada (guarda de
 *             regressão); o que falta sai listado.
 *   - GAP     não implementado. O teste afirma o ALVO (o que deveria existir) e
 *             espera que ainda não exista — um xfail. Quando a feature for
 *             construída, o teste vira PASS e o harness manda promover a linha.
 *
 * Código de saída: !=0 só quando um invariante PASS/PARTIAL **regride**. GAP que
 * continua GAP não falha o run (é o backlog); GAP que passou a valer é avisado,
 * não quebra o CI. Por isso NÃO entra no prebuild — é diagnóstico, roda à mão:
 *
 *     npm run check:paridade
 *
 * Fonte das regras: docs/re-respond-io/rules/*.md + clone/parity.md.
 * Nenhum texto, ícone ou nome do produto original é copiado — só o comportamento.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const RAIZ = process.cwd()

/** Lê um arquivo do repo; devolve '' se não existir (o teste decide o que isso significa). */
function ler(rel: string): string {
    const p = join(RAIZ, rel)
    return existsSync(p) ? readFileSync(p, 'utf8') : ''
}
function existe(rel: string): boolean {
    return existsSync(join(RAIZ, rel))
}
/** Verdadeiro se QUALQUER um dos padrões casa no arquivo. */
function contem(rel: string, ...padroes: (RegExp | string)[]): boolean {
    const txt = ler(rel)
    if (!txt) return false
    return padroes.some((p) => (typeof p === 'string' ? txt.includes(p) : p.test(txt)))
}

const schema = ler('prisma/schema.prisma')
/** Afirma presença de um trecho em qualquer lugar do schema Prisma. */
function noSchema(...padroes: (RegExp | string)[]): boolean {
    return padroes.some((p) => (typeof p === 'string' ? schema.includes(p) : p.test(schema)))
}
/** Extrai só o bloco `model Nome { ... }` (modelos Prisma são planos, sem chaves aninhadas). */
function blocoModelo(nome: string): string {
    const m = schema.match(new RegExp(`model ${nome} \\{[\\s\\S]*?\\n\\}`))
    return m ? m[0] : ''
}
/** Afirma presença de um trecho DENTRO de um model específico — não vaza para modelos vizinhos. */
function noModelo(nome: string, ...padroes: (RegExp | string)[]): boolean {
    const bloco = blocoModelo(nome)
    if (!bloco) return false
    return padroes.some((p) => (typeof p === 'string' ? bloco.includes(p) : p.test(bloco)))
}

type Veredito = 'pass' | 'partial' | 'gap'
interface Resultado {
    id: string
    regra: string
    feature: string
    resumo: string
    veredito: Veredito
    /** Invariantes que DEVEM valer (guarda de regressão em pass/partial). */
    invariantes: { nome: string; ok: boolean }[]
    /** Em gap: o alvo já apareceu? (true => promover a linha da tabela) */
    alvoPresente?: boolean
    faltam?: string[]
    nota?: string
}

const resultados: Resultado[] = []
function teste(r: Resultado) {
    resultados.push(r)
}

// ───────────────────────── ONBOARDING ─────────────────────────

// T-001 / R-001 — onboarding "N de 4" destacando o passo atual com CTA.
// OdontoBox360: wizard de 5 passos (workspace/plano/WhatsApp/agente/termos),
// com barra de progresso e CTA por passo — mas é outro conjunto, e o passo de
// lifecycle e o de convidar colegas não estão no fluxo. PARCIAL.
/**
 * Esta invariante acusou REGRESSÃO sem nada ter regredido, e a causa vale
 * registrar porque é a armadilha de toda prova estática.
 *
 * Ela afirmava `/currentStep/` em `onboarding/page.tsx`. O controle de passo
 * continua ali, inteiro — virou `const [passo, setPasso] = useState(1)` quando
 * o arquivo foi reescrito e os identificadores acompanharam o português que é
 * o padrão do projeto. A invariante media a **grafia de um identificador**, não
 * a propriedade que a regra exige, e um rename legítimo a derrubou.
 *
 * Agora são duas invariantes, porque são duas propriedades — e desde a
 * reescrita elas moram em arquivos diferentes: a página é dona do estado, a
 * moldura é dona do progresso.
 *
 * O padrão aceita as três grafias plausíveis de propósito. Casar o par
 * destructuring + `useState` junto é o que o torna específico: `/passo/` solto
 * passaria em qualquer comentário do arquivo (há dezenas), e aí a guarda de
 * regressão não guardaria nada.
 */
const GRAFIAS_DO_PASSO =
    /\[\s*(passo|currentStep|etapa)\s*,\s*set(Passo|CurrentStep|Etapa)\s*\]\s*=\s*useState/

teste({
    id: 'T-001',
    regra: 'R-001',
    feature: 'F-001',
    resumo: 'Onboarding guiado com progresso e CTA no passo atual',
    veredito: 'partial',
    invariantes: [
        { nome: 'existe wizard de onboarding', ok: existe('src/app/(auth)/onboarding/page.tsx') },
        {
            nome: 'a página controla o passo atual por estado',
            ok: contem('src/app/(auth)/onboarding/page.tsx', GRAFIAS_DO_PASSO),
        },
        {
            // O progresso saiu da página para a moldura na reescrita, e passou a
            // ser TEXTO ("Passo N de T") além do trilho visual — era o primeiro
            // item de `faltam` desta regra, e deixou de faltar.
            nome: 'a moldura mostra o progresso em texto, com rótulo acessível',
            ok:
                contem('src/components/onboarding/OnboardingShell.tsx', /passo:\s*number/) &&
                contem('src/components/onboarding/OnboardingShell.tsx', /total:\s*number/) &&
                contem(
                    'src/components/onboarding/OnboardingShell.tsx',
                    /aria-label=\{`Passo \$\{passo\} de \$\{total\}`\}/
                ),
        },
        { nome: 'provisiona workspace no backend', ok: existe('src/app/api/onboarding/route.ts') },
    ],
    faltam: [
        'o fluxo tem 5 passos (workspace/plano/WhatsApp/agente/termos), não os 4 do original',
        'não há passo de lifecycle/pipeline nem de convidar colegas no fluxo (existem fora do wizard)',
    ],
    nota: 'Conjunto de passos é de provisionamento, não o quarteto do respond.io. Divergência intencional de produto, não defeito.',
})

// T-002 / R-002 — "conectar canal" abre catálogo por categoria.
// OdontoBox360: canais conectam POR AGENTE (QR do WhatsApp, OAuth do Instagram,
// embedded signup da Meta); não há catálogo por categoria. GAP.
teste({
    id: 'T-002',
    regra: 'R-002',
    feature: 'F-002',
    resumo: 'Catálogo de canais por categoria',
    veredito: 'gap',
    invariantes: [],
    alvoPresente:
        existe('src/app/(dashboard)/gerenciamento/integracoes/canais') ||
        contem('src/components/management/IntegrationsPanel.tsx', /categoria|catálogo|whatsapp/i),
    nota: 'Conexão é por agente (WhatsAppQRModal / InstagramConnect / MetaEmbeddedSignup). Um catálogo por categoria é opcional — o modelo por-agente é uma escolha válida de IA.',
})

// ───────────────────────── INBOX / CONVERSAS ─────────────────────────

// T-006 / R-006 — lista filtra por atribuição via endpoint.
// OdontoBox360: GET /api/conversations com abas waiting/active/closed + Todas/Minhas.
// Falta "colaborações" (só há assignedTo único). PARCIAL.
teste({
    id: 'T-006',
    regra: 'R-006',
    feature: 'F-014',
    resumo: 'Lista do inbox filtra por atribuição e carrega por endpoint',
    veredito: 'partial',
    invariantes: [
        { nome: 'endpoint de listagem existe', ok: existe('src/app/api/conversations/route.ts') },
        {
            nome: 'filtra por aba de atribuição (waiting/active/closed)',
            ok: contem('src/app/api/conversations/route.ts', /waiting|active|closed/),
        },
        {
            nome: 'recorta por "minhas" (onlyMine / assignedTo do usuário)',
            ok: contem('src/app/api/conversations/route.ts', /onlyMine|assignedTo/),
        },
    ],
    faltam: ['não há "colaborações" (múltiplos atendentes): schema tem apenas assignedTo único'],
})

// T-007 / R-007 — estados open/pending/close + snooze + auto-close.
// OdontoBox360: active|closed (sem pending funcional; "snoozed" é valor órfão no
// comentário do schema). Auto-close existe (cron). PARCIAL.
const snoozeFuncional = contem('src/app/api/conversations/route.ts', /snooz/i) ||
    existe('src/app/api/conversations/[id]/snooze/route.ts')
const pendingFuncional = /status[^\n]*pending/i.test(ler('src/app/api/conversations/route.ts'))
teste({
    id: 'T-007',
    regra: 'R-007',
    feature: 'F-011',
    resumo: 'Conversa tem estados, com snooze e fechamento automático',
    veredito: 'partial',
    invariantes: [
        {
            nome: 'status persistido na conversa',
            ok: noModelo('Conversation', /status\s+String\s+@default\("active"\)/),
        },
        {
            nome: 'fechamento automático agendado (auto-close) existe',
            ok: existe('src/trabalhos/processadores/cron/conversation-autoclose.ts'),
        },
        { nome: 'closedAt registrado', ok: noModelo('Conversation', /closedAt\s+DateTime\?/) },
    ],
    faltam: [
        !pendingFuncional ? 'estado "pending" não é funcional (só active/closed em uso)' : '',
        !snoozeFuncional ? 'snooze não é funcional ("snoozed" é valor órfão no comentário do schema)' : '',
    ].filter(Boolean),
    nota: 'A própria KB marca "pending" como GAP Q-010 no SDK público, confirmado só no API interno (EV-007). Semântica de quando aplicar "pending" fica em aberto.',
})

// T-008 / R-008 — abrir conversa marca como lida (sem botão) + contagem de não lidas.
// OdontoBox360: POST read grava lastReadAt; listagem calcula unreadCount. PASS.
teste({
    id: 'T-008',
    regra: 'R-008',
    feature: 'F-010',
    resumo: 'Abrir a conversa a marca como lida e zera não lidas',
    veredito: 'pass',
    invariantes: [
        {
            nome: 'endpoint de marcar-lida grava lastReadAt',
            ok: contem('src/app/api/conversations/[id]/read/route.ts', /lastReadAt/),
        },
        { nome: 'coluna lastReadAt no schema', ok: noModelo('Conversation', /lastReadAt\s+DateTime\?/) },
        {
            nome: 'listagem calcula contagem de não lidas',
            ok: contem('src/app/api/conversations/route.ts', /unreadCount/),
        },
    ],
})

// ───────────────────────── LIFECYCLE / FUNIL (Negócios) ─────────────────────────

// T-003 / R-003 — dois grupos (funil + perda), estágio padrão, "venda fechada", razões.
// OdontoBox360: pipeline é lista única; ganho/perda são status do Deal + razões
// (DealOutcomeReason kind won|lost). Faltam os GRUPOS e o estágio de ganho. PARCIAL.
teste({
    id: 'T-003',
    regra: 'R-003',
    feature: 'F-003',
    resumo: 'Lifecycle com grupo funil + grupo perda, estágio padrão e venda fechada',
    veredito: 'partial',
    invariantes: [
        { nome: 'estágios de pipeline existem', ok: blocoModelo('PipelineStage') !== '' },
        {
            nome: 'razões de ganho/perda configuráveis (kind won|lost)',
            ok: noModelo('DealOutcomeReason', /kind\s+String/),
        },
        { nome: 'negócio tem status won/lost', ok: noModelo('Deal', /status/) },
    ],
    faltam: [
        'não há dois GRUPOS de estágios (funil vs perda): PipelineStage é lista única ordenada',
        'não há estágio "venda fechada"/padrão com flag (ganho é Deal.status=won, não estágio)',
    ],
})

// T-004 / R-004 — cada estágio do funil cria uma caixa de entrada padrão; perda não.
// OdontoBox360: pipeline e inbox são domínios desacoplados. GAP.
teste({
    id: 'T-004',
    regra: 'R-004',
    feature: 'F-003',
    resumo: 'Estágio do funil gera uma caixa de entrada padrão',
    veredito: 'gap',
    invariantes: [],
    alvoPresente: noModelo('PipelineStage', /Conversation|inbox|caixaDeEntrada/i),
    nota: 'PipelineStage não tem relação com Conversation. Acoplamento inbox-por-estágio é uma decisão de produto ainda não tomada no OdontoBox360.',
})

// T-005 / R-005 — ocultar estágios sem apagar dados (toggle show/hide).
// OdontoBox360: estágio só se apaga (DELETE com moveTo). Sem soft-hide. GAP.
// Contraste: DealOutcomeReason TEM soft-hide (isActive) — padrão a replicar.
teste({
    id: 'T-005',
    regra: 'R-005',
    feature: 'F-003',
    resumo: 'Ocultar estágio preserva os dados do contato',
    veredito: 'gap',
    invariantes: [],
    alvoPresente: noModelo('PipelineStage', /isVisible|hidden|archived|isActive/),
    nota: 'Hoje só DELETE (com ?moveTo=). O padrão soft-hide já existe em DealOutcomeReason.isActive; replicar em PipelineStage resolve.',
})

// ───────────────────────── AI AGENT ─────────────────────────

// T-009 / R-009 — AI Agent nasce rascunho inativo; publicar ativa; templates; cancelar descarta.
// OdontoBox360: agente nasce ATIVO (isActive default true); só há liga/desliga,
// sem ciclo rascunho→publicar nem galeria de templates. GAP (quanto ao ciclo).
teste({
    id: 'T-009',
    regra: 'R-009',
    feature: 'F-030',
    resumo: 'AI Agent nasce rascunho inativo e só atende após Publicar',
    veredito: 'gap',
    invariantes: [],
    alvoPresente: noModelo('Agent', /\bstatus\s+String|published|draft|isDraft/),
    faltam: [
        'agente nasce ativo (isActive default true), não rascunho',
        'não há estado de publicação (status/published/draft) — só liga/desliga (isActive)',
        'não há galeria de templates de criação (o mais próximo é duplicar um agente)',
    ],
    nota: 'Existe salvaguarda de alterações não salvas (unsaved.ts), mas não um rascunho persistido. Nascer ativo é arriscado: publicar/ativar deveria ser um ato explícito.',
})

// T-010 / R-010 — AI Skills executam ações; modo Teste usa contato mock e não afeta nada.
// OdontoBox360: tools de function-calling (agenda/mover negócio/marcar consulta)
// + motor de regras (send_message/notify_human/add_tag/move_pipeline/schedule_followup).
// Falta skill de atualizar campo genérico e "encerrar"; e NÃO há simulador. PARCIAL.
teste({
    id: 'T-010',
    regra: 'R-010',
    feature: 'F-032/F-035',
    resumo: 'Agente executa ações numa conversa; modo Teste é seguro (mock)',
    veredito: 'partial',
    invariantes: [
        { nome: 'tools de function-calling do agente existem', ok: existe('src/trabalhos/servicos/agent-tools.ts') },
        {
            nome: 'motor de regras com ações (atribuir/etiquetar/mover funil)',
            ok: contem('src/types/rules.ts', /notify_human/, /add_tag/, /move_pipeline/),
        },
        { nome: 'executor das regras existe', ok: existe('src/lib/rules/executor.ts') },
    ],
    faltam: [
        'sem skill "atualizar campo de contato" genérica (há add_tag e move_pipeline)',
        'sem ação explícita "encerrar conversa" (notify_human transfere; fechamento é por autoCloseDays)',
        'sem modo Teste/simulação com contato mock (só há preview de voz)',
    ],
})

// ───────────────────────── BROADCAST ─────────────────────────

// T-011 / R-011 — Broadcast com ciclo de status e visões Tabela/Calendário.
// OdontoBox360: só placeholder de nav "Em breve"; sem model, sem rota. GAP total.
// T-011 / R-011 — Broadcast implementado (B2). Modelo + fila + rotas + telas.
// Falta só a vista Calendário (a de Tabela existe). Disparo gated por BR-001
// (template Meta aprovado) — por desenho, não por falta de código.
teste({
    id: 'T-011',
    regra: 'R-011',
    feature: 'F-050/F-053',
    resumo: 'Broadcast: ciclo de status + criação por template e listas',
    veredito: 'partial',
    invariantes: [
        { nome: 'model Broadcast + destinatários', ok: noModelo('Broadcast', /status/) && blocoModelo('BroadcastRecipient') !== '' },
        { nome: 'fila própria de broadcast', ok: contem('src/lib/queue/definitions.ts', /BROADCAST:\s*'broadcast'/) },
        { nome: 'rotas de campanha + disparo', ok: existe('src/app/api/marketing/campaigns/route.ts') && existe('src/app/api/marketing/campaigns/[id]/send/route.ts') },
        { nome: 'tela de campanhas no Marketing', ok: existe('src/app/(dashboard)/marketing/campanhas/page.tsx') },
        { nome: 'só linha whatsapp_business dispara', ok: contem('src/lib/marketing/lines.ts', /whatsapp_business/) },
        { nome: 'campanha exige template aprovado', ok: contem('src/app/api/marketing/campaigns/route.ts', /APPROVED/) },
        { nome: 'envio por template (HSM) no provedor Meta', ok: contem('src/lib/whatsapp/meta-whatsapp.ts', /sendTemplate/) },
    ],
    faltam: ['vista Calendário (a de Tabela + filtro de status existe)'],
    nota: 'Disparo frio depende de template Meta aprovado (BR-001) — regra de política, não de código.',
})

// ───────────────────────── WORKFLOWS ─────────────────────────

// T-012 / R-012 — galeria de templates por categoria + do zero.
//
// O `alvoPresente` destas duas regras procurava `workflows` e `model Workflow`
// — a grafia INGLESA. O que foi construído chama-se funil: `/marketing/funis`,
// `api/marketing/funis/` e `model Funnel|FunnelStep|FunnelRun`. Então a detecção
// nunca acendeu, e o verificador relatou GAP para duas features que estão em
// produção nos três apps.
//
// É a mesma causa da regressão da T-001 (medir grafia, não propriedade), com um
// agravante: aqui era SILENCIOSO. GAP que continua GAP não falha o run, então
// ninguém foi avisado — e esta tabela é a que alimenta o PLANO.md.
//
// Corrigida a detecção, o aviso "GAP→PRESENTE / promover esta linha" passa a
// aparecer, que é o comportamento que o cabeçalho deste arquivo já descrevia.
// O `veredito` fica em `gap` de propósito: promover a linha da tabela é decisão
// de produto, não do script.
teste({
    id: 'T-012',
    regra: 'R-012',
    feature: 'F-063',
    resumo: 'Workflows a partir do zero ou de galeria de templates por categoria',
    veredito: 'gap',
    invariantes: [],
    alvoPresente:
        existe('src/app/(dashboard)/marketing/funis') || existe('src/app/api/marketing/funis'),
    nota: 'Construído como Funis: canvas em React Flow, galeria de partida e publicação explícita. Linha a promover.',
})

// T-013 / R-013 — workflow = 1 gatilho + até 100 steps encadeados; Draft→Publicar.
// Mesma correção de grafia da T-012: o modelo chama-se Funnel, não Workflow.
teste({
    id: 'T-013',
    regra: 'R-013',
    feature: 'F-060/F-062',
    resumo: 'Workflow: 1 gatilho + até 100 steps encadeados; publicar ativa',
    veredito: 'gap',
    invariantes: [],
    alvoPresente: noSchema(/model (Funnel|FunnelStep|FunnelRun) /),
    nota: 'Construído como Funis: Funnel/FunnelStep/FunnelRun, motor em Cloudflare Workflows (step.sleep até 365 dias) e ciclo rascunho→publicar. Linha a promover.',
})

// ───────────────────────── Execução e relatório ─────────────────────────

let regressoes = 0
let promover = 0
const ICON: Record<string, string> = { PASS: '🟢', PARTIAL: '🟡', GAP: '🔴' }

for (const r of resultados) {
    const quebrados = r.invariantes.filter((i) => !i.ok)
    let rotulo: string
    if (r.veredito === 'gap') {
        rotulo = r.alvoPresente ? 'GAP→PRESENTE' : 'GAP'
        if (r.alvoPresente) promover++
    } else {
        // pass/partial: invariantes DEVEM valer. Qualquer quebra é regressão.
        if (quebrados.length > 0) {
            rotulo = 'REGRESSÃO'
            regressoes++
        } else {
            rotulo = r.veredito.toUpperCase()
        }
    }
    const icon = ICON[r.veredito.toUpperCase()] ?? '⚪'
    console.log(`${icon} ${r.id} ${r.regra} [${rotulo}] ${r.resumo}`)
    for (const i of r.invariantes) console.log(`      ${i.ok ? '✓' : '✗'} ${i.nome}`)
    for (const f of r.faltam ?? []) console.log(`      – falta: ${f}`)
    if (r.veredito === 'gap' && r.alvoPresente) {
        console.log('      ↑ o alvo apareceu no código — promover esta linha na tabela de paridade')
    }
}

const n = resultados.length
const c = (v: Veredito) => resultados.filter((r) => r.veredito === v).length
console.log('')
console.log(`Paridade: ${c('pass')} PASS · ${c('partial')} PARCIAL · ${c('gap')} GAP  (de ${n} regras)`)
console.log('Tabela e plano: docs/paridade-respond-io/PLANO.md')

if (regressoes > 0) {
    console.log(`\nFALHOU: ${regressoes} invariante(s) de paridade regrediram.`)
    process.exit(1)
}
if (promover > 0) {
    console.log(`\nAVISO: ${promover} GAP(s) agora presente(s) — atualize a tabela (não quebra o run).`)
}
console.log('\nOK: nada regrediu.')
