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
    vocabulario: {
        /** Minúscula, para o meio da frase. */
        organizacao: string
        /** Maiúscula, para início de frase e rótulo. */
        Organizacao: string
        /** Plural, para a tagline e o rodapé. */
        organizacoes: string
        /**
         * Quem a organização atende: paciente na odontologia, cliente nos
         * outros dois.
         *
         * **Eixo diferente do de cima.** `organizacao` é quem assina;
         * `pessoa` é quem é atendido. O produto inteiro ainda escreve
         * "paciente" literal em dezenas de telas — o que este campo faz é
         * impedir que o texto NOVO nasça com a palavra presa, para o próximo
         * ajuste replicar nos três sem reescrever.
         */
        pessoa: string
        pessoas: string
    }
}
