/**
 * `@venn/desk-widget` — a superfície pública do pacote.
 *
 * Instalar num app são três passos (seção 7): a dependência, a rota de token no
 * backend, e o provider no layout autenticado. Nenhuma tabela nova no app.
 *
 *   import { VennDeskProvider, VennDeskLauncher } from '@venn/desk-widget'
 *   import '@venn/desk-widget/estilo.css'
 *
 *   <VennDeskProvider app="odontobox" modulos={['Agenda', 'Pacientes']}>
 *     {children}
 *     <VennDeskLauncher />
 *   </VennDeskProvider>
 */
export { VennDeskProvider, useVennDesk } from './VennDeskProvider'
export { VennDeskLauncher } from './VennDeskLauncher'
export { capturarContexto } from './lib/contexto'
export { SemSessao } from './lib/api'
export type { Contadores, ChamadoResumo, Eu } from './lib/api'
export type { Idioma } from './lib/i18n'
