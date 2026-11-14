/**
 * Registra a marca DESTE app no core. Importado primeiro, nos dois pontos de
 * entrada.
 *
 * Tem de ser um módulo à parte, e não uma chamada dentro do `layout.tsx`:
 * o import de um módulo roda antes do corpo do módulo que o importa, então
 * basta esta linha estar acima dos imports do core para a marca já estar
 * registrada quando qualquer código dele for avaliado. Uma chamada no corpo do
 * componente rodaria tarde — depois de os módulos do core já terem sido
 * carregados, e eles podem ler a marca no nível de módulo.
 *
 * Os dois pontos de entrada, e por que são dois:
 *   - `app/layout.tsx` — a raiz do App Router, que cobre toda página e todo
 *     route handler servido por requisição;
 *   - `cloudflare/entrada.ts` — o entrypoint do Worker, que cobre o que NÃO
 *     tem requisição: os dez consumidores de fila, os 17 crons, os três
 *     Durable Objects e o Workflow. Quatro dos arquivos do core que leem a
 *     marca rodam exatamente aí (os três de `lib/email` e o `broadcast`).
 *
 * `scripts/check-marca.mjs` é quem garante que esta linha não saia de lugar
 * nem desça na ordem dos imports.
 */
import { registrarBrand } from '@venn/core/marca'
import { BRAND } from '@/config/brand'

registrarBrand(BRAND)
