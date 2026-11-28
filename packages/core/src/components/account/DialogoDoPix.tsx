'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Copy, Loader2, QrCode } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@venn/ui/button'
import { cn } from '@venn/ui/utils'
import { RecordDialog } from '../shared/RecordDialog'
import { formatPrice } from '../../lib/plans'
import { BRAND_HEX } from '../../lib/palette'

/**
 * O Pix dentro do app: o QR na nossa tela, e a espera honesta.
 *
 * Fase 2 do projeto de cobrança embutida, 27/11/2026. Até aqui, comprar
 * adicional abria uma janela no domínio do Asaas; agora o cliente não sai
 * daqui.
 *
 * ## Por que o Pix pôde vir para dentro e o cartão não
 *
 * QR Code e copia-e-cola **não têm dado de cartão**. Exibi-los aqui não move
 * escopo de PCI nenhum, enquanto um formulário de cartão nosso levaria o número
 * pelo nosso servidor e tiraria a aplicação do SAQ A. Ver `PRODUCT.md` §13 — a
 * fronteira entre esta tela existir e a de cartão não existir é essa, e não
 * preferência.
 *
 * ## O que esta tela NÃO faz
 *
 * **Não pergunta ao Asaas.** A sondagem bate em `/api/account/cobranca/[id]`,
 * que lê `asaas_checkouts` — e quem escreve lá é o webhook. Duas fontes para
 * "foi pago" dariam duas respostas no mesmo instante, e a pior delas é a tela
 * dizendo "pago" antes de o adicional estar na conta. A chave do gateway também
 * não existe fora do Worker, então o navegador não teria como perguntar.
 *
 * **Não fecha em "pago".** Fecha em **"entregue"**, que é outro instante: entre
 * o webhook gravar `paidAt` e terminar `aplicarAdicionais` há uma janela em que
 * o dinheiro entrou e o crédito ainda não. Fechar ali mandaria a pessoa para uma
 * conta que não tem o que ela acabou de comprar.
 */

export interface DadosDoPix {
    tentativaId: string
    paymentId: string
    /** O valor cobrado, vindo do servidor — a tela não recalcula dinheiro. */
    valorCentavos: number
    /** Base64 puro, sem o prefixo `data:` — ele é acrescentado aqui. */
    imagemBase64: string
    copiaECola: string
    expiraEm: string | null
    invoiceUrl: string | null
}

/** De três em três segundos: Pix confirma em segundos, não em minutos. */
const INTERVALO_MS = 3_000

/**
 * Dez minutos de sondagem, e depois ela para sozinha.
 *
 * Não é prazo de pagamento — o QR vale muito mais que isso. É o prazo em que
 * **vale a pena** manter uma aba perguntando: passado ele, quem pagou já viu a
 * confirmação, e quem não pagou fechou a tela. Sondar para sempre deixaria uma
 * requisição a cada três segundos em cada aba esquecida do sistema.
 */
const TETO_DE_SONDAGEM_MS = 10 * 60_000

type Estado = 'esperando' | 'pago' | 'entregue' | 'parou'

