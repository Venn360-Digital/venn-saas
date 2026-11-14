import 'server-only'
import type { Prisma } from '@venn/db'
import prisma from '@venn/db/cliente'
import { definidoNoAmbiente, nomeDeAmbiente, segredoDeAmbiente } from './secrets/ambiente'
import { cifrar, decifrar } from './secrets/envelope'

/**
 * Os segredos da plataforma.
 *
 * **O que mudou na ida para Cloudflare + Neon.** Até 2026-10-21 isto era o
 * A extensão de cofre da plataforma anterior guardava o valor cifrado dentro do próprio
 * Postgres e devolvia em claro pela view `vault.decrypted_secrets`. O Neon não
 * tem essa extensão nem `pgsodium` — conferido em `pg_available_extensions`
 * do projeto real —, então o cofre foi reconstruído em duas metades, e a divisão
 * não é arbitrária: ela segue quem precisa **gravar**.
 *
 * 1. **Segredo de plataforma → Cloudflare Secrets.** Os cinco segredos medidos
 *    na VPS (apps da Meta, do Instagram Login e do Asaas) são globais e de valor
 *    fixo: identificam a Venn360 junto ao provedor e não variam por clínica.
 *    Isso é configuração de implantação, e o lugar dela é o cofre da plataforma
 *    de execução. Ver `lib/secrets/ambiente.ts` para o mapeamento de nomes.
 *
 * 2. **Segredo que a aplicação grava → tabela `app_secrets`, cifrado.**
 *    AES-256-GCM pelo WebCrypto, chave em Cloudflare Secrets, fora do banco.
 *    Ver `lib/secrets/envelope.ts`.
 *
 * **Por que o ambiente tem precedência, e por que a gravação é recusada em vez
 * de ignorada.** Com as duas metades, um mesmo nome poderia existir nos dois
 * lugares. Se a tabela vencesse, bastaria uma gravação para anular o secret da
 * plataforma — um downgrade de segurança feito por uma tela. Se o ambiente
 * vencesse em silêncio, a tela diria "salvo" e nada mudaria, que é pior: o
 * administrador iria embora acreditando ter rotacionado uma credencial. Então o
 * ambiente vence **e** `writeVaultSecret` lança `SegredoDeAmbienteError`, para
 * que a tela diga a verdade — este segredo é definido no deploy, trocá-lo exige
 * `wrangler secret put`.
 *
 * O `clientId` dos provedores OAuth **não** passa por aqui: ele é público, vai
 * para o navegador de qualquer jeito, e guardar valor público num cofre só faz
 * parecer que ele é secreto. O Asaas é a exceção e tem as duas metades no cofre,
 * porque nenhuma delas é pública — ver `platformSecretName`.
 */

/**
 * Tentativa de gravar um segredo que vem do ambiente.
 *
 * Carrega o nome da variável para que a mensagem da tela possa ser acionável:
 * quem a lê precisa saber **qual** `wrangler secret put` rodar.
 */
export class SegredoDeAmbienteError extends Error {
    readonly variavel: string

    constructor(nome: string) {
        const variavel = nomeDeAmbiente(nome)
        super(
            `"${nome}" é definido no Cloudflare Secrets (${variavel}) e não pode ser alterado pela aplicação; ` +
                `use "wrangler secret put ${variavel}" e publique`
        )
        this.name = 'SegredoDeAmbienteError'
        this.variavel = variavel
    }
}

/**
 * Lê um segredo pelo nome. Nulo quando não existe.
 *
 * Ambiente primeiro, tabela depois. Um envelope que não decifra conta como
 * **ausente**, não como erro: isso acontece quando a chave foi rotacionada e a
 * reescrita ainda não passou por esta linha, e a resposta certa nesse caso é a
 * tela pedir a credencial de novo — não o pedido inteiro falhar.
 */
export async function readVaultSecret(name: string): Promise<string | null> {
    const doAmbiente = segredoDeAmbiente(name)
    if (doAmbiente) return doAmbiente

    const linha = await prisma.appSecret.findUnique({
        where: { name },
        select: { value: true },
    })
    if (!linha) return null

    try {
        return await decifrar(linha.value)
    } catch {
        return null
    }
}

/**
 * Grava um segredo, criando ou substituindo.
 *
 * Recusa quando o nome é definido no ambiente — ver a nota do módulo.
 */
export async function writeVaultSecret(
    name: string,
    value: string,
    description: string
): Promise<void> {
    if (definidoNoAmbiente(name)) throw new SegredoDeAmbienteError(name)

    // O envelope é um objeto JSON fechado; o `InputJsonObject` do Prisma exige
    // assinatura de índice, que `Envelope` de propósito não tem — pôr uma ali
    // abriria a porta para campo escrito errado passar calado. A conversão fica
    // aqui, no único ponto que grava.
    const envelope = (await cifrar(value)) as unknown as Prisma.InputJsonObject

    await prisma.appSecret.upsert({
        where: { name },
        create: { name, value: envelope, description },
        update: { value: envelope, description },
    })
}

/**
 * Remove um segredo. Silencioso quando ele não existe.
 *
 * Só alcança a tabela: segredo de ambiente sai pelo `wrangler secret delete`, e
 * apagar a linha não faria o `readVaultSecret` deixar de encontrá-lo.
 */
export async function deleteVaultSecret(name: string): Promise<void> {
    if (definidoNoAmbiente(name)) throw new SegredoDeAmbienteError(name)
    await prisma.appSecret.deleteMany({ where: { name } })
}

/**
 * Se o segredo existe, **sem decifrá-lo**.
 *
 * A tela só precisa saber se está configurado, e decifrar um segredo para
 * responder "sim" é trazer o valor em claro para a memória do processo sem
 * necessidade.
 */
export async function vaultSecretExists(name: string): Promise<boolean> {
    if (definidoNoAmbiente(name)) return true

    const linha = await prisma.appSecret.findUnique({
        where: { name },
        select: { id: true },
    })
    return linha !== null
}

/**
 * De onde vem o segredo — para a tela poder dizer, e esconder o botão de salvar
 * quando não há o que salvar.
 *
 * `'ambiente'` é o estado bom: o segredo está no cofre da Cloudflare, cifrado em
 * repouso e fora do banco. `'banco'` é o estado gravável.
 */
export async function vaultSecretOrigin(name: string): Promise<'ambiente' | 'banco' | null> {
    if (definidoNoAmbiente(name)) return 'ambiente'
    return (await vaultSecretExists(name)) ? 'banco' : null
}

/**
 * O nome do segredo de um provedor de plataforma, num lugar só.
 *
 * O campo entra no nome porque há provedor com **dois** segredos e nenhuma
 * metade pública: o Asaas guarda a chave de API e o token do webhook, e os dois
 * precisam de nome próprio no cofre. O padrão continua `clientSecret` para que
 * os segredos já gravados dos provedores OAuth sigam sendo encontrados — e para
 * que o mapeamento para variável de ambiente permaneça estável.
 */
export function platformSecretName(provider: string, campo = 'clientSecret'): string {
    return `platform:${provider}:${campo}`
}
