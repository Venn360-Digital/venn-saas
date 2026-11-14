'use client'

import { Input } from '@venn/ui/input'
import { Label } from '@venn/ui/label'
import { useMarca } from '../../marca-contexto'

/**
 * O endereço do workspace: `odontobox.venn360.com/<slug>`.
 *
 * Vem da marca, não de `NEXT_PUBLIC_APP_URL`. A variável não está gravada no
 * Worker de produção, então a tela caía no fallback escrito à mão
 * (`app.odontobox360.com.br` — domínio que nunca existiu); num preview ela
 * mostraria o host do preview, que também não é onde o workspace mora.
 */
/**
 * O host saiu do nível de módulo.
 *
 * Era `const HOST = BRAND.appHost`, avaliado no import. A marca agora vem do
 * contexto, que só existe durante a renderização — então o valor é lido dentro
 * do componente. O campo em si nasceu de um defeito que vale lembrar: a
 * sugestão de URL do workspace derivava de `NEXT_PUBLIC_APP_URL`, que não está
 * gravada no Worker, e a tela mostrava um domínio que nunca existiu.
 */

/**
 * O nome virando endereço: só letras e números, sem acento e sem separador.
 *
 * O hífen saiu por decisão do Andre — "o nome, sem caracteres, espaços ou
 * símbolos". `Clínica Sorriso` vira `clinicasorriso`, não `clinica-sorriso`.
 */
export function slugDoNome(nome: string): string {
    return nome
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]/g, '')
}

/**
 * O nome da empresa, e o endereço que sai dele.
 *
 * **Controlado pela página**, sem estado próprio — e é isso que fecha o defeito
 * do espelhamento. O passo guardava `name` e `slug` em dois `useState` e só
 * atualizava o segundo enquanto ele coincidisse com `generateSlug` do nome que
 * estava na **prop** do pai; a prop só mudava no Continuar, então na primeira
 * letra digitada o slug deixava de coincidir e congelava ali. Era por isso que
 * a URL repetia apenas a inicial.
 *
 * Com um estado só, o segundo não tem como divergir do primeiro: o endereço é
 * uma função do nome, calculada no render.
 */
export function Step1Workspace({
    nome,
    onNomeChange,
}: {
    nome: string
    onNomeChange: (nome: string) => void
}) {
    const marca = useMarca()
    const HOST = marca.appHost
    const slug = slugDoNome(nome)

    return (
        <div className="mx-auto w-full max-w-md space-y-4">
            <div className="space-y-2">
                <Label htmlFor="workspace-name">Nome do workspace</Label>
                <Input
                    id="workspace-name"
                    value={nome}
                    onChange={(e) => onNomeChange(e.target.value)}
                    placeholder="Sua Empresa"
                    autoFocus
                />
            </div>

            {/* Mostrado, não editável — a extensão é o nome, e o nome é o campo
                acima. Um `input` desabilitado prometeria um controle que não
                existe; isto é a frase do endereço se formando. */}
            <div className="space-y-2">
                <p className="text-sm font-medium text-foreground">Endereço do workspace</p>
                <p className="num flex min-h-9 items-center overflow-x-auto whitespace-nowrap rounded-md border border-border bg-muted/40 px-3 text-sm">
                    <span className="text-muted-foreground">{HOST}/</span>
                    <span className="font-semibold text-foreground">
                        {slug || (
                            <span className="font-normal text-muted-foreground/60">suaempresa</span>
                        )}
                    </span>
                </p>
                <p className="text-xs text-muted-foreground">
                    Montado a partir do nome, sem espaços nem símbolos. Não é editável.
                </p>
            </div>
        </div>
    )
}