export function DialogoDoPix({
    pix,
    valorCentavos,
    aberto,
    onOpenChange,
    onEntregue,
}: {
    pix: DadosDoPix | null
    valorCentavos: number
    aberto: boolean
    onOpenChange: (aberto: boolean) => void
    /** Chamado uma vez, quando a entrega é confirmada. */
    onEntregue: () => void
}) {
    const [estado, setEstado] = useState<Estado>('esperando')
    const [copiado, setCopiado] = useState(false)
    /** Para o `onEntregue` não disparar duas vezes com o intervalo em curso. */
    const avisou = useRef(false)

    const tentativaId = pix?.tentativaId ?? null

    useEffect(() => {
        if (!aberto) return
        setEstado('esperando')
        setCopiado(false)
        avisou.current = false
    }, [aberto, tentativaId])

    useEffect(() => {
        if (!aberto || !tentativaId) return
        if (estado === 'entregue' || estado === 'parou') return

        const comecou = Date.now()
        let vivo = true

        const perguntar = async () => {
            try {
                const res = await fetch(`/api/account/cobranca/${tentativaId}`)
                if (!vivo || !res.ok) return
                const dados = (await res.json()) as { pago?: boolean; entregue?: boolean }

                if (dados.entregue) {
                    setEstado('entregue')
                    if (!avisou.current) {
                        avisou.current = true
                        onEntregue()
                    }
                    return
                }
                if (dados.pago) setEstado('pago')
            } catch {
                /**
                 * Falha de rede não muda o estado.
                 *
                 * A próxima passada tenta de novo, e mostrar "erro" aqui faria
                 * uma oscilação de Wi-Fi parecer pagamento recusado — numa tela
                 * em que a pessoa acabou de transferir dinheiro.
                 */
            }
        }

        void perguntar()
        const timer = setInterval(() => {
            if (Date.now() - comecou > TETO_DE_SONDAGEM_MS) {
                setEstado((atual) => (atual === 'entregue' ? atual : 'parou'))
                return
            }
            void perguntar()
        }, INTERVALO_MS)

        return () => {
            vivo = false
            clearInterval(timer)
        }
    }, [aberto, tentativaId, estado, onEntregue])

    const copiar = useCallback(async () => {
        if (!pix?.copiaECola) return
        try {
            await navigator.clipboard.writeText(pix.copiaECola)
            setCopiado(true)
            toast.success('Código copiado. Cole no app do seu banco.')
            setTimeout(() => setCopiado(false), 2500)
        } catch {
            /**
             * `clipboard` falha sem HTTPS e em alguns navegadores embutidos. O
             * código fica visível no campo acima justamente para este caso —
             * dá para selecionar à mão.
             */
            toast.error('Não consegui copiar. Selecione o código e copie à mão.')
        }
    }, [pix?.copiaECola])

    return (
        <RecordDialog
            open={aberto}
            onOpenChange={onOpenChange}
            title="Pagar com Pix"
            description={
                estado === 'entregue'
                    ? 'Pagamento confirmado e adicional liberado.'
                    : 'Leia o QR Code no app do seu banco, ou copie o código.'
            }
        >
            <div className="col-span-2 flex flex-col items-center gap-4 py-2">
                {estado === 'entregue' ? (
                    <Confirmado valorCentavos={valorCentavos} />
                ) : (
                    <>
                        <p className="num text-3xl font-bold leading-none tracking-tight">
                            {formatPrice(valorCentavos / 100)}
                        </p>

                        {/* O QR em 200px: menor que isso a câmera de celular
                            erra a leitura em tela com brilho baixo, e maior
                            empurra o botão de copiar para fora da dobra num
                            notebook de 13".

                            O FUNDO BRANCO VEM DA PALETA, e é funcional, não
                            estético. QR Code se lê por contraste, e um token de
                            tema (`bg-card`, `bg-background`) viraria escuro no
                            modo noturno — módulo preto sobre fundo escuro é QR
                            que a câmera não acha. Não existe token "sempre
                            claro" neste projeto, então o valor vem de
                            `BRAND_HEX`, que é o único lugar onde `lint:colors`
                            permite cor literal. A classe utilitária equivalente
                            reprova o portão, e com razão: nos outros 1.375
                            arquivos ela seria tema esquecido, não decisão. */}
                        {pix?.imagemBase64 ? (
                            <img
                                src={`data:image/png;base64,${pix.imagemBase64}`}
                                alt="QR Code do Pix"
                                width={200}
                                height={200}
                                style={{ backgroundColor: BRAND_HEX.white }}
                                className="size-[200px] rounded-lg border border-border p-2"
                            />
                        ) : (
                            /* Sem imagem o copia-e-cola ainda resolve, e é por
                               isso que a falta do QR não é erro de tela: a
                               segunda chamada ao Asaas pode ter falhado sozinha
                               e a cobrança continua pagável. */
                            <div className="flex size-[200px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border text-center text-xs text-muted-foreground">
                                <QrCode className="size-6" aria-hidden="true" />
                                <span className="px-4">
                                    A imagem não veio. Use o código abaixo.
                                </span>
                            </div>
                        )}

                        {pix?.copiaECola ? (
                            <div className="w-full">
                                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                    Pix copia e cola
                                </p>
                                <div className="flex gap-2">
                                    {/* `readOnly` e não `disabled`: desabilitado
                                        não deixa selecionar, e selecionar à mão
                                        é o resgate de quando a área de
                                        transferência falha. */}
                                    <input
                                        readOnly
                                        value={pix.copiaECola}
                                        onFocus={(e) => e.currentTarget.select()}
                                        className="min-w-0 flex-1 rounded-lg border border-border bg-muted px-3 py-2 font-mono text-[11px]"
                                        aria-label="Código Pix copia e cola"
                                    />
                                    <Button
                                        type="button"
                                        variant="outline"
                                        onClick={() => void copiar()}
                                        className="shrink-0"
                                    >
                                        {copiado ? (
                                            <Check className="size-4" />
                                        ) : (
                                            <Copy className="size-4" />
                                        )}
                                        {copiado ? 'Copiado' : 'Copiar'}
                                    </Button>
                                </div>
                            </div>
                        ) : null}

                        <Espera estado={estado} expiraEm={pix?.expiraEm ?? null} />

                        {/* A fatura do Asaas fica como saída, não como caminho
                            principal: ela é outro domínio, e sair do app é o que
                            esta tela existe para evitar. Aparece porque, se o QR
                            não veio e o copia-e-cola também não, ela é a única
                            forma de pagar. */}
                        {pix?.invoiceUrl && !pix.copiaECola ? (
                            <a
                                href={pix.invoiceUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-muted-foreground underline"
                            >
                                Abrir a fatura no Asaas
                            </a>
                        ) : null}
                    </>
                )}
            </div>
        </RecordDialog>
    )
}

/**
 * A linha de estado, e ela nunca mente sobre o que já aconteceu.
 *
 * "Pago, liberando" é um estado real e curto: o webhook gravou que o dinheiro
 * entrou e ainda está aplicando o adicional. Dizer "liberado" ali seria
 * anunciar o que não terminou.
 */
function Espera({ estado, expiraEm }: { estado: Estado; expiraEm: string | null }) {
    if (estado === 'parou') {
        return (
            <p className="text-center text-xs text-muted-foreground">
                Paramos de verificar por aqui. Se você já pagou, o adicional entra sozinho —
                feche e reabra esta tela para conferir.
            </p>
        )
    }

    if (estado === 'pago') {
        return (
            <p className="flex items-center gap-2 text-xs font-medium text-success-subtle-foreground">
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                Pagamento recebido — liberando o adicional.
            </p>
        )
    }

    const quando = expiraEm
        ? new Date(expiraEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
        : null

    return (
        <div className="text-center">
            <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                Esperando o pagamento. Esta tela se atualiza sozinha.
            </p>
            {quando ? (
                <p className="mt-1 text-[11px] text-muted-foreground">
                    O código vale até {quando}.
                </p>
            ) : null}
        </div>
    )
}

function Confirmado({ valorCentavos }: { valorCentavos: number }) {
    return (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
            <span
                className={cn(
                    'flex size-14 items-center justify-center rounded-full',
                    'bg-success-subtle text-success-subtle-foreground'
                )}
            >
                <Check className="size-7" aria-hidden="true" />
            </span>
            <div>
                <p className="font-semibold">Pagamento confirmado</p>
                <p className="num mt-0.5 text-sm text-muted-foreground">
                    {formatPrice(valorCentavos / 100)} — o adicional já está na conta.
                </p>
            </div>
        </div>
    )
}
