'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Loader2 } from 'lucide-react'

import { Input } from '@venn/ui/input'
import { Textarea } from '@venn/ui/textarea'
import { Checkbox } from '@venn/ui/checkbox'
import { Label } from '@venn/ui/label'
import { cn } from '@venn/ui/utils'
import { BRAND_HEX } from '../../../lib/palette'
import {
    validarEnvio,
    type Campo,
    type Configuracao,
    type Resposta,
} from '../../../lib/formularios/schema'

/**
 * O formulário como o visitante o vê — e como o editor o pré-visualiza.
 *
 * Um componente para os dois usos, de propósito: a prévia que divergisse do
 * que o site mostra seria a pior forma de prévia. Em `previa`, o envio é
 * desligado e o botão não faz nada; o resto é idêntico.
 *
 * ## A validação é a do módulo puro
 *
 * `validarEnvio` roda aqui antes do envio e de novo no servidor. Aqui ela
 * existe para o erro aparecer **embaixo do campo**, na hora, sem ida à rede; lá
 * ela existe porque o que chega do navegador não é confiável.
 *
 * ## Embutido num iframe
 *
 * O site da organização põe esta página num `iframe`. A altura certa é a do
 * conteúdo — e só a página sabe qual é —, então ela avisa o pai por
 * `postMessage` a cada mudança de tamanho; o trecho que a tela de Incorporar
 * entrega escuta e ajusta. Sem isso o site teria de chutar uma altura, e
 * chutar errado corta o botão ou deixa um buraco branco.
 */

export interface FormularioParaATela {
    chave: string
    nome: string
    organizacao: string
    campos: Campo[]
    config: Configuracao
}

const RAIO = { reto: 'rounded-none', suave: 'rounded-lg', redondo: 'rounded-2xl' } as const

/** Luminância relativa do WCAG: decide se o texto do botão é claro ou escuro. */
function textoSobre(hex: string): string {
    const n = parseInt(hex.slice(1), 16)
    const canal = (c: number) => {
        const s = c / 255
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
    }
    const l = 0.2126 * canal((n >> 16) & 255) + 0.7152 * canal((n >> 8) & 255) + 0.0722 * canal(n & 255)
    return l > 0.55 ? BRAND_HEX.navy : BRAND_HEX.white
}

