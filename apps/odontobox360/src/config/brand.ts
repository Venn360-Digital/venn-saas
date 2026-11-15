/**
 * Marca do produto — ESTÁTICO, por app. Único lugar com a identidade visual e
 * textual. Duplicar o produto para outro nicho é trocar ESTE arquivo (e os
 * assets em `public/brand/`), não caçar strings pelo código.
 *
 * Sem `server-only`: é lido tanto no servidor quanto em componentes `'use
 * client'` (ex.: `DocumentTitle`). Por isso só carrega constantes — nada de
 * segredo ou env de servidor aqui (isso vive em `app.config.ts`).
 *
 * Os valores abaixo são os ATUAIS da OdontoBox360 (Fase 01, inventário A9).
 * Trocá-los não muda comportamento enquanto forem os mesmos de hoje.
 */

import type { Brand } from '@venn/config/marca'

export type { Brand }

export const BRAND: Brand = {
    name: 'OdontoBox360',
    tagline: 'Atendimento, agenda e CRM para clínicas odontológicas',
    vendor: 'Venn360',
    appHost: 'odontobox.venn360.com',
    colors: {
        navy: '#0b1f3b',
        teal: '#06b6d4',
        mint: '#a7f3d0',
        ice: '#e6f7f5',
        surface: '#f8fbfd',
    },
    // Hoje os arquivos vivem em `/logos/` com nomes de marca. Mantidos aqui para
    // não mover assets em produção nesta fase; a migração para `/brand/` com
    // nomes genéricos é um passo da clonagem (Fase 05), onde é testável.
    logo: {
        wordmarkLight: '/logos/logo-wordmark-light.png',
        wordmarkDark: '/logos/logo-wordmark-dark.png',
        iconLight: '/logos/logo-icon-light.png',
        iconDark: '/logos/logo-icon-dark.png',
    },
    favicon: '/favicon.ico',
    og: '/logos/logo-wordmark-light.png',
    emailFooter: 'OdontoBox360 · atendimento, agenda e CRM para clínicas odontológicas',
    vocabulario: {
        genero: {
            organizacao: 'f',
            pessoa: 'm',
            profissional: 'm',
            servico: 'm',
        },
        organizacao: 'clínica',
        Organizacao: 'Clínica',
        organizacoes: 'clínicas',
        Organizacoes: 'Clínicas',
        pessoa: 'paciente',
        Pessoa: 'Paciente',
        pessoas: 'pacientes',
        Pessoas: 'Pacientes',
        profissional: 'profissional',
        Profissional: 'Especialista',
        profissionais: 'profissionais',
        Profissionais: 'Especialistas',
        servico: 'servico',
        Servico: 'Procedimento',
        servicos: 'servicos',
        Servicos: 'Procedimentos',
    },
}
