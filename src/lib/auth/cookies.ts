/**
 * Os nomes de cookie do app, num módulo **sem importação nenhuma**.
 *
 * ## Por que separado de `auth/workspace.ts`
 *
 * Ele morava lá, e `plataforma/acesso.ts` passou a precisar dele para derivar
 * `<app>.assumir`. Só que `workspace.ts` importa `acesso.ts` — é ele quem
 * chama `contaAssumida()` — e o ciclo fez o `const` de nível de módulo cair em
 * TDZ: `ReferenceError: Cannot access 'WORKSPACE_COOKIE' before initialization`,
 * no CI, com o `tsc` verde. Ciclo de import é o tipo de defeito que o tipo não
 * vê e o primeiro `import` em tempo de execução vê.
 *
 * Um módulo folha resolve de vez: os dois lados importam daqui e nenhum importa
 * o outro.
 *
 * ## O prefixo é por produto
 *
 * Cada app tem o seu, e é o que impede dois produtos abertos no mesmo navegador
 * de disputarem o mesmo cookie.
 */

/** O prefixo de todo cookie deste app. */
export const PREFIXO_DO_COOKIE = 'odontobox'

/**
 * A unidade escolhida, quando a conta tem mais de uma.
 *
 * Só o Multiclínica tem mais de uma, então para quase todo mundo ele nunca é
 * escrito e nada muda. Quem escreve é a troca de workspace; quem lê é
 * `getWorkspaceMember()`, e **só depois de conferir que a unidade é mesmo
 * dela** — cookie é campo de texto como qualquer outro, e aceitar o que ele diz
 * seria entregar a clínica do vizinho a quem souber editá-lo.
 */
export const WORKSPACE_COOKIE = `${PREFIXO_DO_COOKIE}.workspace`

/**
 * A conta de cliente assumida pelo operador da plataforma.
 *
 * Também não autoriza nada: diz qual unidade, e `getPlatformAdmin()` é quem
 * deixa entrar. Ver `lib/plataforma/acesso.ts`.
 */
export const COOKIE_ASSUMIR = `${PREFIXO_DO_COOKIE}.assumir`