export function FormularioPublico({
    formulario,
    marca,
    embed = false,
    previa = false,
}: {
    formulario: FormularioParaATela
    /** O nome do produto, para o rodapé. Vem do servidor: a página pública não tem provedor de marca. */
    marca: string
    embed?: boolean
    previa?: boolean
}) {
    const { campos, config } = formulario
    const [valores, setValores] = useState<Record<string, unknown>>({})
    const [erros, setErros] = useState<Record<string, string>>({})
    const [enviando, setEnviando] = useState(false)
    const [enviado, setEnviado] = useState<string | null>(null)
    const [erroGeral, setErroGeral] = useState<string | null>(null)
    const raiz = useRef<HTMLDivElement>(null)

    // A altura para o iframe, sempre que o conteúdo mudar.
    useEffect(() => {
        if (!embed || typeof window === 'undefined' || !raiz.current) return
        const avisar = () => {
            window.parent?.postMessage(
                { tipo: 'venn-formulario:altura', chave: formulario.chave, altura: document.documentElement.scrollHeight },
                '*'
            )
        }
        avisar()
        const obs = new ResizeObserver(avisar)
        obs.observe(raiz.current)
        return () => obs.disconnect()
    }, [embed, formulario.chave, enviado, erros])

    const set = (id: string, v: unknown) => {
        setValores((atual) => ({ ...atual, [id]: v }))
        if (erros[id]) setErros((e) => ({ ...e, [id]: '' }))
    }

    const enviar = async (e: React.FormEvent) => {
        e.preventDefault()
        if (previa || enviando) return
        setErroGeral(null)
        const validado = validarEnvio(campos, valores)
        if (!validado.ok) {
            setErros(validado.erros)
            return
        }
        setEnviando(true)
        try {
            const res = await fetch(`/api/formularios/${encodeURIComponent(formulario.chave)}/enviar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    dados: validado.valores,
                    _hp: (valores._hp as string | undefined) ?? '',
                    _pagina: typeof document !== 'undefined' ? document.referrer || window.location.href : undefined,
                }),
            })
            const corpo = (await res.json().catch(() => ({}))) as {
                ok?: boolean
                erros?: Record<string, string>
                error?: string
                mensagem?: string
                redirecionarPara?: string | null
            }
            if (!res.ok) {
                if (corpo.erros) setErros(corpo.erros)
                else setErroGeral(corpo.error || 'Não foi possível enviar. Tente de novo.')
                return
            }
            if (corpo.redirecionarPara) {
                const destino = corpo.redirecionarPara
                // No iframe, quem navega é a página de cima.
                if (embed && window.top) window.top.location.href = destino
                else window.location.href = destino
                return
            }
            setEnviado(corpo.mensagem || config.mensagemDeSucesso)
        } catch {
            setErroGeral('Não foi possível enviar. Verifique a conexão e tente de novo.')
        } finally {
            setEnviando(false)
        }
    }

    const raio = RAIO[config.aparencia.raio]
    const cor = config.aparencia.cor
    const escuro = config.aparencia.tema === 'escuro'

    return (
        <div
            ref={raiz}
            className={cn(
                escuro && 'dark',
                embed || previa ? '' : 'min-h-dvh',
                'bg-background text-foreground'
            )}
        >
            <main className={cn('mx-auto w-full max-w-xl', embed || previa ? 'p-2' : 'px-4 py-10')}>
                <div className={cn('border border-border bg-card p-6 shadow-sm sm:p-8', raio)}>
                    {enviado ? (
                        <div className="py-6 text-center">
                            <span
                                className="mx-auto flex size-12 items-center justify-center rounded-full"
                                style={{ backgroundColor: cor, color: textoSobre(cor) }}
                            >
                                <Check className="size-6" />
                            </span>
                            <p className="mt-4 whitespace-pre-wrap text-base leading-relaxed">{enviado}</p>
                        </div>
                    ) : (
                        <form onSubmit={enviar} noValidate className="space-y-5">
                            <div className="space-y-1">
                                <h1 className="text-xl font-semibold tracking-tight">{config.titulo || formulario.nome}</h1>
                                {config.descricao ? (
                                    <p className="whitespace-pre-wrap text-sm text-muted-foreground">{config.descricao}</p>
                                ) : null}
                            </div>

                            <div className="grid gap-4 sm:grid-cols-2">
                                {campos.map((campo) => (
                                    <div
                                        key={campo.id}
                                        className={cn('space-y-1.5', campo.largura === 'metade' ? 'sm:col-span-1' : 'sm:col-span-2')}
                                    >
                                        <CampoDoFormulario
                                            campo={campo}
                                            valor={valores[campo.id]}
                                            erro={erros[campo.id]}
                                            raio={raio}
                                            cor={cor}
                                            onChange={(v) => set(campo.id, v)}
                                        />
                                        {campo.ajuda && !erros[campo.id] ? (
                                            <p className="text-xs text-muted-foreground">{campo.ajuda}</p>
                                        ) : null}
                                        {erros[campo.id] ? (
                                            <p className="text-xs text-destructive" role="alert">{erros[campo.id]}</p>
                                        ) : null}
                                    </div>
                                ))}
                            </div>

                            {/* O campo-armadilha: fora da tela e fora do Tab. Robô preenche; gente não vê. */}
                            <div aria-hidden="true" className="absolute -left-[9999px] top-auto h-px w-px overflow-hidden">
                                <label>
                                    Deixe em branco
                                    <input
                                        type="text"
                                        name="_hp"
                                        tabIndex={-1}
                                        autoComplete="off"
                                        value={(valores._hp as string | undefined) ?? ''}
                                        onChange={(e) => set('_hp', e.target.value)}
                                    />
                                </label>
                            </div>

                            {erroGeral ? (
                                <p className="text-sm text-destructive" role="alert">{erroGeral}</p>
                            ) : null}

                            <button
                                type="submit"
                                disabled={enviando || previa}
                                className={cn(
                                    'flex h-11 w-full items-center justify-center gap-2 px-4 text-sm font-semibold transition-opacity disabled:opacity-70',
                                    raio
                                )}
                                style={{ backgroundColor: cor, color: textoSobre(cor) }}
                            >
                                {enviando ? <Loader2 className="size-4 animate-spin" /> : null}
                                {config.textoDoBotao}
                            </button>

                            {config.consentimento ? (
                                <p className="text-center text-xs leading-relaxed text-muted-foreground">{config.consentimento}</p>
                            ) : null}
                        </form>
                    )}
                </div>
                <p className="mt-4 text-center text-[11px] text-muted-foreground/70">
                    {formulario.organizacao} · formulário por {marca}
                </p>
            </main>
        </div>
    )
}

function CampoDoFormulario({
    campo,
    valor,
    erro,
    raio,
    cor,
    onChange,
}: {
    campo: Campo
    valor: unknown
    erro?: string
    raio: string
    cor: string
    onChange: (v: Resposta | undefined) => void
}) {
    const id = `f-${campo.id}`
    const rotulo = (
        <Label htmlFor={id} className="text-sm">
            {campo.rotulo}
            {campo.obrigatorio ? <span className="ml-0.5 text-destructive">*</span> : null}
        </Label>
    )
    const invalido = erro ? true : undefined

    switch (campo.tipo) {
        case 'paragrafo':
            return (
                <>
                    {rotulo}
                    <Textarea
                        id={id}
                        rows={4}
                        placeholder={campo.placeholder}
                        value={(valor as string | undefined) ?? ''}
                        aria-invalid={invalido}
                        onChange={(e) => onChange(e.target.value)}
                        className={raio}
                    />
                </>
            )
        case 'selecao':
            return (
                <>
                    {rotulo}
                    <select
                        id={id}
                        value={(valor as string | undefined) ?? ''}
                        aria-invalid={invalido}
                        onChange={(e) => onChange(e.target.value)}
                        className={cn(
                            'h-9 w-full border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive',
                            raio
                        )}
                    >
                        <option value="">{campo.placeholder || 'Escolha…'}</option>
                        {(campo.opcoes ?? []).map((o) => (
                            <option key={o} value={o}>
                                {o}
                            </option>
                        ))}
                    </select>
                </>
            )
        case 'multipla': {
            const marcadas = Array.isArray(valor) ? (valor as string[]) : []
            return (
                <fieldset>
                    <legend className="text-sm font-medium">
                        {campo.rotulo}
                        {campo.obrigatorio ? <span className="ml-0.5 text-destructive">*</span> : null}
                    </legend>
                    <div className="mt-2 space-y-2">
                        {(campo.opcoes ?? []).map((o) => {
                            const cid = `${id}-${o}`
                            return (
                                <div key={o} className="flex items-center gap-2">
                                    <Checkbox
                                        id={cid}
                                        checked={marcadas.includes(o)}
                                        onCheckedChange={(c) =>
                                            onChange(c ? [...marcadas, o] : marcadas.filter((m) => m !== o))
                                        }
                                    />
                                    <Label htmlFor={cid} className="text-sm font-normal">{o}</Label>
                                </div>
                            )
                        })}
                    </div>
                </fieldset>
            )
        }
        case 'caixa':
            return (
                <div className="flex items-start gap-2 pt-1">
                    <Checkbox
                        id={id}
                        checked={valor === true}
                        aria-invalid={invalido}
                        onCheckedChange={(c) => onChange(c === true)}
                        className="mt-0.5"
                    />
                    <Label htmlFor={id} className="text-sm font-normal leading-snug">
                        {campo.rotulo}
                        {campo.obrigatorio ? <span className="ml-0.5 text-destructive">*</span> : null}
                    </Label>
                </div>
            )
        default: {
            const tipo =
                campo.tipo === 'email' ? 'email'
                : campo.tipo === 'telefone' ? 'tel'
                : campo.tipo === 'numero' ? 'number'
                : campo.tipo === 'data' ? 'date'
                : 'text'
            return (
                <>
                    {rotulo}
                    <Input
                        id={id}
                        type={tipo}
                        inputMode={campo.tipo === 'telefone' ? 'tel' : campo.tipo === 'numero' ? 'decimal' : undefined}
                        autoComplete={campo.mapeia === 'nome' ? 'name' : campo.mapeia === 'email' ? 'email' : campo.mapeia === 'telefone' ? 'tel' : undefined}
                        placeholder={campo.placeholder}
                        value={(valor as string | undefined) ?? ''}
                        aria-invalid={invalido}
                        onChange={(e) => onChange(e.target.value)}
                        className={cn(raio, 'focus-visible:ring-0')}
                        style={{ ['--tw-ring-color' as string]: cor }}
                    />
                </>
            )
        }
    }
}
