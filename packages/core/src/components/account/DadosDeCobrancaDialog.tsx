'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Input } from '@venn/ui/input'
import { MaskedInput } from '../shared/MaskedInput'
import { PhoneInput } from '../shared/PhoneInput'
import { FormField } from '../shared/FormField'
import { RecordDialog, SummaryCard } from '../shared/RecordDialog'
import { buscarCep } from '../../lib/cep'
import { MASKS } from '../../lib/masks'
import {
    CAMPOS_DE_COBRANCA,
    NOME_DO_CAMPO,
    conferirCobranca,
    type CampoDeCobranca,
} from '../../lib/billing/dados-de-cobranca'

/**
 * Os dados de cobrança, pedidos **sem sair da tela de assinatura**.
 *
 * ## O que isto conserta
 *
 * Quem estava em avaliação e clicava em Contratar recebia uma recusa com um
 * roteiro de navegação — "Gerenciamento → Conta → Assinatura" — e um atalho
 * para a guia da empresa. Lá preenchia o documento, voltava para a guia do
 * plano, reabria o diálogo e escolhia o plano de novo. Quatro passos para o
 * sistema receber um CNPJ. Foi o que o Andre apontou em 2026-11-07: "sair da
 * tela de assinatura, voltar pra preencher um CNPJ ou endereço e depois voltar
 * não é nada amigável".
 *
 * Aqui o formulário abre **em cima** da escolha do plano, grava, e quem chamou
 * retoma a contratação no `onPronto` — com o plano e o ciclo que a pessoa já
 * havia escolhido. Nada se perde no caminho.
 *
 * ## Por que pede o endereço, e não só o documento
 *
 * Porque o Asaas recusa `customerData` pela metade (a tabela está em
 * `asaas/checkout.ts`): faltando uma peça, nós omitimos o bloco inteiro e **a
 * página deles pergunta tudo**. Ou seja, endereço incompleto aqui não poupa
 * digitação — só a transfere para uma tela onde o cliente não esperava
 * preencher endereço. Com o CEP buscando o resto, o que sobra é documento,
 * número e telefone.
 *
 * ## Por que não reusa o formulário da Conta da Clínica
 *
 * Aquele é a tela de **manutenção** do cadastro: nome, logomarca, unidades,
 * acordeão de clínicas, um Salvar que grava tudo. Este é um passo de
 * contratação — oito campos, um botão, e um retorno para onde a pessoa estava.
 * O que os dois compartilham é o que importa: a rota (`PATCH /api/account`), a
 * busca de CEP e a regra do que é obrigatório (`dados-de-cobranca.ts`).
 */

export interface DadosDeCobrancaIniciais {
    cpfCnpj?: string | null
    postalCode?: string | null
    address?: string | null
    addressNumber?: string | null
    complement?: string | null
    province?: string | null
    city?: string | null
    state?: string | null
    billingPhone?: string | null
}

type Formulario = Record<CampoDeCobranca, string> & { complement: string }

const VAZIO: Formulario = {
    cpfCnpj: '',
    postalCode: '',
    address: '',
    addressNumber: '',
    province: '',
    city: '',
    state: '',
    billingPhone: '',
    complement: '',
}

function soDigitos(valor: string | null | undefined): string {
    return (valor ?? '').replace(/\D/g, '')
}

