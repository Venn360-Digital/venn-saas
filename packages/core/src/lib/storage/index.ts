import 'server-only'
import { CLASSES, ClasseBloqueadaError, provedorDa, podeGravar, type Classe, type NomeDeProvedor } from './classificacao'
import { ProvedorS3 } from './s3'
import { ObjetoAusenteError, chaveDe, type OpcoesDeGravacao, type ProvedorDeObjetos, type Referencia } from './tipos'

/**
 * O adaptador de storage da aplicação.
 *
 * Substitui o storage da plataforma anterior, que até 2026-10-21 era chamado direto em oito
 * pontos — e cada um deles montava o caminho à mão, escolhia o bucket pelo nome
 * de uma variável só, e **gravava a URL pública numa coluna do banco**.
 *
 * As três mudanças que importam:
 *
 * 1. **O destino vem da classe do dado**, não do chamador. Ver
 *    `classificacao.ts` para o porquê — resumidamente, o R2 não garante
 *    residência física no Brasil, e os dois buckets criados nasceram em `ENAM`.
 * 2. **O banco guarda referência, não URL.** URL amarra o banco ao provedor, e
 *    URL assinada guardada expira e deixa a coluna apontando para um 403.
 * 3. **A chave sempre começa pelo workspace**, e é a única forma de montar
 *    chave — para que uma rota nova não possa esquecer a fronteira de inquilino.
 */

export { CLASSES, ClasseBloqueadaError, ObjetoAusenteError, chaveDe, podeGravar, provedorDa }
export type { Classe, NomeDeProvedor, OpcoesDeGravacao, Referencia }

/**
 * Os provedores, construídos sob demanda e guardados por isolate.
 *
 * Preguiçoso de propósito: uma rota que só serve imagem pública não deve falhar
 * porque as credenciais do bucket privado não estão no ambiente. Construir tudo
 * na carga do módulo faria exatamente isso.
 */
const instancias = new Map<NomeDeProvedor, ProvedorDeObjetos>()

class ProvedorNaoConfiguradoError extends Error {
    constructor(nome: NomeDeProvedor, faltando: string[]) {
        super(
            `o provedor de storage "${nome}" não está configurado; faltam: ${faltando.join(', ')}`
        )
        this.name = 'ProvedorNaoConfiguradoError'
    }
}

function lerConfig(prefixo: string, nome: NomeDeProvedor) {
    const endpoint = process.env[`${prefixo}_ENDPOINT`]?.trim()
    const accessKeyId = process.env[`${prefixo}_ACCESS_KEY_ID`]?.trim()
    const secretAccessKey = process.env[`${prefixo}_SECRET_ACCESS_KEY`]?.trim()
    const bucket = process.env[`${prefixo}_BUCKET`]?.trim()

    const faltando = [
        !endpoint && `${prefixo}_ENDPOINT`,
        !accessKeyId && `${prefixo}_ACCESS_KEY_ID`,
        !secretAccessKey && `${prefixo}_SECRET_ACCESS_KEY`,
        !bucket && `${prefixo}_BUCKET`,
    ].filter((x): x is string => typeof x === 'string')

    if (faltando.length > 0) throw new ProvedorNaoConfiguradoError(nome, faltando)

    return {
        endpoint: endpoint!,
        accessKeyId: accessKeyId!,
        secretAccessKey: secretAccessKey!,
        bucket: bucket!,
        region: process.env[`${prefixo}_REGION`]?.trim(),
    }
}

/** O prefixo de ambiente de cada provedor. Nomes fixados em `docs/migration`. */
const PREFIXO: Record<NomeDeProvedor, string> = {
    'r2-publico': 'PUBLIC_STORAGE',
    'r2-privado': 'PRIVATE_STORAGE',
}

function provedor(nome: NomeDeProvedor): { cliente: ProvedorDeObjetos; bucket: string } {
    const config = lerConfig(PREFIXO[nome], nome)

    let cliente = instancias.get(nome)
    if (!cliente) {
        cliente = new ProvedorS3({
            nome,
            endpoint: config.endpoint,
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
            region: config.region,
        })
        instancias.set(nome, cliente)
    }

    return { cliente, bucket: config.bucket }
}

/**
 * Grava um objeto e devolve a referência para o banco.
 *
 * Lança `ClasseBloqueadaError` só para `NAO_CLASSIFICADO`: arquivo sem classe
 * não é gravado, porque tratá-lo como público vazaria e como clínico esconderia
 * que ninguém o classificou.
 */
export async function gravar(
    classe: Classe,
    chave: string,
    corpo: Uint8Array<ArrayBuffer>,
    opcoes: OpcoesDeGravacao
): Promise<Referencia> {
    const nome = provedorDa(classe)
    const { cliente, bucket } = provedor(nome)

    await cliente.gravar(bucket, chave, corpo, opcoes)

    return {
        provedor: nome,
        bucket,
        chave,
        classe,
        contentType: opcoes.contentType,
        tamanho: corpo.byteLength,
    }
}

