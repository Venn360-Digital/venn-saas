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
 * O nome do configuration set do SES — **um por app**, não por unidade.
 *
 * ## Por que não um por unidade
 *
 * A primeira versão derivava o nome do `workspaceId`, e estava errada de dois
 * jeitos. O grave: o SES **não cria** um configuration set porque alguém o
 * citou — enviar apontando para um que não existe falha com `NotFoundException`,
 * e falharia no primeiro disparo de cada cliente novo. Criá-lo na hora exigiria
 * `ses:CreateConfigurationSet` e `ses:CreateConfigurationSetEventDestination`
 * nas credenciais da aplicação, que é poder de configuração de conta nas mãos
 * de um caminho de requisição.
 *
 * O menor: ele não comprava nada. O configuration set serve para **rotear os
 * eventos** (entrega, abertura, clique, reclamação) e para agrupar métrica — e
 * de quem é cada evento já vem nas `EmailTags` do envio, que carregam o id da
 * campanha e o do destinatário. Um por unidade seria um objeto a criar, a
 * configurar e a limpar, por cliente, para dizer o que a tag já diz.
 *
 * ## Um por app, criado uma vez
 *
 * `venn-odontobox`, `venn-stagent`, `venn-conecta`. Criados à mão junto com as
 * credenciais (ver `docs/ses-credenciais.md`), cada um com um destino de evento
 * apontando para o webhook daquele app. Assim um app não escreve no caminho de
 * evento do outro, e a credencial de cada um pode ser restrita ao seu.
 *
 * Vem de `SES_CONFIGURATION_SET` quando declarado; o padrão é derivado do slug,
 * para um app novo funcionar sem variável nova.
 */
export function nomeDoConfigurationSet(slugDoApp: string): string {
    return process.env.SES_CONFIGURATION_SET || `venn-${slugDoApp || 'app'}`
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
