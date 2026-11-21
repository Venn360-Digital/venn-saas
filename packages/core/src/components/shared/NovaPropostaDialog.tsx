'use client'

import { useEffect, useState } from 'react'

import { Button } from '@venn/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@venn/ui/dialog'
import { Input } from '@venn/ui/input'
import { Label } from '@venn/ui/label'
import { ROTULO_DO_TIPO, TIPOS_DE_DOCUMENTO, type TipoDeDocumento } from '@venn/core/lib/propostas/estados'
import { PhoneInput } from './PhoneInput'
import { useVocab } from '../../hooks/useVocab'

/**
 * Criar um documento: escolher o negócio, o tipo e o título.
 *
 * ## Por que mora em `components/shared/`
 *
 * Nasceu dentro da tela de Propostas e mudou para cá em 21/11/2026, quando a
 * ficha do negócio passou a oferecer o mesmo gesto. Duas telas, um diálogo —
 * e com `dealId` fixo ele nem pergunta qual negócio, porque quem abre dali já
 * respondeu.
 *
 * ## Dois caminhos para o negócio, desde a homologação de 21/11/2026
 *
 * Buscar um que existe, ou **cadastrar um agora** — e a ficha nasce com ele. O
 * dono do produto apontou as três coisas na mesma frase: a busca não achava
 * nada, não havia como cadastrar, e *"o cliente deve nascer na criação do
 * negócio"*. A terceira é o desenho: negócio sem ficha não serve aqui, porque o
 * documento precisa do nome e o envio precisa do telefone ou do e-mail.
 *
 * O cadastro é **uma** requisição, não três. Ver `lib/propostas/negocio.ts`.
 *
 * ## O negócio é obrigatório, e isso é desenho
 *
 * Proposta solta não entra em nenhum relatório de conversão — não há de onde
 * medir o que ela virou. É a mesma restrição que o Ploomes impõe (`Quotes.DealId`
 * obrigatório), e por bom motivo. Então o diálogo não abre sem negócio: o
 * caminho normal, na verdade, é criar a proposta **de dentro** do negócio.
 */

interface NegocioParaEscolha {
    id: string
    title: string
    contato: string | null
}

