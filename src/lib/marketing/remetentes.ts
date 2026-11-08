import type { ToneEntry } from '@/components/shared/StatusBadge'

/**
 * O que o cliente precisa publicar no DNS dele, e como o remetente se apresenta.
 *
 * Lógica pura: nenhuma consulta, nenhum binding. Serve à rota, ao cron e à tela
 * — e é testável sem banco, que é a regra da casa para o que decide.
 *
 * Sem `server-only`: a tela mostra os registros e copia os valores, então o
 * componente de cliente lê daqui. Mesmo motivo que mantém `brand.ts` sem ele.
 */

/** Um registro que o cliente acrescenta na zona do domínio dele. */
export interface RegistroDeDns {
    tipo: 'CNAME'
    /** O nome, já completo — é assim que a maioria dos painéis de DNS pede. */
    nome: string
    valor: string
}

/**
 * Os três CNAME do Easy DKIM.
 *
 * ## Por que três CNAME e não um TXT com a chave
 *
 * No Easy DKIM a chave fica **com o SES**, que a gira sozinho a cada 90 dias. O
 * cliente publica três ponteiros e nunca mais toca. A alternativa (DKIM próprio,
 * um TXT com a chave pública) deixaria a rotação na mão de quem não sabe que ela
 * existe — e chave velha é entrega caindo sem ninguém entender por quê.
 *
 * ## Por que três bastam para o DMARC
 *
 * O DMARC passa com **SPF ou DKIM alinhado**, não os dois. O `d=` da assinatura
 * DKIM é o domínio do cliente, então o alinhamento por DKIM já acontece com
 * estes três registros.
 *
 * Um custom MAIL FROM alinharia o SPF também e pede MX e TXT adicionais na zona
 * — mais entrega para o cliente errar, em troca de redundância. Fica como
 * melhoria, não requisito: o que trava a adoção é o tanto que se pede a quem
 * nunca mexeu em DNS.
 */
export function registrosDeDns(dominio: string, tokens: string[]): RegistroDeDns[] {
    return tokens.map((token) => ({
        tipo: 'CNAME' as const,
        nome: `${token}._domainkey.${dominio}`,
        valor: `${token}.dkim.amazonses.com`,
    }))
}

/**
 * O nome do configuration set do SES para uma unidade.
 *
 * Um por unidade, e **derivado do id** em vez de guardado: derivar não tem como
 * divergir, e guardar criaria uma segunda fonte para a mesma informação.
 *
 * O prefixo existe porque a conta do SES é compartilhada entre os três apps — o
 * id de workspace sozinho não diz de qual produto é, e o painel do SES lista
 * todos juntos.
 */
export function nomeDoConfigurationSet(workspaceId: string): string {
    // O SES aceita letras, números, hífen e sublinhado em nome de configuration
    // set. `cuid()` já cabe nisso, mas a limpeza fica como guarda para o dia em
    // que o id mudar de forma.
    const limpo = workspaceId.replace(/[^A-Za-z0-9_-]/g, '')
    return `venn-${limpo}`
}

/**
 * O estado do remetente — rótulo e tom na mesma entrada.
 *
 * No formato que o `StatusBadge` consome, e não um `Record<string, string>` com
 * a cor escolhida na tela: tom decidido em cada tela é como "verde" acaba
 * significando "ativo" numa e "pago" noutra.
 *
 * `pending` é **warning**, não neutro: há trabalho pendente do lado do cliente,
 * e um chip cinza faria parecer um estado em que não há nada a fazer.
 */
export const SITUACAO_DO_REMETENTE: Record<string, ToneEntry> = {
    pending: { label: 'Aguardando DNS', tone: 'warning' },
    verified: { label: 'Verificado', tone: 'success' },
    failed: { label: 'Falhou', tone: 'destructive' },
}

/**
 * O que dizer sobre um remetente que ainda não verificou.
 *
 * Os estados do DKIM no SES não significam a mesma coisa para quem está
 * esperando: `TEMPORARY_FAILURE` é "o DNS ainda não propagou, espere", e
 * `FAILED` é "o registro está errado, confira". Mostrar "falhou" nos dois casos
 * faz o cliente mexer em DNS que estava certo.
 */
export function explicacaoDoDkim(dkimStatus: string | null): string {
    switch (dkimStatus) {
        case 'SUCCESS':
            return 'Domínio verificado. As campanhas já podem sair por ele.'
        case 'FAILED':
            return 'Os registros não foram encontrados, ou o valor está diferente do esperado. Confira os três CNAME abaixo na zona do domínio.'
        case 'TEMPORARY_FAILURE':
            return 'Ainda não foi possível ler os registros. Isso é comum nas primeiras horas: o DNS leva de alguns minutos a 24 horas para propagar.'
        case 'NOT_STARTED':
            return 'A verificação ainda não começou. Publique os três CNAME abaixo na zona do domínio.'
        case 'PENDING':
        default:
            return 'Publique os três CNAME abaixo na zona do domínio. A verificação acontece sozinha, e costuma levar de alguns minutos a algumas horas.'
    }
}
