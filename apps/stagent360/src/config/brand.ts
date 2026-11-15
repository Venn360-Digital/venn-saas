/**
 * Marca do produto — ESTÁTICO, por app. Único lugar com a identidade visual e
 * textual. Duplicar o produto para outro nicho é trocar ESTE arquivo (e os
 * assets em `public/`), não caçar strings pelo código.
 *
 * Sem `server-only`: é lido tanto no servidor quanto em componentes `'use
 * client'` (ex.: `DocumentTitle`). Por isso só carrega constantes — nada de
 * segredo ou env de servidor aqui (isso vive em `app.config.ts`).
 *
 * ## De onde vieram estes valores
 *
 * Cores, nome, tagline, host e os dois primeiros eixos do vocabulário são os
 * que o produto já serve em produção, lidos do repositório próprio dele antes
 * da unificação — não foram escolhidos agora.
 *
 * Os dois eixos novos (`profissional` e `servico`) não existiam no contrato
 * anterior, que tinha só dois. Em vez de inventar palavra para tela de cliente,
 * foram MEDIDOS: o menu de vendas deste produto já exibe "Profissionais" e
 * "Serviços" hoje, então o vocabulário registra o que a tela mostra. Os quatro
 * gêneros são DECLARADOS e não deduzidos, porque "cliente" e "profissional" são
 * comuns de dois gêneros — nenhuma regra os derivaria.
 */

import type { Brand } from '@venn/config/marca'

export type { Brand }

export const BRAND: Brand = {
    slug: 'stagent',
    name: 'Stagent360',
    tagline: 'Atendimento, agenda e CRM',
    vendor: 'Venn360',
    appHost: 'stagent.venn360.com',
    colors: {
        navy: '#002050',
        teal: '#0057c2',
        mint: '#cfe0f7',
        ice: '#e7eefb',
        surface: '#f7f9fc',
    },
    // Os arquivos vivem em `/logos/` com nomes genéricos — nada do nome do
    // produto no nome do arquivo, que é o que permite ao core receber o caminho
    // por `BRAND.logo` sem embarcar asset de marca.
    logo: {
        wordmarkLight: '/logos/logo-wordmark-light.png',
        wordmarkDark: '/logos/logo-wordmark-dark.png',
        iconLight: '/logos/logo-icon-light.png',
        iconDark: '/logos/logo-icon-dark.png',
    },
    favicon: '/favicon.ico',
    og: '/logos/logo-wordmark-light.png',
    emailFooter: 'Stagent360 · atendimento, agenda e CRM',
    vocabulario: {
        genero: {
            organizacao: 'f',
            pessoa: 'm',
            profissional: 'm',
            servico: 'm',
        },
        organizacao: 'agência',
        Organizacao: 'Agência',
        organizacoes: 'agências',
        Organizacoes: 'Agências',
        pessoa: 'cliente',
        Pessoa: 'Cliente',
        pessoas: 'clientes',
        Pessoas: 'Clientes',
        profissional: 'profissional',
        Profissional: 'Profissional',
        profissionais: 'profissionais',
        Profissionais: 'Profissionais',
        servico: 'serviço',
        Servico: 'Serviço',
        servicos: 'serviços',
        Servicos: 'Serviços',
    },
}
