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
    slug: 'odontobox',
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
    /**
     * Os fragmentos de ramo com que um agente novo nasce. Ver a `interface
     * Brand` em `@venn/config/marca` para o que cada campo faz.
     *
     * Este é o texto que já existia no core desde a criação do fluxo, movido
     * para cá sem mudar uma palavra — ele está CERTO para este produto, e era
     * só o lugar que estava errado.
     */
    sementeDoAgente: {
        ramo: 'odontológica',
        compromisso: { nome: 'avaliação', genero: 'f' },
        duvidasSobre: 'tratamentos, valores e convênios',
        exemplosDeOferta: '[especialidades: ortodontia, implante, clínica geral]',
        assuntoDaEquipe: 'clínico',
        /*
         * Era um tópico do trabalho dentro do core, e saiu de lá na forma
         * NEUTRA: "atendemos" em vez de "a clínica atende". O original lia o
         * vocabulário, e aqui não há vocabulário para ler — a primeira pessoa
         * do plural dispensa o determinante e sobrevive a qualquer override de
         * unidade.
         */
        topicosDoRamo: ['Confirmar se atendemos o convênio da pessoa'],
        regrasDoRamo: [
            'Nunca prometa prazo, resultado ou diagnóstico sem avaliação presencial',
            'Se a pessoa relatar dor, acolha primeiro e ofereça encaixe no mesmo dia',
        ],
    },
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
        profissional: 'especialista',
        Profissional: 'Especialista',
        profissionais: 'especialistas',
        Profissionais: 'Especialistas',
        servico: 'procedimento',
        Servico: 'Procedimento',
        servicos: 'procedimentos',
        Servicos: 'Procedimentos',
    },
}
