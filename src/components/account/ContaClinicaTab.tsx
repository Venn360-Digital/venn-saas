'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Loader2, Plus, Save, ShoppingCart, Upload } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { BandLayout, SettingsBand } from '@/components/shared/TabsFrame'
import { TermsCard } from '@/components/account/TermsCard'
import { FormField } from '@/components/shared/FormField'
import { MaskedInput } from '@/components/shared/MaskedInput'
import { PhoneInput } from '@/components/shared/PhoneInput'
import { RecordDialog } from '@/components/shared/RecordDialog'
import { WORKSPACE_UPDATED } from '@/hooks/useUnidades'
import { MASKS, onlyDigits } from '@/lib/masks'
import { buscarCep } from '@/lib/cep'
import { formatPhone, phoneIssue } from '@/lib/phone'
import { UNIDADE_ADICIONAL, formatPrice } from '@/lib/plans'
import { cn } from '@/lib/utils'

/**
 * Conta da Clínica — a conta e as clínicas dela, numa guia.
 *
 * Eram duas guias ("Clínica" e "Unidades") e o Andre juntou em 2026-10-18 com
 * um argumento que fecha: a conta **é** a clínica, e as unidades pertencem a
 * ela. Os campos não mudaram, mudaram de dono — a logomarca e o CNPJ de
 * cobrança subiram para a conta, e nome, endereço e telefone ficaram em cada
 * unidade.
 *
 * O CNPJ fica na conta mesmo podendo se repetir na unidade: é o de **cobrança**,
 * e as unidades podem ser filiais do mesmo CNPJ ou franquias com CNPJ próprio.
 *
 * ACORDEÃO, UMA ABERTA POR VEZ
 *
 * Desenho escolhido por ele (opção 1 de três): a primeira clínica vem aberta,
 * clicar em outra abre ela e fecha a anterior. "Na grande maioria será apenas
 * unidade, então permanecer com a primeira aberta vai facilitar" — e de fato,
 * com uma clínica só, a guia é o formulário da Clínica de sempre, sem nada a
 * mais.
 *
 * E o acordeão não é só economia de espaço: como só uma está aberta, o Salvar
 * nunca tem três clínicas em mãos. Uma gravação, uma unidade, e nenhuma meia
 * gravação para desfazer — o que a opção de blocos todos abertos teria exigido
 * resolver com transação.
 *
 * "Aberta" aqui é o acordeão; **"em uso"** é a unidade da sessão, a que o resto
 * do sistema está mostrando. São coisas diferentes e a tela diz as duas, porque
 * editar a clínica do outro bairro sem estar nela é exatamente o que esta guia
 * passou a permitir.
 */

interface Unidade {
    id: string
    name: string
    address: string | null
    phone: string | null
    createdAt: string
    usuarios: number
    pacientes: number
    agentes: number
    participo: boolean
}

interface Conta {
    name: string
    cpfCnpj: string | null
    logo: string | null
    postalCode: string | null
    address: string | null
    addressNumber: string | null
    complement: string | null
    province: string | null
    city: string | null
    state: string | null
    billingPhone: string | null
    souMaster: boolean
    plano: string | null
    unidades: { used: number; max: number; remaining: number; doPlano: number; adicionais: number }
}

interface Unidades {
    aberta: string
    lista: Unidade[]
}

/** O formulário de uma unidade, em dígitos crus como o banco guarda. */
interface FormUnidade {
    name: string
    address: string
    phone: string
}