/** Lê os bytes. `null` quando não existe. */
export async function ler(ref: Referencia): Promise<Uint8Array<ArrayBuffer> | null> {
    const { cliente } = provedor(ref.provedor)
    return cliente.ler(ref.bucket, ref.chave)
}

export async function apagar(ref: Referencia): Promise<void> {
    const { cliente } = provedor(ref.provedor)
    await cliente.apagar(ref.bucket, ref.chave)
}

export async function existe(ref: Referencia): Promise<boolean> {
    const { cliente } = provedor(ref.provedor)
    return cliente.existe(ref.bucket, ref.chave)
}

/**
 * Validade máxima de uma URL assinada de conteúdo que **identifica alguém**.
 *
 * Dez minutos: é tempo de um navegador carregar a imagem e não é tempo de a URL
 * circular por um grupo de WhatsApp. Conteúdo clínico não deve ter endereço
 * compartilhável, e URL assinada longa é exatamente isso.
 */
export const VALIDADE_MAXIMA_SEGUNDOS = 600

/**
 * Validade máxima de um ativo **público de verdade** — avatar de agente,
 * prévia de voz, ativo de marca.
 *
 * ## Por que os 600 s não servem aqui, e o defeito que isso causava
 *
 * O teto de dez minutos foi escrito para conteúdo clínico, e a frase que o
 * justifica diz isso: "não é tempo de a URL circular por um grupo de WhatsApp".
 * Esse raciocínio não se aplica ao retrato do agente, que é ativo de marca da
 * unidade e **existe para ser servido sem autenticação**. A cautela foi
 * emprestada de uma classe para outra, e cobrou o preço:
 *
 * `enderecoDoAvatar` cunha o endereço na leitura, então a imagem nasce válida.
 * Dez minutos depois, numa aba que ninguém recarregou, ela vira 403 e
 * desaparece — na lista de agentes e no Perfil. Foi relatado como "a imagem
 * aparece ao salvar e some".
 *
 * Sete dias é o teto do presign do S3/R2; não há ganho em pedir menos para um
 * arquivo que poderia estar atrás de um domínio público se o bucket tivesse um.
 *
 * ## O que explicitamente NÃO ganha isto
 *
 * Retrato de pessoa, que hoje mora **no mesmo bucket** por decisão da migração
 * de 2026-11-07 — e que a definição de `CLASSES.PUBLICO` ("não identifica
 * ninguém") não cobre. Ver `tetoDaAssinatura`.
 */
export const VALIDADE_MAXIMA_DO_PUBLICO = 7 * 24 * 60 * 60

/**
 * O trecho de chave que denuncia um retrato de pessoa dentro do bucket público.
 *
 * `chaveDoRetrato` produz `<unidade>/retratos/<sujeito>/<id>.<ext>`, e o único
 * sujeito que é uma pessoa é `usuario` — `agente` é ativo de marca. O trecho
 * leva as duas barras de propósito: `retratos/usuarios-arquivados/` não casa.
 */
export const TRECHO_DE_PESSOA = '/retratos/usuario/'

/**
 * Até quando a assinatura desta referência pode valer.
 *
 * Função pura, e o desvio é por **classe e chave**, não por chamador — mesma
 * razão de `provedorDa`: rota nova que copie a linha da vizinha não consegue
 * pedir uma semana para o rosto de uma pessoa atendida.
 *
 * O ramo da chave não é elegante e é honesto. A classe `PUBLICO` deveria
 * bastar, mas desde a migração dos retratos ela guarda duas coisas diferentes:
 * ativo de marca e rosto de gente. Enquanto isso durar, o prefixo é o que as
 * separa. O conserto de verdade é o retrato sair desta classe — e aí este ramo
 * morre junto com o `TRECHO_DE_PESSOA`.
 *
 * Note que o endereço assinado de um retrato **não vai ao navegador**:
 * `/api/retratos` o usa para um `fetch` interno e devolve os bytes. Dez minutos
 * são folga para uma requisição, e assim nunca passa a existir um endereço de
 * uma semana para o rosto de alguém, nem usado nem guardado.
 */
export function tetoDaAssinatura(ref: Pick<Referencia, 'classe' | 'chave'>): number {
    // Qualquer classe que não seja a pública — a de conteúdo sensível, ou a
    // não-classificada, que nem deveria existir gravada — fica no teto curto.
    // O lado seguro de "não sei o que isto é" nunca é uma semana.
    if (ref.classe !== CLASSES.PUBLICO) return VALIDADE_MAXIMA_SEGUNDOS
    if (ref.chave.includes(TRECHO_DE_PESSOA)) return VALIDADE_MAXIMA_SEGUNDOS
    return VALIDADE_MAXIMA_DO_PUBLICO
}

