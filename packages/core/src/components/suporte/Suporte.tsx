import { WidgetDoDesk } from './WidgetDoDesk'

/**
 * O suporte do painel. Um componente, três apps.
 *
 * **Ausência de configuração é invisível, não é erro.** Um Worker sem
 * `VENN_DESK_APP` simplesmente não desenha o botão — e isso é o que permite
 * subir o widget num app de cada vez, ou desligá-lo num ambiente, sem tocar em
 * código. A rota de token responde 503 pelo mesmo motivo e na mesma chave.
 *
 * **As duas variáveis são por app e por ambiente**, e é por isso que vêm do
 * ambiente em vez de constante: o mesmo código roda no Worker do Odontobox, do
 * Conecta e do Stagent, cada um falando com a sua central.
 */
export function Suporte() {
    const app = process.env['VENN_DESK_APP']
    const base = process.env['VENN_DESK_BASE']

    if (!app || !base) return null

    return <WidgetDoDesk app={app} base={base} />
}