export function ContaClinicaTab({ formId }: { formId: string }) {
    const [conta, setConta] = useState<Conta | null>(null)
    const [dados, setDados] = useState<Unidades | null>(null)
    const [carregando, setCarregando] = useState(true)
    const [salvando, setSalvando] = useState(false)

    /** O documento, o endereço de cobrança e a logo da conta, em edição. */
    const [formConta, setFormConta] = useState({
        cpfCnpj: '',
        logo: '',
        postalCode: '',
        address: '',
        addressNumber: '',
        complement: '',
        province: '',
        city: '',
        state: '',
        billingPhone: '',
    })
    /** Enquanto o ViaCEP responde, para o campo não parecer travado. */
    const [buscandoCep, setBuscandoCep] = useState(false)
    /** Qual clínica está aberta no acordeão, e o que há nos campos dela. */
    const [abertaNoAcordeao, setAbertaNoAcordeao] = useState<string | null>(null)
    const [formUnidade, setFormUnidade] = useState<FormUnidade>({ name: '', address: '', phone: '' })

    const [criando, setCriando] = useState(false)
    const [nomeNova, setNomeNova] = useState('')
    const [erroNova, setErroNova] = useState<string | null>(null)
    const [contratando, setContratando] = useState(false)
    const [trocando, setTrocando] = useState<string | null>(null)

    const arquivo = useRef<HTMLInputElement>(null)

    const carregar = useCallback(async (manterAberta?: string) => {
        try {
            const [rc, ru] = await Promise.all([
                fetch('/api/account'),
                fetch('/api/account/workspaces'),
            ])
            if (!rc.ok || !ru.ok) return
            const c: Conta = await rc.json()
            const u = await ru.json()

            setConta(c)
            setFormConta({
                cpfCnpj: onlyDigits(c.cpfCnpj),
                logo: c.logo ?? '',
                postalCode: onlyDigits(c.postalCode),
                address: c.address ?? '',
                addressNumber: c.addressNumber ?? '',
                complement: c.complement ?? '',
                province: c.province ?? '',
                city: c.city ?? '',
                state: c.state ?? '',
                billingPhone: formatPhone(c.billingPhone),
            })
            setDados({ aberta: u.aberta, lista: u.lista })

            // A primeira da lista vem aberta — a mais antiga, que é a clínica
            // original da conta. Depois de gravar, continua aberta a mesma:
            // voltar para a primeira tiraria da vista o que acabou de mudar.
            const escolhida =
                (manterAberta && u.lista.some((x: Unidade) => x.id === manterAberta)
                    ? manterAberta
                    : null) ?? (u.lista[0]?.id as string | undefined) ?? null
            setAbertaNoAcordeao(escolhida)
            const alvo = u.lista.find((x: Unidade) => x.id === escolhida)
            if (alvo) {
                setFormUnidade({
                    name: alvo.name,
                    address: alvo.address ?? '',
                    phone: formatPhone(alvo.phone),
                })
            }
        } finally {
            setCarregando(false)
        }
    }, [])

    useEffect(() => {
        void carregar()
    }, [carregar])

    /**
     * Abre outra clínica no acordeão.
     *
     * Descarta o que estava digitado na anterior, e isso é deliberado: é a mesma
     * regra do editor de agente ("sair sem salvar é não salvar"), e um aviso de
     * "você tem alterações" num acordeão de três linhas interromperia mais do
     * que protege.
     */
    function abrirNoAcordeao(u: Unidade) {
        if (abertaNoAcordeao === u.id) return
        setAbertaNoAcordeao(u.id)
        setFormUnidade({ name: u.name, address: u.address ?? '', phone: formatPhone(u.phone) })
    }

    async function salvar() {
        const problema = phoneIssue(formUnidade.phone)
        if (problema) {
            toast.error(problema)
            return
        }
        if (formUnidade.name.trim().length < 2) {
            toast.error('Dê um nome à clínica.')
            return
        }
        // 11 = CPF, 14 = CNPJ. Os dois valem; o que não vale é parar no meio.
        if (formConta.cpfCnpj && ![11, 14].includes(formConta.cpfCnpj.length)) {
            toast.error('Informe um CPF (11 dígitos) ou um CNPJ (14 dígitos).')
            return
        }

        setSalvando(true)
        try {
            /**
             * Duas chamadas, e a da conta só sai para o MASTER.
             *
             * Em sequência e não em paralelo: se a da conta for recusada, não
             * faz sentido anunciar que a clínica foi gravada — a pessoa clicou
             * em um Salvar e espera uma resposta.
             */
            if (conta?.souMaster) {
                const rc = await fetch('/api/account', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        cpfCnpj: formConta.cpfCnpj,
                        logo: formConta.logo || null,
                        postalCode: formConta.postalCode,
                        address: formConta.address,
                        addressNumber: formConta.addressNumber,
                        complement: formConta.complement,
                        province: formConta.province,
                        city: formConta.city,
                        state: formConta.state,
                        billingPhone: onlyDigits(formConta.billingPhone),
                    }),
                })
                if (!rc.ok) {
                    const erro = await rc.json().catch(() => ({}))
                    toast.error(erro.error ?? 'Não foi possível salvar os dados da conta')
                    return
                }
            }

            if (abertaNoAcordeao) {
                const ru = await fetch(`/api/account/workspaces/${abertaNoAcordeao}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name: formUnidade.name,
                        address: formUnidade.address,
                        phone: onlyDigits(formUnidade.phone),
                    }),
                })
                if (!ru.ok) {
                    const erro = await ru.json().catch(() => ({}))
                    toast.error(erro.error ?? 'Não foi possível salvar os dados da clínica')
                    return
                }
            }

            // A marca da sidebar desenha a logo da conta e o nome da unidade:
            // avisada aqui, troca na hora, sem esperar a próxima navegação.
            window.dispatchEvent(new Event(WORKSPACE_UPDATED))
            toast.success('Dados salvos')
            await carregar(abertaNoAcordeao ?? undefined)
        } finally {
            setSalvando(false)
        }
    }

    /**
     * O CEP preenche o resto, e é por isso que ele vem primeiro.
     *
     * Logradouro, bairro, cidade e UF digitados à mão em formulário de cobrança
     * erram — e endereço errado em cobrança de cartão é recusa de transação,
     * não defeito cosmético. Só preenche o que está **vazio**: quem já corrigiu
     * um logradouro não o perde ao conferir o CEP.
     *
     * Falha do ViaCEP não trava nada: a pessoa digita à mão e contrata igual.
     */
    async function completarPeloCep(cep: string) {
        if (onlyDigits(cep).length !== 8) return
        setBuscandoCep(true)
        try {
            const achado = await buscarCep(cep)
            if (!achado) return
            setFormConta((p) => ({
                ...p,
                address: p.address || achado.address,
                province: p.province || achado.province,
                city: p.city || achado.city,
                state: p.state || achado.state,
            }))
        } finally {
            setBuscandoCep(false)
        }
    }

    function escolherImagem() {
        arquivo.current?.click()
    }

    function trocarImagem(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0]
        if (!file) return
        const leitor = new FileReader()
        leitor.onload = (ev) => setFormConta((p) => ({ ...p, logo: ev.target?.result as string }))
        leitor.readAsDataURL(file)
    }

    async function criar() {
        setSalvando(true)
        setErroNova(null)
        try {
            const res = await fetch('/api/account/workspaces', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: nomeNova }),
            })
            const corpo = await res.json().catch(() => ({}))
            if (!res.ok) {
                setErroNova(corpo.error ?? 'Não foi possível criar a unidade')
                return
            }
            setCriando(false)
            setNomeNova('')
            toast.success(`Unidade ${corpo.name} criada.`)
            // Abre a nova no acordeão: foi o que a pessoa acabou de criar, e é
            // onde falta preencher endereço e telefone.
            await carregar(corpo.id)
        } finally {
            setSalvando(false)
        }
    }

    async function contratar() {
        setContratando(true)
        try {
            const res = await fetch('/api/account/subscription', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'buy-addons', units: 1 }),
            })
            const corpo = await res.json().catch(() => ({}))
            if (!res.ok) {
                toast.error(corpo.error ?? 'Não foi possível contratar a unidade')
                return
            }
            toast.success(corpo.message)
            await carregar(abertaNoAcordeao ?? undefined)
        } finally {
            setContratando(false)
        }
    }

    /** Põe o resto do sistema nesta clínica. Recarrega tudo, de propósito. */
    async function usar(id: string) {
        setTrocando(id)
        try {
            const res = await fetch('/api/workspace/switch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ workspaceId: id }),
            })
            if (!res.ok) {
                const corpo = await res.json().catch(() => ({}))
                toast.error(corpo.error ?? 'Não foi possível abrir a unidade')
                setTrocando(null)
                return
            }
            window.location.reload()
        } catch {
            setTrocando(null)
        }
    }

    const u = conta?.unidades
    const cabeMais = (u?.remaining ?? 0) > 0

    return (
        <BandLayout
            footer={
                <>
                    {salvando ? (
                        <p className="mr-auto text-xs text-muted-foreground">Salvando…</p>
                    ) : null}
                    {conta?.souMaster ? (
                        cabeMais ? (
                            <Button
                                variant="outline"
                                onClick={() => {
                                    setNomeNova('')
                                    setErroNova(null)
                                    setCriando(true)
                                }}
                            >
                                <Plus className="size-4" />
                                Nova unidade
                            </Button>
                        ) : (
                            <Button variant="outline" onClick={() => void contratar()} disabled={contratando}>
                                {contratando ? (
                                    <Loader2 className="size-4 animate-spin" />
                                ) : (
                                    <ShoppingCart className="size-4" />
                                )}
                                Contratar unidade por {formatPrice(UNIDADE_ADICIONAL.price)}
                            </Button>
                        )
                    ) : null}
                    <Button type="submit" form={formId} disabled={salvando || carregando}>
                        <Save className="size-4" />
                        Salvar
                    </Button>
                </>
            }
        >
            <form
                id={formId}
                onSubmit={(e) => {
                    e.preventDefault()
                    if (!salvando) void salvar()
                }}
            >
                <SettingsBand
                    title="Conta"
                    description="A assinatura, a fatura e o teto de unidades são da conta. As clínicas abaixo pertencem a ela."
                    aside={
                        conta?.plano ? (
                            <span className="text-xs font-semibold text-muted-foreground">
                                {conta.plano}
                            </span>
                        ) : undefined
                    }
                >
                    <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
                        <FormField
                            label="Nome da conta"
                            htmlFor="conta-nome"
                            hint="É o nome do cliente, e não muda por aqui."
                        >
                            <Input id="conta-nome" value={conta?.name ?? ''} disabled />
                        </FormField>

                        {/* CPF **ou** CNPJ: dentista sozinho às vezes não tem
                            CNPJ, e é este o documento que vai para o Asaas no
                            campo `cpfCnpj`. O molde troca pelo tamanho, com o
                            teto do maior — senão o campo ficaria preso em CPF no
                            décimo segundo dígito. Até 11 pontua como CPF, que é
                            o caso comum; quem digita CNPJ passa por ali e se
                            corrige no dígito seguinte. */}
                        <FormField
                            label="CPF ou CNPJ de cobrança"
                            htmlFor="conta-documento"
                            hint="De quem assina. É o documento que vai na fatura."
                        >
                            <MaskedInput
                                id="conta-documento"
                                mask={formConta.cpfCnpj.length <= 11 ? MASKS.cpf : MASKS.cnpj}
                                capacity={14}
                                value={formConta.cpfCnpj}
                                disabled={!conta?.souMaster}
                                onChange={(digitos) => setFormConta((p) => ({ ...p, cpfCnpj: digitos }))}
                            />
                        </FormField>
                    </div>

                    {/* O endereço de **cobrança** — o de quem paga, não o da
                        clínica onde o paciente chega (esse é de cada unidade,
                        no cartão abaixo). O cartão de crédito exige os cinco
                        campos separados, e o Asaas recusa o checkout sem eles.

                        O CEP vem primeiro porque ele preenche o resto. */}
                    <p className="mb-2 mt-5 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
                        Endereço de cobrança
                    </p>

                    <div className="grid max-w-3xl gap-4 sm:grid-cols-6">
                        <FormField
                            label="CEP"
                            htmlFor="conta-cep"
                            className="sm:col-span-2"
                            hint={buscandoCep ? 'Buscando…' : 'Preenche o resto sozinho.'}
                        >
                            <MaskedInput
                                id="conta-cep"
                                mask={MASKS.cep}
                                value={formConta.postalCode}
                                disabled={!conta?.souMaster}
                                onChange={(digitos) => {
                                    setFormConta((p) => ({ ...p, postalCode: digitos }))
                                    // Busca ao completar os oito, sem esperar o
                                    // foco sair: quem digita CEP já espera isso.
                                    if (digitos.length === 8) void completarPeloCep(digitos)
                                }}
                            />
                        </FormField>

                        <FormField label="Logradouro" htmlFor="conta-logradouro" className="sm:col-span-4">
                            <Input
                                id="conta-logradouro"
                                value={formConta.address}
                                maxLength={120}
                                disabled={!conta?.souMaster}
                                placeholder="Rua, avenida, praça"
                                onChange={(e) => setFormConta((p) => ({ ...p, address: e.target.value }))}
                            />
                        </FormField>

                        <FormField label="Número" htmlFor="conta-numero" className="sm:col-span-1">
                            <Input
                                id="conta-numero"
                                value={formConta.addressNumber}
                                maxLength={20}
                                disabled={!conta?.souMaster}
                                onChange={(e) => setFormConta((p) => ({ ...p, addressNumber: e.target.value }))}
                            />
                        </FormField>

                        <FormField label="Complemento" htmlFor="conta-complemento" className="sm:col-span-2">
                            <Input
                                id="conta-complemento"
                                value={formConta.complement}
                                maxLength={60}
                                disabled={!conta?.souMaster}
                                placeholder="Sala, andar"
                                onChange={(e) => setFormConta((p) => ({ ...p, complement: e.target.value }))}
                            />
                        </FormField>

                        <FormField label="Bairro" htmlFor="conta-bairro" className="sm:col-span-3">
                            <Input
                                id="conta-bairro"
                                value={formConta.province}
                                maxLength={60}
                                disabled={!conta?.souMaster}
                                onChange={(e) => setFormConta((p) => ({ ...p, province: e.target.value }))}
                            />
                        </FormField>

                        <FormField label="Cidade" htmlFor="conta-cidade" className="sm:col-span-3">
                            <Input
                                id="conta-cidade"
                                value={formConta.city}
                                maxLength={60}
                                disabled={!conta?.souMaster}
                                onChange={(e) => setFormConta((p) => ({ ...p, city: e.target.value }))}
                            />
                        </FormField>

                        <FormField label="UF" htmlFor="conta-uf" className="sm:col-span-1">
                            <Input
                                id="conta-uf"
                                value={formConta.state}
                                maxLength={2}
                                disabled={!conta?.souMaster}
                                className="uppercase"
                                onChange={(e) =>
                                    setFormConta((p) => ({ ...p, state: e.target.value.toUpperCase() }))
                                }
                            />
                        </FormField>

                        <FormField
                            label="Telefone de cobrança"
                            htmlFor="conta-telefone"
                            className="sm:col-span-2"
                            hint="Com DDD."
                        >
                            <PhoneInput
                                id="conta-telefone"
                                value={formConta.billingPhone}
                                disabled={!conta?.souMaster}
                                onChange={(digitos) =>
                                    setFormConta((p) => ({ ...p, billingPhone: digitos }))
                                }
                            />
                        </FormField>
                    </div>

                    <div className="mt-4">
                        <p className="mb-1.5 text-[11.5px] font-medium text-muted-foreground">
                            Logomarca — substitui a do OdontoBox360 no cabeçalho do sistema. Até
                            160 × 25 px.
                        </p>
                        {/* A área de soltar não precisa da largura da tela: sem
                            moldura, um alvo de ponta a ponta viraria uma faixa
                            vazia de 1400px. */}
                        <button
                            type="button"
                            onClick={escolherImagem}
                            disabled={!conta?.souMaster}
                            className="flex h-24 w-full max-w-md flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-border bg-background outline-none transition-colors hover:border-border-strong focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {formConta.logo ? (
                                /* data URL gravado na conta, não um arquivo do
                                   projeto: o otimizador do Next não tem o que
                                   fazer com ele. */
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                    src={formConta.logo}
                                    alt="Logomarca da clínica"
                                    className="max-h-16 max-w-[160px] object-contain"
                                />
                            ) : (
                                <>
                                    <Upload className="size-6 text-muted-foreground" />
                                    <span className="text-sm text-muted-foreground">
                                        Escolher a imagem
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                        PNG com fundo transparente fica melhor
                                    </span>
                                </>
                            )}
                        </button>
                        <input
                            ref={arquivo}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={trocarImagem}
                        />
                    </div>
                </SettingsBand>

                <SettingsBand
                    title="Unidades da conta"
                    description={
                        u
                            ? `${conta?.plano ?? 'Seu plano'} inclui ${u.doPlano} unidade${u.doPlano === 1 ? '' : 's'}` +
                              (u.adicionais > 0
                                  ? `, e você contratou ${u.adicionais} adicional${u.adicionais === 1 ? '' : 'is'}.`
                                  : '.') +
                              ' Cada adicional soma 1 agente e 1 número.'
                            : 'Cada clínica tem pacientes, agenda e conversas próprios.'
                    }
                    aside={
                        u ? (
                            <span className="num text-xs font-semibold text-muted-foreground">
                                {u.used} de {u.max}
                            </span>
                        ) : undefined
                    }
                    last
                >
                    {carregando ? (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Loader2 className="size-4 animate-spin" /> Carregando…
                        </div>
                    ) : (
                        <div className="flex flex-col gap-2">
                            {dados?.lista.map((unidade) => {
                                const aberta = unidade.id === abertaNoAcordeao
                                const emUso = unidade.id === dados.aberta
                                return (
                                    <div
                                        key={unidade.id}
                                        className={cn(
                                            'rounded-lg border transition-colors',
                                            aberta
                                                ? 'border-primary-subtle-foreground/40 bg-primary-subtle/40'
                                                : 'border-border'
                                        )}
                                    >
                                        {/* O cabeçalho da linha é o gatilho do acordeão.
                                            `type="button"`, senão ele submete o formulário
                                            da guia — um clique para abrir a clínica
                                            gravaria a anterior. */}
                                        <button
                                            type="button"
                                            onClick={() => abrirNoAcordeao(unidade)}
                                            aria-expanded={aberta}
                                            className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                                        >
                                            <ChevronDown
                                                className={cn(
                                                    'size-4 shrink-0 text-muted-foreground transition-transform',
                                                    aberta && 'rotate-180'
                                                )}
                                            />
                                            <span className="min-w-0 flex-1">
                                                <span className="flex items-center gap-2 text-sm font-semibold">
                                                    <span className="truncate">{unidade.name}</span>
                                                    {emUso ? (
                                                        <Badge variant="outline" className="shrink-0 gap-1">
                                                            <Check className="size-3" /> em uso
                                                        </Badge>
                                                    ) : null}
                                                </span>
                                                {/* Fechada, a linha diz o que a aberta
                                                    mostra em campos — endereço e telefone.
                                                    É o que torna a lista legível sem abrir
                                                    uma por uma. */}
                                                {!aberta ? (
                                                    <span className="block truncate text-xs text-muted-foreground">
                                                        {[unidade.address, formatPhone(unidade.phone)]
                                                            .filter(Boolean)
                                                            .join(' · ') || 'Sem endereço e telefone'}
                                                    </span>
                                                ) : null}
                                            </span>
                                        </button>

                                        {aberta ? (
                                            <div className="border-t border-border/60 px-3.5 py-3">
                                                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[1.1fr_1.6fr_.9fr]">
                                                    <FormField
                                                        label="Nome da clínica"
                                                        htmlFor={`nome-${unidade.id}`}
                                                        required
                                                        hint="É como ela aparece no seletor de clínicas."
                                                    >
                                                        <Input
                                                            id={`nome-${unidade.id}`}
                                                            value={formUnidade.name}
                                                            maxLength={80}
                                                            onChange={(e) =>
                                                                setFormUnidade((p) => ({
                                                                    ...p,
                                                                    name: e.target.value,
                                                                }))
                                                            }
                                                        />
                                                    </FormField>

                                                    <FormField label="Endereço" htmlFor={`end-${unidade.id}`}>
                                                        <Input
                                                            id={`end-${unidade.id}`}
                                                            value={formUnidade.address}
                                                            maxLength={200}
                                                            placeholder="Rua, número, bairro, cidade — UF"
                                                            onChange={(e) =>
                                                                setFormUnidade((p) => ({
                                                                    ...p,
                                                                    address: e.target.value,
                                                                }))
                                                            }
                                                        />
                                                    </FormField>

                                                    <FormField
                                                        label="Telefone"
                                                        htmlFor={`tel-${unidade.id}`}
                                                        hint="Com DDD."
                                                    >
                                                        <PhoneInput
                                                            id={`tel-${unidade.id}`}
                                                            value={formUnidade.phone}
                                                            onChange={(digitos) =>
                                                                setFormUnidade((p) => ({
                                                                    ...p,
                                                                    phone: digitos,
                                                                }))
                                                            }
                                                        />
                                                    </FormField>
                                                </div>

                                                <div className="mt-3 flex items-center justify-between gap-3">
                                                    <p className="text-xs text-muted-foreground">
                                                        <span className="num">{unidade.usuarios}</span>{' '}
                                                        usuário{unidade.usuarios === 1 ? '' : 's'} ·{' '}
                                                        <span className="num">{unidade.pacientes}</span>{' '}
                                                        paciente{unidade.pacientes === 1 ? '' : 's'} ·{' '}
                                                        <span className="num">{unidade.agentes}</span>{' '}
                                                        agente{unidade.agentes === 1 ? '' : 's'}
                                                    </p>
                                                    {/* Trocar a unidade da sessão é outra coisa
                                                        que editar os dados dela, e por isso não
                                                        é o Salvar: recarrega o sistema inteiro. */}
                                                    {!emUso ? (
                                                        unidade.participo ? (
                                                            <Button
                                                                type="button"
                                                                variant="outline"
                                                                size="sm"
                                                                disabled={trocando === unidade.id}
                                                                onClick={() => void usar(unidade.id)}
                                                            >
                                                                {trocando === unidade.id ? (
                                                                    <Loader2 className="size-3.5 animate-spin" />
                                                                ) : null}
                                                                Trabalhar nesta clínica
                                                            </Button>
                                                        ) : (
                                                            <span className="text-xs text-muted-foreground">
                                                                Você não participa desta clínica
                                                            </span>
                                                        )
                                                    ) : null}
                                                </div>
                                            </div>
                                        ) : null}
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </SettingsBand>
            </form>

            {/* O ACORDO, no fim da guia da conta.
                Morava na guia Plano, junto do que se paga. Mudou a pedido do
                Andre em 2026-10-19, e o lugar novo é melhor: o aceite é da
                **conta** — quem aceitou, quando, qual versão —, e não uma
                condição comercial. Fica por último porque é consulta, não
                tarefa: ninguém abre esta guia para reler termos. */}
            <TermsCard band />


            <RecordDialog
                open={criando}
                onOpenChange={setCriando}
                title="Nova unidade"
                description="A clínica nasce vazia, com você dentro. O que já existe aqui não é copiado."
                submitLabel="Criar unidade"
                submitting={salvando}
                submitDisabled={nomeNova.trim().length < 2}
                hideAgain
                onSubmit={() => void criar()}
            >
                <FormField label="Nome da unidade" required error={erroNova ?? undefined}>
                    <Input
                        value={nomeNova}
                        onChange={(e) => setNomeNova(e.target.value)}
                        placeholder="Clínica Centro"
                        maxLength={80}
                        autoFocus
                    />
                </FormField>
            </RecordDialog>
        </BandLayout>
    )
}
