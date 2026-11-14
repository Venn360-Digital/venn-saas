/// <reference types="@cloudflare/workers-types" />

import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers'

import { descartarCliente, escopoDoPrisma, type EscopoDoPrisma } from '@venn/db/cliente'
import {
    MAX_TRANSICOES,
    minutosDeEspera,
    primeiroPasso,
    proximoPasso,
    TEXTO_DA_PARADA,
    type MotivoDeParada,
    type PassoDoFunil,
} from '../lib/funil/passos'
import {
    atribuir,
    enviarEmailDoPasso,
    enviarWhatsAppDoPasso,
    etiquetar,
    moverEtapa,
    type ResultadoDaAcao,
} from '../lib/funil/acoes'
import {
    avaliarCondicao,
    canalDoPasso,
    freioDaPassagem,
    lerPassagem,
    type Passagem,
} from '../lib/funil/estado'
import { concluir, falhar, parar } from '../lib/funil/desfecho'

/**
 * O motor do funil, sobre Cloudflare Workflows.
 *
 * ## Por que Workflows, e não um Durable Object nosso
 *
 * O plano antigo (`PLANO.md` §7) previa motor próprio sobre Durable Object e
 * classificava "runtime com estado por conversa" como *"o coração e o risco"*,
 * 15 a 25 dias. Workflows resolve exatamente esse pedaço e não existia quando
 * aquilo foi escrito:
 *
 * - `step.sleep` aceita **até 365 dias**, que é a escala de um funil de retorno;
 * - instância em `waiting` **não conta** para o limite de concorrência e não
 *   gasta CPU — milhões podem dormir ao mesmo tempo;
 * - cada `step.do` é persistido e retomável, com retentativa própria.
 *
 * Um DO nosso teria de reimplementar as três coisas, e a terceira é a que dói:
 * retomar do meio sem repetir o passo que já mandou a mensagem.
 *
 * ## Casca fina
 *
 * Nada decide aqui. A navegação, a espera, os freios e a detecção de ciclo estão
 * em `lib/funil/passos.ts`, que é puro e roda em `npx tsx` — o workerd não roda
 * nesta máquina, e lógica escrita dentro desta classe só poderia ser exercitada
 * em staging. Este arquivo escolhe a ordem das chamadas; é tudo.
 *
 * ## O payload é só o `runId`
 *
 * Nada mais. A instância pode dormir um ano, e qualquer coisa copiada para o
 * payload congela nesse instante: o desenho do funil, o nome do contato, o
 * endereço de e-mail. Pior, dado pessoal no payload sobreviveria à exclusão do
 * contato — a instância continuaria carregando o e-mail de quem pediu para ser
 * apagado. O `runId` é a única entrada, e cada volta relê o mundo.
 */

interface PayloadDoFunil {
    runId: string
}

/**
 * O motor não usa binding nenhum.
 *
 * Banco e SES chegam por `process.env` (`DATABASE_URL`, `SES_*`), que em Workers
 * com `nodejs_compat` existe. Declarar `Env` vazio é a forma de dizer isso em
 * tipo, em vez de deixar `unknown` e perder a conferência.
 */
type EnvDoMotor = Record<string, never>

