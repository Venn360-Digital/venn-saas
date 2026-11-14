/**
 * Como uma campanha se apresenta na tela, qualquer que seja o canal.
 *
 * ## Por que isto é um módulo e não um `?:` em cada tela
 *
 * Quatro lugares projetam uma campanha para a tela: a listagem e o detalhe, cada
 * um em duas versões (componente de servidor e rota de API, porque a primeira
 * página vem do servidor e as seguintes vêm da rota — regra do DESIGN.md §5).
 *
 * Com dois canais, cada um desses quatro teria de responder "o que escrever na
 * coluna *Conteúdo* e na coluna *Origem*". Escrito quatro vezes, isso divergiria
 * na primeira correção feita em três delas — e o sintoma seria a listagem e o
 * detalhe discordando sobre a mesma campanha.
 *
 * Então a pergunta é respondida **uma vez**, aqui, e os quatro chamam.
 *
 * Não tem `server-only`: o tipo e o rótulo de canal são lidos também pelo
 * componente de cliente, e é o mesmo motivo que mantém `brand.ts` sem ele.
 */

/** Os canais por onde uma campanha sai. */
export const CANAIS_DE_CAMPANHA = ['whatsapp', 'email'] as const

export type CanalDeCampanha = (typeof CANAIS_DE_CAMPANHA)[number]

export function ehCanalDeCampanha(valor: unknown): valor is CanalDeCampanha {
    return typeof valor === 'string' && (CANAIS_DE_CAMPANHA as readonly string[]).includes(valor)
}

/** O rótulo do canal na tela. */
export const NOME_DO_CANAL: Record<CanalDeCampanha, string> = {
    whatsapp: 'WhatsApp',
    email: 'E-mail',
}

/**
 * O recorte que o apresentador precisa — e só ele.
 *
 * Declarado como forma estrutural, não como tipo do Prisma: quem chama faz
 * `include` do que quer e passa, e um `select` mais enxuto numa das telas não
 * quebra aqui.
 */
export interface CampanhaParaApresentar {
    channel: string
    subject: string | null
    template: { metaName: string } | null
    integration: { label: string | null; phoneNumber: string | null } | null
    emailTemplate: { name: string } | null
    sender: { fromLocal: string; domain: string; fromName: string } | null
}

export interface ApresentacaoDaCampanha {
    canal: CanalDeCampanha
    canalLabel: string
    /**
     * O que a campanha manda: o template aprovado no WhatsApp, o assunto no
     * e-mail. É o assunto, e não o nome do template, porque é o assunto que
     * quem recebe vê — e é por ele que a equipe reconhece o disparo depois.
     */
    conteudo: string
    /** Por onde sai: a linha no WhatsApp, o endereço do remetente no e-mail. */
    origem: string
}

/**
 * O traço que aparece quando a campanha ainda não escolheu.
 *
 * Rascunho sem linha e sem template é estado normal — a campanha nasce vazia e
 * o wizard preenche. Escrever "—" é mais honesto que inventar um nome, e é o
 * mesmo caractere que o resto das telas usa para campo vazio.
 */
const VAZIO = '—'

export function apresentarCampanha(b: CampanhaParaApresentar): ApresentacaoDaCampanha {
    const canal: CanalDeCampanha = ehCanalDeCampanha(b.channel) ? b.channel : 'whatsapp'

    if (canal === 'email') {
        return {
            canal,
            canalLabel: NOME_DO_CANAL.email,
            conteudo: b.subject || b.emailTemplate?.name || VAZIO,
            origem: b.sender ? `${b.sender.fromLocal}@${b.sender.domain}` : VAZIO,
        }
    }

    return {
        canal,
        canalLabel: NOME_DO_CANAL.whatsapp,
        conteudo: b.template?.metaName || VAZIO,
        origem: b.integration?.label || b.integration?.phoneNumber || VAZIO,
    }
}

/**
 * O `include` que o apresentador espera.
 *
 * Exportado para as quatro consultas não o escreverem à mão — esquecer um dos
 * quatro `include` daria `null` onde há dado, e a tela mostraria "—" numa
 * campanha configurada. O tipo garante que o que a consulta traz é o que o
 * apresentador lê.
 */
export const INCLUDE_DA_APRESENTACAO = {
    template: { select: { metaName: true } },
    integration: { select: { label: true, phoneNumber: true } },
    emailTemplate: { select: { name: true } },
    sender: { select: { fromLocal: true, domain: true, fromName: true } },
} as const