/**
 * A validade que a assinatura vai realmente levar.
 *
 * Existe separada de `enderecoPara` para ser **provável sem credencial**. A
 * conta é um `Math.min` de três linhas, e é exatamente o tipo de conta que se
 * inverte numa refatoração sem nada ficar vermelho: invertida, ela entrega o
 * *pedido* do chamador em vez do teto, e aí `enderecoPara(retrato, 99999999)`
 * assina uma semana para o rosto de alguém. O teste de rede pegaria — se
 * rodasse, e ele é pulado aqui e no CI por falta de credencial de R2.
 *
 * Pedido ausente recebe o teto da classe. Pedido menor que o teto é respeitado:
 * teto é teto, não piso.
 */
export function validadeEfetiva(
    ref: Pick<Referencia, 'classe' | 'chave'>,
    pedido?: number
): number {
    const teto = tetoDaAssinatura(ref)
    return Math.min(pedido ?? teto, teto)
}

/**
 * O endereço para servir um objeto ao navegador.
 *
 * Público sai por URL direta e cacheável — é imagem de agente, e passar isso
 * pelo Worker gastaria invocação para servir byte que a borda serve melhor.
 *
 * Sensível sai por **URL assinada de validade curta**, e nunca é persistida.
 */
/**
 * Reconstrói uma `Referencia` a partir da classe e da chave.
 *
 * Existe para quem guardou só esses dois no banco e precisa assinar depois —
 * ver `lib/midia.ts`. O provedor e o bucket saem da classe, que é a única
 * coisa que decide destino neste adaptador.
 */
export function referenciaDe(classe: Classe, chave: string, contentType = ''): Referencia {
    const nome = provedorDa(classe)
    const { bucket } = provedor(nome)
    return { provedor: nome, bucket, chave, classe, contentType }
}

/**
 * O endereço de uma referência.
 *
 * `validadeSegundos` é **pedido**, não ordem: o teto real sai de
 * `tetoDaAssinatura`, e quem omite recebe o teto da própria classe. Antes o
 * padrão era `VALIDADE_MAXIMA_SEGUNDOS` fixo, e por isso ativo de marca e
 * conteúdo clínico viviam dez minutos cada — a confusão que esta mudança
 * desfaz.
 */
export async function enderecoPara(
    ref: Referencia,
    validadeSegundos?: number
): Promise<string> {
    if (ref.classe === CLASSES.PUBLICO) {
        const base = process.env.PUBLIC_STORAGE_BASE_URL?.trim()
        if (base) {
            const caminho = ref.chave.split('/').map(encodeURIComponent).join('/')
            return `${base.replace(/\/+$/, '')}/${caminho}`
        }
        /**
         * **Hoje este `if` nunca é verdadeiro, e isso tem dono.**
         *
         * `PUBLIC_STORAGE_BASE_URL` não é declarada em `cloudflare.config.ts`,
         * então `process.env` não a tem no Worker — nem poderia: medido em
         * 2026-11-06, o bucket do binding `PUBLICO` tem domínio gerenciado
         * (um `pub-….r2.dev`) mas com `enabled: false`. Não há endereço público
         * para apontar.
         *
         * O efeito é que **a classe pública também é assinada**. O que mudou em
         * 2026-11-07 é o prazo: ativo de marca passou a valer sete dias
         * (`VALIDADE_MAXIMA_DO_PUBLICO`), porque os 600 s eram cautela escrita
         * para conteúdo clínico e faziam a foto do agente sumir em aba aberta.
         * Retrato de pessoa continua em 600 s — ver `tetoDaAssinatura`.
         *
         * `/api/retratos` continua **servindo os bytes** em vez de redirecionar,
         * e por uma razão que o prazo não resolve: o endereço que o navegador
         * guarda tem de ser estável e cacheável por um ano, e assinatura
         * nenhuma é (ver `lib/retratos.ts`).
         *
         * ## Por que o domínio público não foi o caminho, medido em 2026-11-07
         *
         * O r2.dev gerenciado resolve em um clique, mas a Cloudflare limita a
         * taxa dele e não o recomenda em produção. O domínio próprio
         * (`cdn-<app>.venn360.com`) seria o certo — e **não cabe ainda**, por
         * duas medições:
         *
         *   - não há volume: o bucket público tem **um** arquivo por app (o
         *     avatar do agente), e os estáticos do Next vêm do binding `ASSETS`;
         *   - desde a migração dos retratos o bucket guarda **rosto de pessoa**,
         *     e domínio público abre o bucket inteiro. Separar o retrato desta
         *     classe é pré-requisito do domínio, não detalhe posterior.
         */
    }

    const { cliente } = provedor(ref.provedor)
    return cliente.urlAssinada(ref.bucket, ref.chave, validadeEfetiva(ref, validadeSegundos))
}