export function DadosDeCobrancaDialog({
    open,
    onOpenChange,
    iniciais,
    /**
     * O que fazer depois de gravar — tipicamente, retomar a contratação.
     *
     * É o ponto inteiro deste componente: sem ele, isto seria mais um
     * formulário e a pessoa continuaria tendo de voltar ao plano à mão.
     */
    onPronto,
    /** Para a frase do resumo dizer por que estamos pedindo isto agora. */
    motivo = 'Precisamos deles para abrir o pagamento.',
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    iniciais?: DadosDeCobrancaIniciais | null
    onPronto: () => void | Promise<void>
    motivo?: string
}) {
    const [form, setForm] = useState<Formulario>(VAZIO)
    const [buscandoCep, setBuscandoCep] = useState(false)
    const [gravando, setGravando] = useState(false)
    /** Só depois da primeira tentativa: erro em campo vazio ao abrir é ruído. */
    const [tentou, setTentou] = useState(false)

    /**
     * O formulário nasce com o que a conta já tem.
     *
     * Em `useEffect` sobre `open` e não só no estado inicial: o diálogo é
     * montado junto com a guia e os dados chegam depois, da rota de assinatura.
     * Sem reagir à abertura, ele abriria vazio para quem já tinha metade
     * preenchido — e a pessoa redigitaria o que o sistema já sabia.
     */
    useEffect(() => {
        if (!open) return
        setTentou(false)
        setForm({
            cpfCnpj: soDigitos(iniciais?.cpfCnpj),
            postalCode: soDigitos(iniciais?.postalCode),
            address: iniciais?.address ?? '',
            addressNumber: iniciais?.addressNumber ?? '',
            province: iniciais?.province ?? '',
            city: iniciais?.city ?? '',
            state: iniciais?.state ?? '',
            billingPhone: soDigitos(iniciais?.billingPhone),
            complement: iniciais?.complement ?? '',
        })
    }, [open, iniciais])

    const estado = conferirCobranca(form)
    const documentoValido = [11, 14].includes(form.cpfCnpj.length)

    async function completarPeloCep(cep: string) {
        if (cep.length !== 8) return
        setBuscandoCep(true)
        try {
            const achado = await buscarCep(cep)
            if (!achado) return
            setForm((p) => ({
                ...p,
                address: achado.address || p.address,
                province: achado.province || p.province,
                city: achado.city || p.city,
                state: achado.state || p.state,
            }))
        } finally {
            setBuscandoCep(false)
        }
    }

    async function gravar() {
        setTentou(true)

        if (!documentoValido) {
            toast.error('O CPF tem 11 dígitos e o CNPJ, 14.')
            return
        }
        if (!estado.completo) {
            toast.error(`Falta ${NOME_DO_CAMPO[estado.faltando[0]]}.`)
            return
        }

        setGravando(true)
        try {
            const res = await fetch('/api/account', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(form),
            })
            const data = await res.json()

            if (!res.ok) {
                toast.error(data.error || 'Não foi possível gravar os dados de cobrança')
                return
            }

            onOpenChange(false)
            /**
             * E segue direto para o pagamento.
             *
             * Sem toast de "salvo": o que a pessoa pediu foi contratar, e o
             * próximo aviso que ela vê é o da contratação. Um sucesso aqui
             * anunciaria o meio do caminho como se fosse o fim.
             */
            await onPronto()
        } catch {
            toast.error('Não foi possível gravar os dados de cobrança')
        } finally {
            setGravando(false)
        }
    }

    /** O erro só aparece depois de tentar, e só no campo que está vazio. */
    const erroDe = (campo: CampoDeCobranca) =>
        tentou && estado.faltando.includes(campo) ? 'Obrigatório para a cobrança.' : undefined

    return (
        <RecordDialog
            open={open}
            onOpenChange={onOpenChange}
            title="Dados de cobrança"
            description="Ficam na conta e valem para todas as faturas. Você informa uma vez."
            submitLabel="Salvar e continuar"
            hideAgain
            submitting={gravando}
            onSubmit={() => void gravar()}
            summary={
                <>
                    <SummaryCard className="flex-col items-start gap-1">
                        <span className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
                            Falta preencher
                        </span>
                        <span className="num text-lg font-bold">
                            {estado.faltando.length === 0
                                ? 'nada'
                                : `${estado.faltando.length} campo${estado.faltando.length === 1 ? '' : 's'}`}
                        </span>
                    </SummaryCard>
                    <p className="text-[11px] leading-relaxed text-muted-foreground">{motivo}</p>
                    {/* Dito aqui porque é a pergunta que o campo de documento
                        levanta: por que o sistema quer o CNPJ agora, se a
                        avaliação não pediu nada. */}
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                        São os dados que o cartão exige. Preenchendo aqui, a página de pagamento
                        não vai pedir de novo.
                    </p>
                </>
            }
        >
            <div className="col-span-2 grid gap-4 sm:grid-cols-12">
                {/* CPF **ou** CNPJ no mesmo campo, como no resto do sistema:
                    dentista sozinho às vezes não tem CNPJ, e o Asaas recebe os
                    dois em `cpfCnpj`. O molde troca pelo tamanho. */}
                <FormField
                    label="CPF ou CNPJ de cobrança"
                    htmlFor="cob-documento"
                    className="sm:col-span-6"
                    required
                    hint="De quem assina. É o documento que vai na fatura."
                    error={
                        tentou && !documentoValido
                            ? 'Informe um CPF (11 dígitos) ou um CNPJ (14 dígitos).'
                            : undefined
                    }
                >
                    <MaskedInput
                        id="cob-documento"
                        mask={form.cpfCnpj.length <= 11 ? MASKS.cpf : MASKS.cnpj}
                        capacity={14}
                        value={form.cpfCnpj}
                        onChange={(digitos) => setForm((p) => ({ ...p, cpfCnpj: digitos }))}
                    />
                </FormField>

                <FormField
                    label="Telefone de cobrança"
                    htmlFor="cob-telefone"
                    className="sm:col-span-6"
                    required
                    hint="Com DDD."
                    error={erroDe('billingPhone')}
                >
                    <PhoneInput
                        id="cob-telefone"
                        value={form.billingPhone}
                        onChange={(digitos) => setForm((p) => ({ ...p, billingPhone: digitos }))}
                    />
                </FormField>

                {/* O CEP primeiro, porque ele preenche o resto — mesma ordem da
                    guia Conta da Clínica, para quem já viu uma reconhecer a
                    outra. */}
                <FormField
                    label="CEP"
                    htmlFor="cob-cep"
                    className="sm:col-span-3"
                    required
                    hint={buscandoCep ? 'Buscando…' : undefined}
                    error={erroDe('postalCode')}
                >
                    <MaskedInput
                        id="cob-cep"
                        mask={MASKS.cep}
                        value={form.postalCode}
                        onChange={(digitos) => {
                            setForm((p) => ({ ...p, postalCode: digitos }))
                            if (digitos.length === 8) void completarPeloCep(digitos)
                        }}
                    />
                </FormField>

                <FormField
                    label="Logradouro"
                    htmlFor="cob-logradouro"
                    className="sm:col-span-7"
                    required
                    error={erroDe('address')}
                >
                    <Input
                        id="cob-logradouro"
                        value={form.address}
                        maxLength={120}
                        placeholder="Rua, avenida, praça"
                        onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))}
                    />
                </FormField>

                <FormField
                    label="Número"
                    htmlFor="cob-numero"
                    className="sm:col-span-2"
                    required
                    error={erroDe('addressNumber')}
                >
                    <Input
                        id="cob-numero"
                        value={form.addressNumber}
                        maxLength={20}
                        onChange={(e) => setForm((p) => ({ ...p, addressNumber: e.target.value }))}
                    />
                </FormField>

                <FormField label="Complemento" htmlFor="cob-complemento" className="sm:col-span-3">
                    <Input
                        id="cob-complemento"
                        value={form.complement}
                        maxLength={60}
                        placeholder="Sala, andar"
                        onChange={(e) => setForm((p) => ({ ...p, complement: e.target.value }))}
                    />
                </FormField>

                <FormField
                    label="Bairro"
                    htmlFor="cob-bairro"
                    className="sm:col-span-4"
                    required
                    error={erroDe('province')}
                >
                    <Input
                        id="cob-bairro"
                        value={form.province}
                        maxLength={60}
                        onChange={(e) => setForm((p) => ({ ...p, province: e.target.value }))}
                    />
                </FormField>

                <FormField
                    label="Cidade"
                    htmlFor="cob-cidade"
                    className="sm:col-span-4"
                    required
                    error={erroDe('city')}
                >
                    <Input
                        id="cob-cidade"
                        value={form.city}
                        maxLength={60}
                        onChange={(e) => setForm((p) => ({ ...p, city: e.target.value }))}
                    />
                </FormField>

                <FormField
                    label="UF"
                    htmlFor="cob-uf"
                    className="sm:col-span-1"
                    required
                    error={erroDe('state')}
                >
                    <Input
                        id="cob-uf"
                        value={form.state}
                        maxLength={2}
                        className="uppercase"
                        onChange={(e) =>
                            setForm((p) => ({ ...p, state: e.target.value.toUpperCase() }))
                        }
                    />
                </FormField>
            </div>

            <p className="col-span-2 text-[11.5px] leading-snug text-muted-foreground">
                Este é o endereço de <strong>quem paga</strong> — pode ser diferente do endereço
                de cada clínica, que fica em Conta da Clínica. Os{' '}
                {CAMPOS_DE_COBRANCA.length} campos são os que a operadora do cartão exige.
            </p>
        </RecordDialog>
    )
}
