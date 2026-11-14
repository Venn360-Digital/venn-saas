import { createLogger } from './registro'

/**
 * A costura do motor do funil.
 *
 * Mesma forma de `trabalhos/agenda.ts`, e pelo mesmo motivo: criar instância de
 * Workflow exige o **binding**, que só existe dentro do Worker e chega por
 * `env`. Importá-lo do lado da aplicação pediria
 * `import { env } from 'cloudflare:workers'`, que não resolve no typecheck do
 * app Next desta máquina.
 *
 * O efeito bom é o de sempre: `talvezEntrarNoFunil` pode ser chamado de uma rota
 * do Next, de um consumidor de fila ou de um teste, e nenhum dos três sabe o que
 * é um Workflow.
 */
const log = createLogger('FUNIL')

export interface MotorDoFunilRemoto {
    /**
     * Cria a instância que vai andar esta passagem.
     *
     * Devolve o `instanceId`, que a passagem guarda — é por ele que a tela lê o
     * progresso, porque o passo atual **não** mora no banco (ver a migração).
     */
    criar(runId: string): Promise<string>
}

let motor: MotorDoFunilRemoto | null = null

export function registrarMotorDoFunil(m: MotorDoFunilRemoto): void {
    motor = m
}

/** Há motor? Quem decide se vale criar a passagem precisa saber **antes**. */
export function temMotorDoFunil(): boolean {
    return motor !== null
}

export class SemMotorDoFunilError extends Error {
    constructor() {
        super(
            'nenhum motor de funil registrado: a passagem não pode andar. ' +
                'O Worker o registra na inicialização (ver src/cloudflare/entrada.ts).'
        )
        this.name = 'SemMotorDoFunilError'
    }
}

/**
 * **Lança quando não há motor registrado**, e quem chama não cria a linha.
 *
 * Criar `FunnelRun` sem instância deixaria uma passagem `running` que nunca
 * anda — e pior que não andar: o índice único `(funnelId, contactId)` impede a
 * pessoa de entrar de novo, então ela ficaria **permanentemente** fora daquele
 * funil, sem nada na tela explicando por quê.
 */
export async function criarInstanciaDoFunil(runId: string): Promise<string> {
    if (!motor) throw new SemMotorDoFunilError()
    const instanceId = await motor.criar(runId)
    log.debug(`passagem ${runId}: instância ${instanceId} criada`)
    return instanceId
}