export function NovaPropostaDialog({
    onClose,
    onCriada,
    dealId: dealFixo,
}: {
    onClose: () => void
    onCriada: (id: string) => void
    /** Quando aberto de dentro de um negócio, ele já vem escolhido. */
    dealId?: string
}) {
    const v = useVocab()
    const [negocios, setNegocios] = useState<NegocioParaEscolha[]>([])
    const [busca, setBusca] = useState('')
    const [dealId, setDealId] = useState(dealFixo ?? '')
    /** `escolher` busca um negócio que existe; `cadastrar` cria um agora. */
    const [modo, setModo] = useState<'escolher' | 'cadastrar'>('escolher')
    const [nomeDoCliente, setNomeDoCliente] = useState('')
    const [telefone, setTelefone] = useState('')
    const [email, setEmail] = useState('')
    const [tipo, setTipo] = useState<TipoDeDocumento>('proposta')
    const [titulo, setTitulo] = useState('')
    const [salvando, setSalvando] = useState(false)
    const [erro, setErro] = useState<string | null>(null)

    // Só os negócios ABERTOS: montar proposta para um negócio ganho ou perdido
    // é caso de exceção, e oferecê-los na lista faria o vendedor escolher o
    // errado com um clique.
    useEffect(() => {
        if (dealFixo || modo === 'cadastrar') return
        const t = setTimeout(async () => {
            const params = new URLSearchParams({ status: 'open', limit: '20' })
            if (busca) params.set('search', busca)
            const resposta = await fetch(`/api/deals?${params}`)
            if (!resposta.ok) return
            /**
             * `GET /api/deals` devolve o **array cru**, não `{ data }`.
             *
             * Era o defeito que a homologação pegou: eu lia `corpo.data`, que é
             * `undefined`, então a lista nascia vazia **sempre** — e parecia que
             * a busca não falava com a tabela de negócios. A rota documenta a
             * escolha em `api/deals/route.ts`: *"The response stays an array so
             * existing callers keep working"*, com o total num cabeçalho.
             *
             * O `Array.isArray` fica: se um dia a rota passar a envelopar, isto
             * para de achar em vez de quebrar — e o ramo de baixo cobre os dois.
             */
            const corpo = (await resposta.json()) as
                | Array<{ id: string; title: string; contact?: { name: string | null } | null }>
                | { data?: Array<{ id: string; title: string; contact?: { name: string | null } | null }> }
            const lista = Array.isArray(corpo) ? corpo : corpo.data ?? []
            setNegocios(
                lista.map((d) => ({
                    id: d.id,
                    title: d.title,
                    contato: d.contact?.name ?? null,
                }))
            )
        }, busca ? 300 : 0)
        return () => clearTimeout(t)
    }, [busca, dealFixo, modo])

    async function criar() {
        const cadastrando = !dealFixo && modo === 'cadastrar'

        if (cadastrando) {
            if (nomeDoCliente.trim().length === 0) {
                setErro('Escreva o nome.')
                return
            }
            // A mesma regra de `clienteAlcancavel`, no servidor: nome sozinho
            // monta o documento e não o entrega.
            if (telefone.trim().length === 0 && email.trim().length === 0) {
                setErro('Informe telefone ou e-mail — sem um dos dois não há como enviar o documento.')
                return
            }
        } else if (!dealId) {
            setErro('Escolha o negócio.')
            return
        }
        if (titulo.trim().length === 0) {
            setErro('Escreva um título.')
            return
        }

        setSalvando(true)
        setErro(null)
        try {
            const resposta = await fetch('/api/propostas', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(
                    cadastrando
                        ? {
                              negocioNovo: {
                                  cliente: {
                                      nome: nomeDoCliente.trim(),
                                      telefone: telefone.trim() || null,
                                      email: email.trim() || null,
                                  },
                                  // O título do negócio é o do documento quando
                                  // ninguém separou os dois: é o começo, e os dois
                                  // falam da mesma coisa.
                                  titulo: titulo.trim() || null,
                              },
                              kind: tipo,
                              title: titulo.trim(),
                          }
                        : { dealId, kind: tipo, title: titulo.trim() }
                ),
            })
            const corpo = (await resposta.json().catch(() => ({}))) as { id?: string; error?: string }
            if (!resposta.ok || !corpo.id) {
                setErro(corpo.error ?? 'Não foi possível criar o documento.')
                return
            }
            onCriada(corpo.id)
        } finally {
            setSalvando(false)
        }
    }

    return (
        <Dialog open onOpenChange={(aberto) => !aberto && onClose()}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>Novo documento</DialogTitle>
                </DialogHeader>

                <div className="space-y-4">
                    <div>
                        <Label className="mb-1.5 block">Tipo</Label>
                        <div className="flex gap-2">
                            {TIPOS_DE_DOCUMENTO.map((t) => (
                                <Button
                                    key={t}
                                    type="button"
                                    variant={tipo === t ? 'default' : 'outline'}
                                    size="sm"
                                    onClick={() => setTipo(t)}
                                >
                                    {ROTULO_DO_TIPO[t]}
                                </Button>
                            ))}
                        </div>
                    </div>

                    {!dealFixo && (
                        <div>
                            <div className="mb-1.5 flex items-center justify-between gap-3">
                                <Label htmlFor="busca-negocio">Negócio</Label>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setModo(modo === 'escolher' ? 'cadastrar' : 'escolher')
                                        setErro(null)
                                        // Trocar de modo limpa a escolha do outro:
                                        // mandar os dois é recusado pelo servidor,
                                        // e com razão.
                                        setDealId('')
                                    }}
                                    className="text-xs font-medium text-primary underline-offset-2 hover:underline"
                                >
                                    {modo === 'escolher' ? 'Cadastrar novo' : 'Buscar existente'}
                                </button>
                            </div>

                            {modo === 'cadastrar' ? (
                                <div className="space-y-3 rounded-lg border border-border/60 p-3">
                                    <div>
                                        <Label htmlFor="nome-do-cliente" className="mb-1.5 block">
                                            {v.Pessoa}
                                        </Label>
                                        <Input
                                            id="nome-do-cliente"
                                            value={nomeDoCliente}
                                            onChange={(e) => {
                                                setNomeDoCliente(e.target.value)
                                                // O nome serve de título enquanto
                                                // ninguém escreveu outro.
                                                if (titulo.trim().length === 0 || titulo === nomeDoCliente) {
                                                    setTitulo(e.target.value)
                                                }
                                            }}
                                            placeholder="Nome de quem vai receber o documento"
                                            maxLength={200}
                                            autoFocus
                                        />
                                    </div>
                                    <div className="grid gap-3 sm:grid-cols-2">
                                        <div>
                                            <Label htmlFor="telefone-do-cliente" className="mb-1.5 block">
                                                Telefone
                                            </Label>
                                            <PhoneInput
                                                id="telefone-do-cliente"
                                                value={telefone}
                                                onChange={setTelefone}
                                            />
                                        </div>
                                        <div>
                                            <Label htmlFor="email-do-cliente" className="mb-1.5 block">
                                                E-mail
                                            </Label>
                                            <Input
                                                id="email-do-cliente"
                                                type="email"
                                                value={email}
                                                onChange={(e) => setEmail(e.target.value)}
                                                placeholder="para@enviar.com"
                                                maxLength={200}
                                            />
                                        </div>
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                        Um dos dois basta — é por onde o documento vai. A ficha e o
                                        negócio nascem junto com o documento, na primeira etapa do funil.
                                    </p>
                                </div>
                            ) : (
                            <>
                            <Input
                                id="busca-negocio"
                                value={busca}
                                onChange={(e) => setBusca(e.target.value)}
                                placeholder="Buscar negócio aberto"
                            />
                            <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-border/60">
                                {negocios.length === 0 ? (
                                    <p className="px-3 py-4 text-sm text-muted-foreground">
                                        Nenhum negócio aberto encontrado.
                                    </p>
                                ) : (
                                    negocios.map((n) => (
                                        <button
                                            key={n.id}
                                            type="button"
                                            onClick={() => {
                                                setDealId(n.id)
                                                // O título do negócio é um bom
                                                // ponto de partida: o vendedor
                                                // corrige em vez de inventar.
                                                if (titulo.trim().length === 0) setTitulo(n.title)
                                            }}
                                            className={`block w-full px-3 py-2 text-left text-sm transition-colors hover:bg-accent ${
                                                dealId === n.id ? 'bg-accent' : ''
                                            }`}
                                        >
                                            <span className="font-medium text-foreground">{n.title}</span>
                                            {n.contato && (
                                                <span className="ml-2 text-muted-foreground">{n.contato}</span>
                                            )}
                                        </button>
                                    ))
                                )}
                            </div>
                            </>
                            )}
                        </div>
                    )}

                    <div>
                        <Label htmlFor="titulo-documento" className="mb-1.5 block">
                            Título
                        </Label>
                        <Input
                            id="titulo-documento"
                            value={titulo}
                            onChange={(e) => setTitulo(e.target.value)}
                            placeholder="O que este documento cobre"
                            maxLength={200}
                        />
                    </div>

                    {erro && <p className="text-sm text-destructive">{erro}</p>}
                </div>

                <DialogFooter>
                    <Button type="button" variant="outline" onClick={onClose} disabled={salvando}>
                        Cancelar
                    </Button>
                    <Button type="button" onClick={criar} disabled={salvando}>
                        {salvando ? 'Criando…' : 'Criar'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