export class MotorDoFunil extends WorkflowEntrypoint<EnvDoMotor, PayloadDoFunil> {
    async run(event: Readonly<WorkflowEvent<PayloadDoFunil>>, step: WorkflowStep): Promise<void> {
        const { runId } = event.payload

        /**
         * `passoAtualId` é o estado **da instância**, não do banco.
         *
         * A tabela não guarda o passo atual de propósito (ver o comentário da
         * migração): duas fontes para o mesmo fato divergiriam na primeira vez
         * que a instância avançasse e a gravação falhasse. Quem guarda o
         * progresso é o Workflows, e é dele que a tela lê.
         */
        let passoAtualId: string | null = null
        let ramo: 'sim' | 'nao' | 'padrao' = 'padrao'

        for (let volta = 0; volta < MAX_TRANSICOES; volta++) {
            /**
             * O nome de cada `step.do` carrega a volta.
             *
             * Nome repetido no Workflows devolve o resultado **gravado** da
             * primeira vez, sem executar de novo. Num laço, nomes fixos fariam a
             * segunda volta reusar a leitura da primeira: o motor andaria com
             * uma foto velha do mundo, e um freio levantado no meio do caminho
             * nunca seria visto.
             */
            const naVolta = (nome: string) => `v${volta}-${nome}`

            /**
             * A leitura fica **fora** de `step.do`, e isso é desenho, não atalho.
             *
             * Duas razões, e a segunda é a que importa:
             *
             * 1. O retorno de um `step.do` é **persistido** pelo Workflows. A
             *    passagem carrega nome e e-mail do contato, e gravá-los na
             *    instância criaria uma cópia de dado pessoal que sobrevive à
             *    exclusão do contato — a instância seguiria carregando o e-mail
             *    de quem pediu para ser apagado.
             * 2. Resultado gravado é resultado **congelado**. Na retomada, o
             *    `step.do` devolve o que foi lido antes de a instância dormir, e
             *    um freio levantado durante o sono nunca seria visto: alguém
             *    assume a conversa, a pessoa pede para sair, e o passo seguinte
             *    sai de qualquer jeito.
             *
             * Ler não precisa de `step.do`: só precisa quem **não pode
             * repetir**. Entre passos, o código reexecuta na retomada, e
             * reexecutar uma leitura é o comportamento certo — custa uma
             * consulta e devolve o mundo de agora.
             */
            const passagem = await comEscopo(() => lerPassagem(runId))

            /**
             * A passagem não existe mais — o contato foi apagado e a linha foi
             * com ele (cascade). Encerra sem gravar: não há linha para marcar.
             */
            if (!passagem) return

            const passo = passoAtualId
                ? passagem.passos.find((p) => p.id === passoAtualId) ?? null
                : primeiroPasso(passagem.passos)

            const freio = await comEscopo(() =>
                freioDaPassagem(passagem, passo ? canalDoPasso(passo.config) : 'email')
            )

            if (freio) {
                await step.do(naVolta('parar'), () =>
                    comEscopo(() => parar(runId, freio))
                )
                return
            }

            // Sem passo: ou o funil acabou, ou não tem nenhum desenhado.
            if (!passo) {
                await step.do(naVolta('concluir'), () => comEscopo(() => concluir(runId)))
                return
            }

            if (passo.type === 'encerrar') {
                await step.do(naVolta('encerrar'), () => comEscopo(() => concluir(runId)))
                return
            }

            /**
             * A espera é `step.sleep`, **fora** de um `step.do`.
             *
             * Dormir dentro de um `step.do` seria dormir dentro de uma
             * invocação: ela conta tempo de CPU, tem teto de duração e não
             * sobrevive a um reinício. `step.sleep` suspende a instância, que
             * sai do limite de concorrência e volta sozinha.
             */
            if (passo.type === 'espera') {
                const minutos = minutosDeEspera(passo.config)
                if (minutos > 0) {
                    await step.sleep(naVolta(`esperar-${passo.id}`), `${minutos} minutes`)
                }
                const seguinte = proximoPasso(passo, passagem.passos, 'padrao')
                passoAtualId = seguinte?.id ?? null
                ramo = 'padrao'
                if (!seguinte) {
                    await step.do(naVolta('concluir-apos-espera'), () =>
                        comEscopo(() => concluir(runId))
                    )
                    return
                }
                continue
            }

            if (passo.type === 'condicao') {
                /**
                 * A condição, ao contrário da leitura, **precisa** de `step.do`.
                 *
                 * O ramo escolhido tem de ser o mesmo em toda retomada. Se ele
                 * fosse reavaliado, uma instância que já mandou a mensagem do
                 * ramo "sim" — gravada, porque envio é `step.do` — poderia
                 * descer pelo "não" na retomada e mandar a do outro ramo
                 * também. A pessoa receberia as duas.
                 */
                const decidido = await step.do(naVolta(`condicao-${passo.id}`), () =>
                    comEscopo(async () => {
                        const { ramo: r } = await avaliarCondicao(passagem, passo.config)
                        return { ramo: r as string }
                    })
                )
                ramo = decidido.ramo === 'sim' ? 'sim' : 'nao'
            } else {
                /**
                 * Retorno chapado, e não o `ResultadoDaAcao` cru.
                 *
                 * O que volta de um `step.do` é serializado e gravado, então o
                 * tipo tem de ser dado simples. Chapar aqui também mantém o
                 * `detalhe` — id da mensagem do SES, por exemplo — fora do
                 * armazenamento da instância: ele serve ao log, não à retomada.
                 */
                const r = await step.do(naVolta(`fazer-${passo.id}`), () =>
                    comEscopo(async () => {
                        const bruto = await executarPasso(passagem, passo)
                        return bruto.ok
                            ? { ok: true, definitivo: false, motivo: '' }
                            : { ok: false, definitivo: bruto.definitivo, motivo: bruto.motivo }
                    })
                )

                /**
                 * Falha **definitiva** encerra a passagem como `failed`, com o
                 * motivo gravado.
                 *
                 * Seguir em frente seria o pior desfecho: a pessoa nunca
                 * receberia aquele passo, os seguintes continuariam saindo, e a
                 * tela mostraria a passagem como concluída. Um funil de três
                 * e-mails em que o primeiro não saiu não é um funil que
                 * funcionou em dois terços — é uma sequência sem começo.
                 *
                 * Falha **passageira** lança, e o Workflows repete este
                 * `step.do` com a retentativa dele. Lançar é o jeito de pedir
                 * repetição; devolver erro seria aceitar o passo como feito.
                 */
                if (!r.ok) {
                    if (!r.definitivo) throw new Error(`passo ${passo.id}: ${r.motivo}`)
                    await step.do(naVolta('falhar'), () =>
                        comEscopo(() => falhar(runId, `${passo.type}: ${r.motivo}`))
                    )
                    return
                }
                ramo = 'padrao'
            }

            const seguinte = proximoPasso(passo, passagem.passos, ramo)
            if (!seguinte) {
                await step.do(naVolta('concluir-no-fim'), () => comEscopo(() => concluir(runId)))
                return
            }
            passoAtualId = seguinte.id
        }

        /**
         * Estourou o teto de transições.
         *
         * `cicloNoDesenho` recusa ciclo na publicação, que é onde o erro deve
         * morrer. Chegar aqui significa que o desenho entrou em laço por outro
         * caminho — `edges` editado no banco, ou funil publicado antes daquela
         * guarda existir. Marca `failed` com o motivo em vez de continuar: cada
         * volta a mais é uma mensagem a mais para uma pessoa de verdade.
         */
        await step.do('estourou-o-teto', () =>
            comEscopo(() =>
                falhar(
                    runId,
                    `a passagem deu ${MAX_TRANSICOES} voltas sem terminar; o desenho provavelmente tem um ciclo`
                )
            )
        )
    }
}

