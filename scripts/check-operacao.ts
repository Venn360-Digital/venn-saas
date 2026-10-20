/**
 * O cartão "Operação agora" contra os dados de verdade.
 *
 * Existe porque o defeito que ele cobre era de **aritmética de tela**: o painel
 * dizia "1 de 4 no ar" para um Plano Digital que tem um WhatsApp. Um erro
 * desses não aparece em `tsc` e não aparece em teste de rota — aparece só
 * somando os rótulos, que é o que este script faz.
 *
 * Roda sem banco: os cenários são as linhas que a clínica tem, escritas à mão.
 * A lista de canais, essa sim, é a de produção — importada de `lib/plans`.
 */

import { REDES_DO_PLANO, redesDoPlano } from '../src/lib/plans'
import { isPlanId, type PlanId } from '../src/lib/plan-limits'

interface Integracao {
    channel: string
    status: string
    phoneNumber: string | null
}

interface Linha {
    nome: string
    rotulo: string
    tom: 'ok' | 'fora' | 'neutro'
    futuro?: boolean
}

/** A mesma tradução da tela. Se divergir daqui, o script perde a graça. */
const CANAL_NO_BANCO: Record<string, string[]> = {
    whatsapp: ['whatsapp_qr'],
    whatsapp_api: ['whatsapp_business'],
    instagram: ['instagram'],
    site: ['site'],
}

/** Cópia fiel do cálculo de `lerOperacao`, sem o Prisma. */
function canaisDe(integracoes: Integracao[], planId: string | null) {
    const plano: PlanId = isPlanId(planId) ? planId : 'flow'
    const doPlano = new Set(redesDoPlano(plano).map((r) => r.id))

    const canais = REDES_DO_PLANO.map((rede): Linha | null => {
        const colunas = CANAL_NO_BANCO[rede.id] ?? []
        const registros = integracoes.filter((i) => colunas.includes(i.channel))
        const conectadas = registros.filter((i) => i.status === 'connected').length
        const reais = registros.filter((i) => i.status === 'connected' || i.phoneNumber).length

        if (rede.emBreve && conectadas === 0) {
            return { nome: rede.label, rotulo: 'Em breve', tom: 'neutro', futuro: true }
        }
        if (!doPlano.has(rede.id)) {
            if (conectadas === 0) return null
            return { nome: rede.label, rotulo: 'No ar', tom: 'ok' }
        }
        if (reais === 0) return { nome: rede.label, rotulo: 'Não configurado', tom: 'neutro' }
        if (conectadas === 0) return { nome: rede.label, rotulo: 'Fora do ar', tom: 'fora' }
        if (conectadas < reais) {
            return { nome: rede.label, rotulo: `${conectadas} de ${reais} no ar`, tom: 'fora' }
        }
        return { nome: rede.label, rotulo: 'No ar', tom: 'ok' }
    }).filter((l): l is Linha => l !== null)

    return {
        canais,
        resumo: `${canais.filter((l) => l.tom === 'ok').length} de ${
            canais.filter((l) => !l.futuro).length
        } no ar`,
    }
}

const cenarios: { nome: string; plano: string | null; linhas: Integracao[]; espera: string }[] = [
    {
        // O estado da Venn em 2026-10-20, depois da limpeza para a produção.
        nome: 'Digital com um WhatsApp pareado, canal da Meta e site de teste',
        plano: 'flow',
        linhas: [
            { channel: 'site', status: 'disconnected', phoneNumber: null },
            { channel: 'whatsapp_business', status: 'disconnected', phoneNumber: null },
            { channel: 'whatsapp_qr', status: 'connected', phoneNumber: '553131918001' },
        ],
        espera: '1 de 1 no ar',
    },
    {
        // O WhatsApp da clínica caiu. É o alarme que o cartão existe para dar.
        nome: 'Digital com o WhatsApp fora do ar',
        plano: 'flow',
        linhas: [{ channel: 'whatsapp_qr', status: 'disconnected', phoneNumber: '553131918001' }],
        espera: '0 de 1 no ar',
    },
    {
        // Registro criado e nunca pareado não é queda: é vaga vazia.
        nome: 'Digital com a linha criada e nunca pareada',
        plano: 'flow',
        linhas: [{ channel: 'whatsapp_qr', status: 'disconnected', phoneNumber: null }],
        espera: '0 de 1 no ar',
    },
    {
        nome: 'Digital sem nenhuma linha',
        plano: 'flow',
        linhas: [],
        espera: '0 de 1 no ar',
    },
    {
        // O site é do Prime para cima, e lá ele conta.
        nome: 'Prime com site ligado e dois WhatsApps, um fora',
        plano: 'pro',
        linhas: [
            { channel: 'site', status: 'connected', phoneNumber: null },
            { channel: 'whatsapp_qr', status: 'connected', phoneNumber: '553131918001' },
            { channel: 'whatsapp_qr', status: 'disconnected', phoneNumber: '553188501161' },
        ],
        espera: '1 de 2 no ar',
    },
    {
        // Desceu de plano com o site ligado: aparece, porque está atendendo.
        nome: 'Digital com o site ainda ligado de um plano anterior',
        plano: 'flow',
        linhas: [
            { channel: 'site', status: 'connected', phoneNumber: null },
            { channel: 'whatsapp_qr', status: 'connected', phoneNumber: '553131918001' },
        ],
        espera: '2 de 2 no ar',
    },
]

let falhas = 0

for (const c of cenarios) {
    const { canais, resumo } = canaisDe(c.linhas, c.plano)
    const ok = resumo === c.espera
    if (!ok) falhas++
    console.log(`${ok ? '✓' : '✗'} ${c.nome}`)
    console.log(`   resumo: ${resumo}${ok ? '' : `  (esperado: ${c.espera})`}`)
    for (const l of canais) {
        console.log(`   · ${l.nome} — ${l.rotulo}${l.futuro ? ' (não conta)' : ''}`)
    }
}

/** Nenhum canal pode aparecer em vermelho sem linha pareada atrás. */
for (const c of cenarios) {
    const { canais } = canaisDe(c.linhas, c.plano)
    const pareadas = c.linhas.filter((i) => i.status === 'connected' || i.phoneNumber).length
    const vermelhos = canais.filter((l) => l.tom === 'fora')
    if (vermelhos.length > 0 && pareadas === 0) {
        falhas++
        console.log(`✗ ${c.nome}: alarme sem linha pareada atrás`)
    }
}

console.log(falhas === 0 ? '\nTudo certo.' : `\n${falhas} falha(s).`)
process.exit(falhas === 0 ? 0 : 1)
