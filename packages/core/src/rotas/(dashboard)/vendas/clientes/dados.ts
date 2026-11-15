import type { PaginaDeIndice } from '@venn/core/lib/indice'
// `import type` — e tem de continuar sendo. Este arquivo é importado pelo
// componente de cliente, e `contatos-consulta.ts` importa Prisma e o helper de
// sessão: um import de VALOR arrastaria código de servidor para o bundle do
// cliente. Tipo some na compilação; valor não.
import type { PacienteDaLista } from '@venn/core/lib/contatos-consulta'

export { LIMITE_PADRAO } from '@venn/core/lib/indice'
export type { PacienteDaLista }

/** O que o servidor entregou, pronto para a primeira pintura. */
export type DadosIniciais = PaginaDeIndice<PacienteDaLista>
