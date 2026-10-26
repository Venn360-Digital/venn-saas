import { membroOuLogin } from '@/lib/indice-servidor'
import { consultarPacientes } from '@/lib/pacientes-consulta'

import { PacientesClient } from './PacientesClient'

/**
 * Pacientes — a primeira página vem do servidor, como nos demais índices.
 *
 * A diferença desta tela: a consulta **não** é replicada aqui. Ela tem recorte
 * por papel (`contactScope`), busca por termos normalizados, filtro de etiqueta
 * que alcança as da conversa, origem, intervalo de data, estado de negócio,
 * ordenação variável e fusão de etiquetas com deduplicação. Duas cópias disso
 * divergem na primeira manutenção — e divergir significa a tela abrir com uma
 * lista e a releitura trocar por outra. Então a rota e esta casca chamam a
 * **mesma** `consultarPacientes`.
 *
 * Sem argumentos, ela serve `FILTROS_PADRAO` — que é exatamente o recorte que o
 * cliente descreve na primeira renderização.
 */
export default async function PacientesPage() {
    const membro = await membroOuLogin()
    const inicial = await consultarPacientes(membro)

    return <PacientesClient inicial={inicial} />
}
