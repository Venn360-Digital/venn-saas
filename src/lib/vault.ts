import prisma from '@/lib/prisma'

/**
 * Os segredos da plataforma, cifrados no Supabase Vault.
 *
 * O Vault guarda o valor cifrado dentro do próprio Postgres, com a chave fora da
 * tabela, e só devolve em claro pela view `vault.decrypted_secrets`. Medido nesta
 * instalação em 2026-10-16: extensão `supabase_vault` 0.3.1 instalada, e o
 * usuário do app cria, lê decifrado e apaga sem precisar de papel extra.
 *
 * **Por que não variável de ambiente.** Numa instalação auto-hospedada, o `.env`
 * é um arquivo de texto puro no mesmo disco do banco, lido por quem tem root —
 * exatamente quem já lê o banco. Ele não é "protegido como chave secreta" como
 * seria na Vercel ou no Supabase gerenciado; é protegido como arquivo de root,
 * que é outra coisa. E voltar as credenciais para lá reintroduziria o que as
 * tirou de lá: cada provedor novo vira tarefa de deploy.
 *
 * **Por que não texto puro na tabela**, que é onde estavam. O que o Vault
 * resolve são os vetores que **não** exigem root e que são os prováveis: um dump
 * do banco, uma consulta ampla demais, um log de query, uma credencial de banco
 * vazada. Contra alguém com root nada disto adianta — nem `.env`, nem Vault, nem
 * cofre externo rodando na mesma máquina.
 *
 * O `clientId` **não** passa por aqui: ele é público, vai para o navegador de
 * qualquer jeito, e guardar valor público num cofre só faz parecer que ele é
 * secreto.
 */

interface SecretRow {
    id: string
    decrypted_secret: string | null
}

/** Lê um segredo pelo nome. Nulo quando não existe. */
export async function readVaultSecret(name: string): Promise<string | null> {
    const rows = await prisma.$queryRaw<SecretRow[]>`
        SELECT id::text, decrypted_secret
        FROM vault.decrypted_secrets
        WHERE name = ${name}
        LIMIT 1
    `
    return rows[0]?.decrypted_secret ?? null
}

/**
 * Grava um segredo, criando ou substituindo.
 *
 * `create_secret` recusa nome repetido, então a substituição passa pelo
 * `update_secret` com o id existente — é a API que a 0.3.1 oferece.
 */
export async function writeVaultSecret(
    name: string,
    value: string,
    description: string
): Promise<void> {
    const rows = await prisma.$queryRaw<{ id: string }[]>`
        SELECT id::text FROM vault.secrets WHERE name = ${name} LIMIT 1
    `
    const existing = rows[0]?.id

    if (existing) {
        await prisma.$queryRaw`
            SELECT vault.update_secret(${existing}::uuid, ${value}, ${name}, ${description})
        `
        return
    }

    await prisma.$queryRaw`
        SELECT vault.create_secret(${value}, ${name}, ${description})
    `
}

/** Remove um segredo. Silencioso quando ele não existe. */
export async function deleteVaultSecret(name: string): Promise<void> {
    await prisma.$executeRaw`DELETE FROM vault.secrets WHERE name = ${name}`
}

/**
 * Se o segredo existe, **sem decifrá-lo**.
 *
 * A tela só precisa saber se está configurado, e decifrar um segredo para
 * responder "sim" é trazer o valor em claro para a memória do processo sem
 * necessidade.
 */
export async function vaultSecretExists(name: string): Promise<boolean> {
    const rows = await prisma.$queryRaw<{ um: number }[]>`
        SELECT 1 AS um FROM vault.secrets WHERE name = ${name} LIMIT 1
    `
    return rows.length > 0
}

/** O nome do segredo de um provedor de plataforma, num lugar só. */
export function platformSecretName(provider: string): string {
    return `platform:${provider}:clientSecret`
}
