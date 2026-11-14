/**
 * Onde o schema mora, para quem chama `prisma` da RAIZ do monorepo.
 *
 * Desde a Fase 2 (14/11/2026) o schema vive em `packages/db/prisma/`. O build
 * command do Workers Builds, porém, começa com `npx prisma generate` executado
 * na raiz — e isso é configuração do painel da Cloudflare, não do repositório.
 * Sem este arquivo o comando morre em "Could not find Prisma Schema", e o
 * build inteiro cai no primeiro passo (foi o que derrubou o preview do PR
 * #211).
 *
 * Preferi resolver aqui, e não pedindo uma edição no painel, por dois motivos:
 * o repositório passa a ser autossuficiente — quem clonar e rodar `prisma`
 * funciona sem saber da mudança —, e os comandos do painel continuam valendo
 * iguais para os três apps, que é o que mantém a configuração deles simétrica.
 */
import path from 'node:path'
import { existsSync } from 'node:fs'

import { defineConfig } from 'prisma/config'

/**
 * O `.env` volta a ser lido, de propósito.
 *
 * A simples existência deste arquivo faz o Prisma anunciar "Prisma config
 * detected, skipping environment variable loading" e parar de carregar o
 * `.env` — e o schema lê `url = env("DATABASE_URL")`. Em produção isso é
 * indiferente, porque o `migrate-guarded` injeta a URL no ambiente do
 * processo; mas nesta máquina `prisma migrate` e `prisma studio` passariam a
 * não achar o banco, com uma mensagem que não explica por quê.
 */
if (existsSync('.env')) process.loadEnvFile('.env')

export default defineConfig({
    schema: path.join('packages', 'db', 'prisma', 'schema.prisma'),
})
