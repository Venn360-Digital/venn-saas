/**
 * A FORMA da marca — sem nenhuma marca dentro.
 *
 * Este arquivo é contrato, não conteúdo. A `interface Brand` vive aqui para
 * que `packages/core` saiba o que uma marca tem sem conhecer marca alguma: o
 * valor concreto (`const BRAND`) mora em `apps/<app>/src/config/brand.ts`, e é
 * o app que o registra.
 *
 * É esta separação que sustenta a direção de dependências `apps → core →
 * config` sem o inverso — e é o que permite ao `audit:isolation` proibir
 * qualquer identificador de app dentro de `packages/**` sem abrir exceção.
 * Enquanto a interface morava junto do valor, o core teria de importar o
 * arquivo do app para saber o tipo, e a proibição seria impossível.
 *
 * Os comentários de cada campo vieram inteiros do arquivo de origem: eles
 * explicam POR QUE o campo existe (o `appHost` que nasceu de um domínio
 * inventado em produção, o `vocabulario` em dois eixos), e essa é a parte que
 * não se reconstrói depois.
 */

export interface Brand {
    /** Nome comercial, como aparece em aba, e-mail e UI. */
    name: string
    /** Descrição curta (meta description, rodapé). */
    tagline: string
    /** Operadora/holding, para o rodapé "uma solução X". */
    vendor: string
    /**
     * O host de produção, sem protocolo — `odontobox.venn360.com`.
     *
     * Existe porque a sugestão de URL do workspace, no passo 1 do cadastro, era
     * derivada de `NEXT_PUBLIC_APP_URL`: em produção a variável não está
     * gravada no Worker e a tela caía num `app.odontobox360.com.br` escrito à
     * mão, domínio que nunca existiu; num preview ela mostraria o host do
     * preview. O endereço do workspace é um fato da marca, não do ambiente onde
     * a tela está rodando — então vem daqui, que é o único lugar da identidade.
     */
    appHost: string
    colors: {
        navy: string
        teal: string
        mint: string
        ice: string
        surface: string
    }
    /** Caminhos servidos de `public/` (genéricos; sem o nome do produto no arquivo). */
    logo: {
        wordmarkLight: string
        wordmarkDark: string
        iconLight: string
        iconDark: string
    }
    favicon: string
    og: string
    emailFooter: string
    /**
     * Como o produto chama a organização do cliente.
     *
     * Decisão dele em 2026-11-05, ao aprovar os e-mails: cada produto fala a
     * palavra do seu nicho. É a palavra que aparece em frase corrida — "os
     * dados desta clínica" — e trocá-la não pode ser caçar string pelo código.
     *
     * Mora na marca e não num arquivo de tradução porque é identidade, não
     * idioma: o app inteiro é pt-BR, e o que muda entre os três é o nicho.
     */
    /**
     * As palavras do nicho, em QUATRO eixos.
     *
     * Eram dois — organização e pessoa atendida —, e a varredura de 14/11/2026
     * mostrou que o produto precisa de quatro: medidas 610 ocorrências em
     * `packages/`, distribuídas em 211 da pessoa atendida, 123 da organização,
     * **114 de quem presta o serviço** e **111 do que é vendido**. Os dois
     * eixos que faltavam não eram detalhe: são a navegação inteira do módulo de
     * vendas ("Especialistas", "Procedimentos").
     *
     * Quatro formas por eixo, escritas e não derivadas. Capitalizar em
     * português por `toUpperCase()` acerta "paciente" e erra qualquer caso em
     * que a palavra do nicho seja composta ou sigla — e o custo de escrever é
     * uma vez por app, contra um bug de rótulo que ninguém revisa.
     */
    vocabulario: {
        /**
         * O gênero gramatical de cada eixo, para a concordância.
         *
         * Medido antes de existir: **228 das 548 ocorrências** de palavra do
         * nicho em `packages/` vêm precedidas de determinante — 103 de artigo
         * definido, 74 de `de`+artigo, 27 de demonstrativo. 42% dos casos, não
         * uma borda.
         *
         * Sem isto, trocar a palavra quebra a frase: "abrir **o** paciente"
         * vira "**o** clínica" num nicho feminino, e "**a** clínica" vira
         * "**a** estúdio". O helper `comArtigo` em `core/lib/concordancia`
         * monta o determinante a partir daqui.
         *
         * É uma declaração do app e não uma dedução: "paciente" e "cliente" são
         * comuns de dois gêneros, e qual se usa é escolha de quem escreve o
         * produto, não do dicionário.
         */
        genero: {
            organizacao: 'm' | 'f'
            pessoa: 'm' | 'f'
            profissional: 'm' | 'f'
            servico: 'm' | 'f'
        }
        /** Quem assina o contrato: clínica, agência, empresa. */
        organizacao: string
        Organizacao: string
        organizacoes: string
        Organizacoes: string
        /**
         * Quem a organização atende: paciente, cliente, hóspede.
         *
         * **Eixo diferente do de cima.** `organizacao` é quem assina;
         * `pessoa` é quem é atendido.
         */
        pessoa: string
        Pessoa: string
        pessoas: string
        Pessoas: string
        /**
         * Quem presta o serviço: especialista, consultor, atendente.
         *
         * É o rótulo de `/vendas/profissionais` — a rota é neutra desde
         * 2026-11-11, e só o rótulo é do nicho.
         */
        profissional: string
        Profissional: string
        profissionais: string
        Profissionais: string
        /**
         * O que a organização vende: procedimento, pacote, serviço.
         *
         * Rótulo de `/vendas/servicos`, pela mesma razão.
         */
        servico: string
        Servico: string
        servicos: string
        Servicos: string
    }
}
