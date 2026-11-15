/**
 * Os nomes de cookie do app, derivados da marca.
 *
 * ## Por que separado de `auth/workspace.ts`
 *
 * Ele morava lá, e `plataforma/acesso.ts` passou a precisar dele para derivar
 * `<app>.assumir`. Só que `workspace.ts` importa `acesso.ts` — é ele quem
 * chama `contaAssumida()` — e o ciclo fez o `const` de nível de módulo cair em
 * TDZ: `ReferenceError: Cannot access 'workspaceCookie()' before initialization`,
 * no CI, com o `tsc` verde. Ciclo de import é o tipo de defeito que o tipo não
 * vê e o primeiro `import` em tempo de execução vê.
 *
 * Um módulo folha resolve de vez: os dois lados importam daqui e nenhum importa
 * o outro.
 *
 * ## O prefixo é por produto, e vem da MARCA
 *
 * Cada app tem o seu, e é o que impede dois produtos abertos no mesmo navegador
 * de disputarem o mesmo cookie.
 *
 * Era o literal `'odontobox'`. Agora é `BRAND().slug`, e **o nome resultante é
 * byte a byte o mesmo** — o slug deste app é exatamente `odontobox`. Isso
 * importa mais que parece: trocar o nome de um cookie de sessão **desloga todos
 * os usuários de uma vez**, e `test:cookies` afirma a igualdade para que a
 * próxima mudança de marca não a rompa por acidente.
 *
 * Vem de `BRAND()` e não de `APP().slug` porque o default daquele é string
 * vazia: um env não gravado daria `.workspace`, que não é o cookie de ninguém.
 *
 * ## Funções, não constantes
 *
 * `BRAND()` é fail-fast, e constante de módulo é avaliada quando a Cloudflare
 * VALIDA o script — sem marca registrada. A forma que reprovou cinco
 * publicações nesta fase. Memoizadas porque são lidas a cada requisição.
 *
 * O módulo deixou de ser "sem importação nenhuma" (ver acima), e isso é seguro:
 * `marca.ts` é folha de verdade — não importa nada do core — então o ciclo que
 * causou o TDZ não volta.
 */
import { BRAND } from '../../marca'

let prefixoCache: string | null = null
/** O prefixo de todo cookie deste app. */
export function prefixoDoCookie(): string {
    if (prefixoCache === null) prefixoCache = BRAND().slug
    return prefixoCache
}

/**
 * A unidade escolhida, quando a conta tem mais de uma.
 *
 * Só o Multiclínica tem mais de uma, então para quase todo mundo ele nunca é
 * escrito e nada muda. Quem escreve é a troca de workspace; quem lê é
 * `getWorkspaceMember()`, e **só depois de conferir que a unidade é mesmo
 * dela** — cookie é campo de texto como qualquer outro, e aceitar o que ele diz
 * seria entregar a clínica do vizinho a quem souber editá-lo.
 */
export function workspaceCookie(): string {
    return `${prefixoDoCookie()}.workspace`
}

/**
 * A conta de cliente assumida pelo operador da plataforma.
 *
 * Também não autoriza nada: diz qual unidade, e `getPlatformAdmin()` é quem
 * deixa entrar. Ver `lib/plataforma/acesso.ts`.
 */
export function cookieAssumir(): string {
    return `${prefixoDoCookie()}.assumir`
}