/**
 * Executa um passo que **faz** alguma coisa.
 *
 * Fica fora da classe para que a escolha da ação seja uma função comum, e não
 * um método que só existe dentro do runtime.
 */
async function executarPasso(passagem: Passagem, passo: PassoDoFunil): Promise<ResultadoDaAcao> {
    switch (passo.type) {
        case 'mensagem':
            return canalDoPasso(passo.config) === 'email'
                ? enviarEmailDoPasso(passagem, passo.config)
                : enviarWhatsAppDoPasso()
        case 'etiquetar':
            return etiquetar(passagem, passo.config)
        case 'mover_etapa':
            return moverEtapa(passagem, passo.config)
        case 'atribuir':
            return atribuir(passagem, passo.config)
        default:
            /**
             * Tipo desconhecido é falha definitiva, não "pula".
             *
             * Pular deixaria a passagem terminar "com sucesso" tendo ignorado um
             * passo que alguém desenhou. Um tipo que o motor não entende é
             * desenho mais novo que o código, e isso precisa aparecer.
             */
            return {
                ok: false,
                definitivo: true,
                motivo: `tipo de passo desconhecido: ${passo.type}`,
            }
    }
}

/**
 * Um cliente de Prisma por `step.do`, aberto e **fechado**.
 *
 * É a regra do projeto (ver `lib/prisma.ts`), e aqui ela é mais rígida que em
 * qualquer outro lugar: uma instância de funil pode viver um ano. Um cliente por
 * instância seguraria conexão no Neon durante todo esse tempo, e o orçamento de
 * CU-hora da franquia é medido em horas de compute acordado — não em anos.
 *
 * Cada `step.do` é uma invocação própria, então o escopo é dela.
 */
async function comEscopo<T>(trabalho: () => Promise<T>): Promise<T> {
    const escopo: EscopoDoPrisma = {}
    try {
        return await escopoDoPrisma.run(escopo, trabalho)
    } finally {
        await descartarCliente(escopo)
    }
}

export { TEXTO_DA_PARADA }
