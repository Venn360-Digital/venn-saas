/**
 * Os manifestos de infraestrutura, um por app.
 *
 * ## Por que um arquivo por app, e não um `manifest.json` com `apps: {}`
 *
 * A regra 1 do `audit-isolation` proíbe o manifesto de conter string que
 * pertence a OUTRO app. Num arquivo único os três apps estariam no mesmo JSON e
 * a regra reprovaria em massa — exigindo uma segunda reescopagem, logo depois
 * da que o PR #223 fez para `apps/<pasta>/`. Com um arquivo por app o dono vem
 * do NOME DO ARQUIVO, que é a mesma derivação já implementada e provada ali, e
 * espelha `infra/fingerprints/<slug>.json`, cujos consumidores já tratam N
 * arquivos.
 *
 * De carona, a regra 3 passa a comparar o `cloudflare.config.ts` do app X só
 * com o manifesto do app X. Com um manifesto só, um config podia citar o ID de
 * Durable Object de outro app e passar.
 *
 * ## O nome do arquivo e o `app.slug` TÊM de concordar
 *
 * Se `odontobox.json` declarasse `slug: 'stagent'`, o dono derivado do nome e o
 * dono declarado dentro divergiriam — e as regras que escopam por dono passariam
 * a proteger o app errado, caladas. É erro, não aviso.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/** Caminho literal: tem de falhar ALTO se a pasta sair do lugar. */
const PASTA = 'infra/manifest'

/**
 * Os dois ambientes que todo app tem. Estava escrito dentro do
 * `audit-isolation`; mora aqui porque agora três consumidores dependem da
 * mesma garantia.
 */
const AMBIENTES = ['production', 'stg']

function aborta(msg, dica) {
    console.error(`✖ ${msg}`)
    if (dica) console.error(`  ${dica}`)
    process.exit(2)
}

let cache = null

/**
 * Todos os manifestos: `[{ slug, caminho, dados }]`, ordenados pelo slug.
 *
 * Reprova se a pasta não existir, se estiver vazia, se um arquivo não declarar
 * o próprio nome em `app.slug` ou se faltar um dos dois ambientes. Pasta vazia
 * é o caso que importa: uma lista vazia faria todo laço sobre ela terminar sem
 * olhar nada e reportar sucesso.
 */
export function manifestos() {
    if (cache) return cache

    if (!existsSync(PASTA)) {
        aborta(
            `${PASTA}/ não existe.`,
            'O manifesto de infraestrutura é um arquivo por app, `<slug>.json`. Sem a pasta, as regras que escopam por app não têm o que verificar — e passariam caladas.'
        )
    }

    const arquivos = readdirSync(PASTA).filter((f) => f.endsWith('.json')).sort()
    if (arquivos.length === 0) aborta(`${PASTA}/ está vazia — nenhum manifesto para verificar.`)

    const lista = arquivos.map((f) => {
        const caminho = join(PASTA, f)
        const slug = f.replace(/\.json$/, '')
        let dados
        try {
            dados = JSON.parse(readFileSync(caminho, 'utf8'))
        } catch (e) {
            aborta(`${caminho} não é JSON válido: ${e.message}`)
        }
        if (dados?.app?.slug !== slug) {
            aborta(
                `${caminho} declara app.slug "${dados?.app?.slug}", que não é o nome do arquivo ("${slug}").`,
                'O dono de cada regra é derivado do nome do arquivo; divergir faria as regras protegerem o app errado, em silêncio.'
            )
        }
        const faltando = AMBIENTES.filter((a) => !dados.environments?.[a])
        if (faltando.length) {
            aborta(`${caminho} não declara o ambiente ${faltando.join(' nem ')}.`)
        }
        return { slug, caminho, dados }
    })

    cache = lista
    return lista
}

/** O manifesto de um app, com fail-fast e a lista do que existe. */
export function manifestoDoApp(slug) {
    const achado = manifestos().find((m) => m.slug === slug)
    if (!achado) {
        aborta(
            `não há manifesto para o app "${slug}".`,
            `Existem: ${manifestos().map((m) => m.slug).join(', ')}. Crie ${join(PASTA, `${slug}.json`)}.`
        )
    }
    return achado
}

/** Os slugs, para mensagem de erro e para laços. */
export function slugsComManifesto() {
    return manifestos().map((m) => m.slug)
}
