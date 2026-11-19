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
    slug: 'conecta',
    name: 'Conecta360',
    tagline: 'Atendimento, agenda e CRM',
    vendor: 'Venn360',
    appHost: 'conecta.venn360.com',
    colors: {
        navy: '#001030',
        teal: '#00a8ef',
        mint: '#bfeaff',
        ice: '#e6f6ff',
        surface: '#f6fbff',
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
    emailFooter: 'Conecta360 · atendimento, agenda e CRM',
    /**
     * Os fragmentos de ramo com que um agente novo nasce. Ver a `interface
     * Brand` em `@venn/config/marca` para o que cada campo faz.
     *
     * `ramo` é VAZIO de propósito: este produto não tem nicho, e qualificar a
     * organização ("Empresa de ...") seria inventar o negócio do cliente. O
     * texto sai estrutural, que é o certo aqui.
     */
    sementeDoAgente: {
        ramo: '',
        compromisso: { nome: 'conversa inicial', genero: 'f' },
        duvidasSobre: 'serviços, valores e formas de pagamento',
        exemplosDeOferta: '[serviços: o que a empresa oferece]',
        assuntoDaEquipe: 'contratual',
        /* Vazio, como o `ramo`: produto genérico não tem tarefa de nicho. */
        topicosDoRamo: [],
        regrasDoRamo: [
            'Nunca prometa prazo, resultado ou condição que não esteja na sua base de conhecimento',
        ],
    },
    vocabulario: {
        genero: {
            organizacao: 'f',
            pessoa: 'm',
            profissional: 'm',
            servico: 'm',
        },
        organizacao: 'empresa',
        Organizacao: 'Empresa',
        organizacoes: 'empresas',
        Organizacoes: 'Empresas',
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
