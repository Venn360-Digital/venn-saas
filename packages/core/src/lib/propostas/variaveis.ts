/**
 * Os marcadores `{{...}}` que um documento aceita — agora em **grupos**.
 *
 * ## O que mudou em 22/11/2026, e por quê
 *
 * A v1 tinha dez marcadores soltos, escritos à mão (`{{cliente}}`,
 * `{{total}}`…). A v2 deriva os marcadores **dos campos do sistema**, em
 * grupos: `cliente.nome`, `organizacao.cnpj`, `documento.total`,
 * `negocio.etapa`, `responsavel.email` — e os campos personalizados do contato
 * entram sozinhos, pelo nome que a organização lhes deu.
 *
 * Os dez antigos continuam funcionando como **apelidos** (`{{cliente}}` ≡
 * `{{cliente.nome}}`): modelo editado à mão na v1 não quebra.
 *
 * ## A sintaxe não aparece na tela
 *
 * Regra do André, ao ver a primeira versão do editor: *"esse formato assusta
 * quem é leigo; um erro de digitação e a variável quebra."* Então o token é
 * assunto deste módulo e do servidor. O editor mostra um **objeto** com o valor
 * dentro, inserido por @ ou pelo botão, e grava o token por conta própria — a
 * pessoa nunca digita `{{`. Por isso aqui existe o `REGISTRO`, com rótulo
 * humano por campo: é o que a paleta do @ mostra.
 *
 * ## O que NÃO muda
 *
 * A regra de substituição é a de `lib/email/blocos.ts`, importada: marcador
 * desconhecido fica **visível**, substituição vazia engole a pontuação órfã.
 * `{{itens}}` continua sendo o único que não é texto — resolve para a tabela, e
 * por isso é tratado em `render.ts`.
 */
import { substituirMarcadores } from '../email/blocos'

// ── os grupos ──────────────────────────────────────────────────────────

export const GRUPOS = ['cliente', 'organizacao', 'documento', 'negocio', 'responsavel'] as const
export type Grupo = (typeof GRUPOS)[number]

export const ROTULO_DO_GRUPO: Record<Grupo, string> = {
    cliente: 'Cliente',
    organizacao: 'Organização',
    documento: 'Documento',
    negocio: 'Negócio',
    responsavel: 'Responsável',
}

/**
 * Os campos de cada grupo, com o rótulo que a paleta mostra.
 *
 * Derivado dos campos que o banco tem (`Contact`, `Workspace`/`Account`,
 * `Proposal`/`ProposalRevision`, `Deal`, `User`) — não é lista livre. Campo
 * novo no sistema entra aqui no mesmo commit, ou não existe para o documento.
 *
 * `cliente.*` é a única lista aberta: os personalizados são acrescentados em
 * tempo de execução por `variaveisPersonalizadas`.
 */
export const REGISTRO: Record<Grupo, Record<string, string>> = {
    cliente: {
        nome: 'Nome',
        primeiro_nome: 'Primeiro nome',
        telefone: 'Telefone',
        email: 'E-mail',
    },
    organizacao: {
        nome: 'Nome',
        cnpj: 'CNPJ',
        endereco: 'Endereço',
        telefone: 'Telefone',
    },
    documento: {
        numero: 'Número',
        titulo: 'Título',
        tipo: 'Tipo',
        data: 'Data de emissão',
        validade: 'Validade',
        total: 'Total',
        subtotal: 'Subtotal',
        desconto: 'Desconto',
        observacao: 'Observação',
    },
    negocio: {
        titulo: 'Título',
        valor: 'Valor',
        etapa: 'Etapa',
        criado_em: 'Criado em',
    },
    responsavel: {
        nome: 'Nome',
        email: 'E-mail',
        telefone: 'Telefone',
        /** Quem executa, quando o negócio tem um — o `profissional` da v1. */
        profissional: 'Profissional',
    },
}

/**
 * Os dez marcadores da v1, e para onde cada um aponta.
 *
 * Apelido, não cópia: resolvem para o mesmo valor do campo novo. Ficam para
 * sempre — modelo escrito à mão é dado da organização, e dado não se quebra
 * numa atualização.
 */
export const APELIDOS: Record<string, string> = {
    cliente: 'cliente.nome',
    organizacao: 'organizacao.nome',
    numero: 'documento.numero',
    titulo: 'documento.titulo',
    data: 'documento.data',
    validade: 'documento.validade',
    total: 'documento.total',
    subtotal: 'documento.subtotal',
    desconto: 'documento.desconto',
    observacao: 'documento.observacao',
    responsavel: 'responsavel.nome',
    profissional: 'responsavel.profissional',
}

/** O marcador da tabela de itens, tratado à parte porque resolve para HTML. */
export const MARCADOR_DE_ITENS = 'itens'

// ── o contexto e o mapa achatado ───────────────────────────────────────

/** Um grupo de valores. `null` é "não há" — e aparece vazio, engolindo a pontuação. */
export type ValoresDoGrupo = Record<string, string | null | undefined>

/**
 * Tudo o que o documento sabe, por grupo.
 *
 * Todos opcionais: o rascunho existe antes de ter cliente, valor ou validade,
 * e a prévia tem de funcionar com ele pela metade.
 */
export interface ContextoDeVariaveis {
    cliente?: ValoresDoGrupo
    organizacao?: ValoresDoGrupo
    documento?: ValoresDoGrupo
    negocio?: ValoresDoGrupo
    responsavel?: ValoresDoGrupo
}

/**
 * O nome técnico de um campo personalizado, a partir do rótulo que a
 * organização deu.
 *
 * "Data de nascimento" → `data_de_nascimento`. Sem acento, sem espaço, sem
 * maiúscula: é o que cabe dentro de `{{cliente.data_de_nascimento}}`. A pessoa
 * nunca vê este nome — a paleta mostra o rótulo original.
 */
