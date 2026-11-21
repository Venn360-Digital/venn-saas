'use client'

import { useState } from 'react'

import { Button } from '@venn/ui/button'
import { Checkbox } from '@venn/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@venn/ui/dialog'
import { Input } from '@venn/ui/input'
import { Label } from '@venn/ui/label'
// De `validade.ts`, o módulo neutro — não de `compartilhar.ts`, que lê a marca
// e não atravessa para o cliente. Ver o cabeçalho de `validade.ts`.
import { VALIDADE_MAXIMA_EM_DIAS, VALIDADE_PADRAO_EM_DIAS } from '@venn/core/lib/propostas/validade'

/**
 * Gerar o link e, se quiser, mandar ao cliente.
 *
 * ## O link é o entregável; o envio é conveniência
 *
 * Mesmo que os dois canais falhem, o link existe e aparece para ser copiado. Por
 * isso o diálogo fecha com sucesso e mostra o endereço: o vendedor manda por
 * onde quiser. Falhar o envio inteiro porque o e-mail caiu jogaria fora um token
 * válido.
 *
 * ## Por que o WhatsApp pode estar indisponível
 *
 * Disparo frio está bloqueado por construção neste projeto. O link só sai pelo
 * zap **dentro da janela de 24 h** de uma conversa ativa; fora dela o provedor
 * recusa. O servidor devolve o motivo e esta tela o mostra — nunca um botão que
 * falha calado. Ver `lib/propostas/enviar.ts`.
 */

interface Envio {
    canal: 'email' | 'whatsapp'
    ok: boolean
    motivo?: string
}

export function EnviarDialog({
    propostaId,
    versao,
    temEmail,
    temTelefone,
    onClose,
    onEnviada,
}: {
    propostaId: string
    versao: number
    temEmail: boolean
    temTelefone: boolean
    onClose: () => void
    onEnviada: (url: string) => void
}) {
    const [dias, setDias] = useState(String(VALIDADE_PADRAO_EM_DIAS))
    const [porEmail, setPorEmail] = useState(temEmail)
    const [porWhatsApp, setPorWhatsApp] = useState(temTelefone)
    const [enviando, setEnviando] = useState(false)
    const [erro, setErro] = useState<string | null>(null)
    const [envios, setEnvios] = useState<Envio[] | null>(null)
    const [url, setUrl] = useState<string | null>(null)

    async function enviar() {
        setEnviando(true)
        setErro(null)
        try {
            const resposta = await fetch(`/api/propostas/${propostaId}/revisoes/${versao}/enviar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    validadeEmDias: Number(dias) || VALIDADE_PADRAO_EM_DIAS,
                    porEmail,
                    porWhatsApp,
                }),
            })
            const corpo = (await resposta.json().catch(() => ({}))) as {
                url?: string
                envios?: Envio[]
                error?: string
            }
            if (!resposta.ok || !corpo.url) {
                setErro(corpo.error ?? 'Não foi possível gerar o link.')
                return
            }

            setUrl(corpo.url)
            setEnvios(corpo.envios ?? [])

            /**
             * Se tudo deu certo, o diálogo se fecha e a tela mostra o link.
             *
             * Se algum canal falhou, ele **fica aberto** com o motivo: o
             * vendedor precisa saber que o e-mail não saiu antes de considerar
             * a proposta entregue.
             */
            const algumFalhou = (corpo.envios ?? []).some((e) => !e.ok)
            if (!algumFalhou) onEnviada(corpo.url)
        } finally {
            setEnviando(false)
        }
    }

    return (
        <Dialog open onOpenChange={(aberto) => !aberto && onClose()}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Enviar documento</DialogTitle>
                </DialogHeader>

                {url ? (
                    <div className="space-y-4">
                        <div>
                            <Label className="mb-1.5 block">O link</Label>
                            <code className="block break-all rounded-lg bg-muted px-3 py-2 text-xs">
                                {url}
                            </code>
                        </div>
                        <ul className="space-y-2 text-sm">
                            {(envios ?? []).map((e) => (
                                <li
                                    key={e.canal}
                                    className={e.ok ? 'text-foreground' : 'text-muted-foreground'}
                                >
                                    <span className="font-medium">
                                        {e.canal === 'email' ? 'E-mail' : 'WhatsApp'}:
                                    </span>{' '}
                                    {e.ok ? 'enviado' : (e.motivo ?? 'não enviado')}
                                </li>
                            ))}
                        </ul>
                        <p className="text-xs text-muted-foreground">
                            O link já vale. Copie e mande por onde preferir.
                        </p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div>
                            <Label htmlFor="dias" className="mb-1.5 block">
                                O link vale por quantos dias
                            </Label>
                            <Input
                                id="dias"
                                type="number"
                                min="1"
                                max={VALIDADE_MAXIMA_EM_DIAS}
                                value={dias}
                                onChange={(e) => setDias(e.target.value)}
                            />
                            {/*
                             * O teto está aqui porque é o que impede a decisão
                             * de `expiresAt` obrigatório de ser contornada pela
                             * interface — ver `lib/propostas/compartilhar.ts`.
                             */}
                            <p className="mt-1 text-xs text-muted-foreground">
                                No máximo {VALIDADE_MAXIMA_EM_DIAS}. Depois disso o link para de abrir.
                            </p>
                        </div>

                        <fieldset className="space-y-2">
                            <legend className="mb-1 text-sm font-medium text-foreground">
                                Mandar agora por
                            </legend>

                            <label className="flex items-center gap-2 text-sm">
                                <Checkbox
                                    checked={porEmail}
                                    disabled={!temEmail}
                                    onCheckedChange={(v) => setPorEmail(v === true)}
                                />
                                <span className={temEmail ? '' : 'text-muted-foreground'}>
                                    E-mail
                                    {!temEmail && ' — este contato não tem e-mail cadastrado'}
                                </span>
                            </label>

                            <label className="flex items-center gap-2 text-sm">
                                <Checkbox
                                    checked={porWhatsApp}
                                    disabled={!temTelefone}
                                    onCheckedChange={(v) => setPorWhatsApp(v === true)}
                                />
                                <span className={temTelefone ? '' : 'text-muted-foreground'}>
                                    WhatsApp
                                    {!temTelefone && ' — este contato não tem telefone cadastrado'}
                                </span>
                            </label>

                            {temTelefone && (
                                <p className="text-xs text-muted-foreground">
                                    Pelo WhatsApp só sai se houver conversa ativa nas últimas 24 horas —
                                    é a janela que o provedor exige.
                                </p>
                            )}
                        </fieldset>

                        {erro && <p className="text-sm text-destructive">{erro}</p>}
                    </div>
                )}

                <DialogFooter>
                    {url ? (
                        <Button type="button" onClick={() => onEnviada(url)}>
                            Pronto
                        </Button>
                    ) : (
                        <>
                            <Button type="button" variant="outline" onClick={onClose} disabled={enviando}>
                                Cancelar
                            </Button>
                            <Button type="button" onClick={enviar} disabled={enviando}>
                                {enviando ? 'Gerando…' : 'Gerar link'}
                            </Button>
                        </>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
