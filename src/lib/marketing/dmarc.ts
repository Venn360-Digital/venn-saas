/**
 * O DMARC do domínio de envio: o que sugerir, e quando NÃO sugerir.
 *
 * Lógica pura — nenhuma consulta, nenhum binding. A consulta de DNS mora na
 * rota; aqui ficam as duas decisões que precisam ser testáveis sem rede.
 *
 * ## Por que o DMARC entrou na tela, se o SES não o exige
 *
 * O SES verifica o domínio com os três CNAME de DKIM e manda sem mais nada. Mas
 * desde fevereiro de 2024 Gmail e Yahoo passaram a **exigir** uma política DMARC
 * publicada de quem envia em massa, e a recusa deles não aparece como erro de
 * configuração: aparece como entrega caindo. Ou seja, o registro é opcional para
 * o nosso remetente funcionar e obrigatório para a campanha chegar — e é
 * exatamente o tipo de coisa que ninguém descobre olhando a nossa tela dizer
 * "verificado".
 *
 * ## Por que não basta imprimir o registro e pedir para colar
 *
 * O DMARC é **herdado pelo subdomínio**. Se a recomendação é usar
 * `mkt.clinica.com.br` (e é — separa a reputação da campanha da do e-mail do
 * dia a dia), então uma política em `clinica.com.br` já cobre o envio, e pedir
 * um segundo registro seria pedir trabalho inútil. Pior: duas políticas, uma
 * no subdomínio e outra na raiz, divergem com o tempo e a do subdomínio ganha —
 * então sugerir às cegas pode *afrouxar* uma política que já era boa.
 *
 * Daí o par de funções: uma diz qual é o domínio onde a política mora de fato
 * (`dominioOrganizacional`), e a outra monta o registro a sugerir só quando
 * nenhuma foi encontrada.
 */

/** O que uma consulta de DMARC encontrou, vindo da rota. */
export interface AchadoDeDmarc {
    /** O nome consultado onde a política apareceu — o próprio ou o do pai. */
    onde: string
    /** O conteúdo do TXT, como veio. */
    registro: string
}

/** Um registro de DMARC a publicar, quando falta. */
export interface SugestaoDeDmarc {
    tipo: 'TXT'
    nome: string
    valor: string
}

/**
 * Os sufixos de dois rótulos sob os quais se registra um domínio.
 *
 * **Não é a Public Suffix List**, e não finge ser: são ~1.500 entradas que
 * mudam, e carregá-las para decidir se mostramos uma linha a mais numa tela
 * seria desproporcional. É a heurística que cobre o que este produto vê —
 * `.com.br` e as variantes brasileiras por registro profissional, mais os
 * ccTLD de uso comum.
 *
 * O custo de errar é conhecido e pequeno nos dois sentidos: errar para o lado
 * largo faz consultar `_dmarc` num nome que não existe (uma consulta a mais,
 * nenhuma política encontrada, sugestão mostrada); errar para o lado estreito
 * faz consultar o pai errado e também não achar nada. Em nenhum dos dois a
 * tela afirma que existe política quando não existe — e essa é a afirmação que
 * não pode sair errada.
 */
const SUFIXOS_COMPOSTOS = new Set([
    'com.br', 'net.br', 'org.br', 'adv.br', 'med.br', 'odo.br', 'eng.br',
    'arq.br', 'psc.br', 'vet.br', 'nom.br', 'ind.br', 'inf.br', 'esp.br',
    'etc.br', 'srv.br', 'tur.br', 'art.br', 'blog.br', 'app.br',
    'com.pt', 'com.ar', 'com.mx', 'com.co', 'com.uy', 'com.py',
    'co.uk', 'org.uk', 'com.au', 'co.nz', 'co.jp', 'co.za',
])

/**
 * Onde a política DMARC deste domínio mora, por herança.
 *
 * `mkt.clinica.com.br` → `clinica.com.br`. `clinica.com.br` → ele mesmo (já é o
 * registrável; não existe pai a consultar). Devolve `null` quando o próprio
 * domínio já é o organizacional, para a rota não fazer uma segunda consulta
 * idêntica à primeira.
 */