export function chaveDeCampo(rotulo: string): string {
    return rotulo
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 40)
}

/**
 * Os campos personalizados do contato, como variáveis do grupo `cliente`.
 *
 * Devolve chave → rótulo (para a paleta) e chave → valor (para o render).
 * Campo cujo nome vira chave vazia ou colide com um fixo é ignorado — `nome`
 * personalizado não pode sombrear `cliente.nome`.
 */
export function variaveisPersonalizadas(
    customFields: unknown
): { rotulos: Record<string, string>; valores: ValoresDoGrupo } {
    const rotulos: Record<string, string> = {}
    const valores: ValoresDoGrupo = {}
    if (!customFields || typeof customFields !== 'object' || Array.isArray(customFields)) {
        return { rotulos, valores }
    }
    for (const [rotulo, bruto] of Object.entries(customFields as Record<string, unknown>)) {
        const chave = chaveDeCampo(rotulo)
        if (!chave || chave in REGISTRO.cliente) continue
        // Só escalar vira variável: lista ou objeto não cabem numa frase, e
        // oferecê-los na paleta seria oferecer um campo que renderiza vazio.
        const escalar = bruto === null || bruto === undefined || ['string', 'number', 'boolean'].includes(typeof bruto)
        if (!escalar) continue
        rotulos[chave] = rotulo
        valores[chave] = bruto === null || bruto === undefined ? null : String(bruto)
    }
    return { rotulos, valores }
}

/**
 * O contexto em grupos → o mapa plano que o motor de substituição lê.
 *
 * Chaves `grupo.campo` para tudo, mais os apelidos da v1 apontando para o
 * mesmo valor. É aqui que `{{cliente}}` e `{{cliente.nome}}` viram a mesma
 * coisa — numa função só, para não divergirem.
 */
export function achatarVariaveis(ctx: ContextoDeVariaveis): Record<string, string | null | undefined> {
    const plano: Record<string, string | null | undefined> = {}
    for (const grupo of GRUPOS) {
        const valores = ctx[grupo] ?? {}
        for (const [campo, valor] of Object.entries(valores)) plano[`${grupo}.${campo}`] = valor
    }
    for (const [apelido, destino] of Object.entries(APELIDOS)) plano[apelido] = plano[destino]
    return plano
}

/**
 * Os marcadores que existem, para `substituirMarcadores` saber o que trocar.
 *
 * Tudo o que está no registro, os apelidos, e os personalizados do contexto
 * (que só existem em tempo de execução). O que não está aqui fica **visível**
 * no texto, por desenho — é como quem revisa a prévia vê um erro de digitação.
 */
function padroesDeQueda(ctx: ContextoDeVariaveis): Record<string, string> {
    const padroes: Record<string, string> = {}
    for (const grupo of GRUPOS) {
        for (const campo of Object.keys(REGISTRO[grupo])) padroes[`${grupo}.${campo}`] = ''
        // os personalizados — e qualquer outro campo que o contexto trouxe
        for (const campo of Object.keys(ctx[grupo] ?? {})) padroes[`${grupo}.${campo}`] = ''
    }
    for (const apelido of Object.keys(APELIDOS)) padroes[apelido] = ''
    return padroes
}

/** Troca os marcadores pelos valores. `{{itens}}` não passa por aqui — ver `render.ts`. */
export function aplicarVariaveis(texto: string, ctx: ContextoDeVariaveis): string {
    return substituirMarcadores(texto, achatarVariaveis(ctx), padroesDeQueda(ctx))
}

// ── o que a tela e o verificador perguntam ─────────────────────────────

/** Todos os marcadores conhecidos sem contexto: registro + apelidos. */
export const MARCADORES: readonly string[] = [
    ...GRUPOS.flatMap((g) => Object.keys(REGISTRO[g]).map((c) => `${g}.${c}`)),
    ...Object.keys(APELIDOS),
]

/**
 * A ajuda por marcador — "Cliente · Nome".
 *
 * Mora aqui e não no componente porque campo novo tem de aparecer na ajuda no
 * mesmo commit em que passa a funcionar.
 */
export const AJUDA_DO_MARCADOR: Record<string, string> = Object.fromEntries([
    ...GRUPOS.flatMap((g) =>
        Object.entries(REGISTRO[g]).map(([c, rotulo]) => [`${g}.${c}`, `${ROTULO_DO_GRUPO[g]} · ${rotulo}`])
    ),
    ...Object.entries(APELIDOS).map(([a, destino]) => [a, `o mesmo que {{${destino}}}`]),
])

/**
 * O marcador existe? Aceita os do registro, os apelidos e — com o contexto —
 * os personalizados.
 */
export function ehMarcador(nome: string, ctx?: ContextoDeVariaveis): boolean {
    if (nome === MARCADOR_DE_ITENS) return true
    if (MARCADORES.includes(nome)) return true
    if (!ctx) return false
    const ponto = nome.indexOf('.')
    if (ponto < 0) return false
    const grupo = nome.slice(0, ponto) as Grupo
    return nome.slice(ponto + 1) in (ctx[grupo] ?? {})
}

/**
 * Os marcadores que o texto usa, na ordem em que aparecem, sem repetir.
 *
 * A expressão é a mesma de `substituirMarcadores`, deliberadamente: o que a
 * prévia lista tem de ser exatamente o que o motor reconhece — com o ponto.
 */
export function marcadoresCitados(texto: string): string[] {
    const achados = new Set<string>()
    for (const m of texto.matchAll(/\{\{\s*([\w.]+)\s*(?:\|[^}]*)?\}\}/g)) {
        achados.add(m[1])
    }
    return [...achados]
}
