import { APP } from '../config/app'
import { BRAND } from '../marca'

/**
 * O endereço **deste** app, neste ambiente — para link que sai daqui e alguém
 * de fora abre.
 *
 * ## Por que não `NEXT_PUBLIC_APP_URL`
 *
 * Foi a minha primeira versão em `urlDaProposta`, e a homologação de 21/11/2026
 * mostrou o resultado: a variável **não está gravada** nos Workers de
 * homologação, então o link caía no fallback `https://${BRAND().appHost}` — que
 * é o host de **produção**. O cliente recebia por e-mail um endereço de
 * produção para uma proposta que só existe em homologação, e produção respondia
 * `307` para `/login`. Da tela, "não é possível abrir o link".
 *
 * E a razão de fundo é mais antiga que o meu defeito: `lib/auth/better-auth.ts`
 * documenta o incidente de 2026-10-23, em que `NEXT_PUBLIC_APP_URL` gravada com
 * valor que não batia com a origem real derrubou o acesso. A conclusão de lá
 * vale igual aqui — **a identidade do app mora em código**, onde o `typecheck` a
 * vê e não há como gravá-la errada num segredo; o que varia por ambiente sai de
 * `APP().env`, que é enum validado.
 *
 * ## Por que módulo próprio
 *
 * A regra já existia, numa linha dentro de `origemDeReserva()` em
 * `lib/auth/better-auth.ts`. Importá-la de lá arrastaria a biblioteca de
 * autenticação e o Prisma para dentro de quem só quer montar um link. Então ela
 * mudou para cá e aquela função passou a delegar: uma regra, um lugar, e os dois
 * verificadores (`check:auth` e `check:propostas`) cobrando o mesmo.
 *
 * ## O que ainda não cobre
 *
 * Build de **preview** de PR roda com `APP_ENV=stg`, então o link que ele monta
 * aponta para o host de homologação, não para a URL do preview. É aceito: o
 * preview serve para ver tela, e o documento que importa vive em homologação.
 */

/**
 * O host, pela regra de ambiente. Pura de propósito — é o que permite provar as
 * três respostas sem variável de ambiente nem marca registrada.
 */
export function hostDoApp(env: string, appHost: string): string {
    return env === 'stg' ? `homolog-${appHost}` : appHost
}

/** `https://` + o host deste app neste ambiente, sem barra no fim. */
export function origemDoApp(): string {
    return `https://${hostDoApp(APP().env, BRAND().appHost)}`
}