export function dominioOrganizacional(dominio: string): string | null {
    const partes = dominio.toLowerCase().replace(/\.$/, '').split('.').filter(Boolean)
    if (partes.length < 3) return null

    const doisUltimos = partes.slice(-2).join('.')
    const tamanhoDoRegistravel = SUFIXOS_COMPOSTOS.has(doisUltimos) ? 3 : 2
    if (partes.length <= tamanhoDoRegistravel) return null

    return partes.slice(-tamanhoDoRegistravel).join('.')
}

/**
 * O registro a sugerir quando nenhuma política foi encontrada.
 *
 * ## `p=none`, e não `p=quarantine`
 *
 * `none` é "publique a política, não mude o tratamento". É o que Gmail e Yahoo
 * pedem, e é o único valor que **não pode piorar a entrega de nada que já
 * funciona** no domínio — inclusive do e-mail do dia a dia, que passa pelo
 * Google Workspace e não por nós. Endurecer para `quarantine` ou `reject` é
 * decisão de quem administra o domínio, depois de ler relatórios, e não efeito
 * colateral de cadastrar um remetente de campanha aqui.
 *
 * ## Sem `rua=`
 *
 * A tag `rua` manda os relatórios agregados para um endereço. Pôr um endereço
 * nosso ali faria a plataforma receber relatório do domínio do cliente sem ele
 * ter pedido, e pôr um endereço dele exigiria perguntar qual — um campo a mais
 * para atravessar a única coisa que o registro precisa fazer, que é existir.
 * Fica de fora; quem quiser relatório acrescenta a tag depois.
 */
export function registroDmarcSugerido(dominio: string): SugestaoDeDmarc {
    const alvo = dominioOrganizacional(dominio) ?? dominio
    return {
        tipo: 'TXT',
        nome: `_dmarc.${alvo}`,
        valor: 'v=DMARC1; p=none;',
    }
}

/**
 * O TXT encontrado é mesmo uma política DMARC?
 *
 * A zona pode ter qualquer coisa em `_dmarc` — um TXT de verificação de outro
 * serviço, um resto de migração. Política de verdade começa por `v=DMARC1`
 * (sem diferenciar maiúsculas, com espaço opcional, como o RFC 7489 §6.4
 * manda ler).
 */
export function pareceDmarc(txt: string): boolean {
    return /^\s*v\s*=\s*dmarc1\s*;/i.test(txt)
}

/**
 * Os TXT de uma resposta DNS-over-HTTPS, já montados.
 *
 * Separado da chamada de rede de propósito — é aqui que mora o detalhe que
 * quebra em produção e não no teste à mão: **um TXT pode vir partido em várias
 * cadeias de até 255 bytes**, e o resolvedor devolve cada pedaço entre aspas no
 * mesmo `data` (`"v=DMARC1; p=none; rua=mailt" "o:x@y.com"`). Quem só tira as
 * aspas das pontas lê um registro truncado e conclui que não é DMARC — ou pior,
 * que a política é outra.
 *
 * `Status` diferente de 0 devolve lista vazia: NXDOMAIN e SERVFAIL são as duas
 * respostas normais aqui (o nome `_dmarc` não existir é o caso comum), e nenhuma
 * delas é erro nosso.
 */
export function txtsDaRespostaDoh(json: unknown): string[] {
    if (!json || typeof json !== 'object') return []
    const corpo = json as { Status?: number; Answer?: Array<{ type?: number; data?: string }> }
    if (corpo.Status !== 0 || !Array.isArray(corpo.Answer)) return []

    return corpo.Answer.filter((r) => r.type === 16 && typeof r.data === 'string').map((r) =>
        // Junta as cadeias entre aspas; se não houver aspas, usa o valor cru.
        (r.data!.match(/"([^"]*)"/g) ?? [r.data!])
            .map((p) => p.replace(/^"|"$/g, ''))
            .join('')
    )
}
