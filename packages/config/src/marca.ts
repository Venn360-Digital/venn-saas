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
    /**
     * O identificador curto do produto — `odontobox`, e não `OdontoBox360`.
     *
     * É o que prefixa **nome de cookie** e **chave de armazenamento no
     * navegador**, e por isso é identidade de marca e não de ambiente.
     * `APP().slug` existe e vem do env: ele serve à trava de runtime, que
     * compara o que o Worker diz com o que o manifesto declara, para pegar
     * deploy cruzado. Dois propósitos, duas fontes — e `check:identidade`
     * afirma que concordam.
     *
     * Usado em lugar de `APP().slug` aqui porque o default daquele é string
     * **vazia**: um env não gravado daria o cookie `.workspace`, que não é o de
     * ninguém. `BRAND()` é fail-fast e não tem default.
     */
    slug: string
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
         * Quem presta o serviço: profissional, consultor, atendente.
         *
         * É o rótulo de `/vendas/profissionais` — a rota é neutra desde
         * 2026-11-11, e só o rótulo é do nicho.
         */
        profissional: string
        Profissional: string
        profissionais: string
        Profissionais: string
        /**
         * O que a organização vende: servico, pacote, serviço.
         *
         * Rótulo de `/vendas/servicos`, pela mesma razão.
         */
        servico: string
        Servico: string
        servicos: string
        Servicos: string
    }
    /**
     * Os fragmentos de RAMO com que um agente de IA novo nasce.
     *
     * ## Por que fragmentos, e não os textos inteiros
     *
     * Os quatro textos-semente (saudação, descrição do trabalho, descrição da
     * empresa, prompt de sistema) são compostos em
     * `core/types/agent-creation.ts`, a partir do vocabulário. O que o core
     * **não** pode saber é o ramo: que a oferta se chama "ortodontia" num
     * produto e "Canadá" noutro, e que o compromisso que o agente marca é uma
     * avaliação aqui e uma conversa inicial lá.
     *
     * Então o app declara só isso, e a ESTRUTURA do texto fica uma só nos três
     * — que é o ponto do monorepo. Um app futuro preenche seis campos em vez de
     * redigir quatro blocos de prosa, e nenhum deles pode esquecer um pedaço:
     * o compilador cobra.
     *
     * ## O defeito que isto conserta
     *
     * Até 18/11/2026 os quatro textos viviam no core com conteúdo
     * odontológico — "clínica **odontológica**", "ortodontia, implante",
     * "avaliação presencial", "se a pessoa relatar **dor**". `packages/core` é
     * compartilhado, então **todo agente criado no stagent e no conecta nascia
     * com instruções de clínica dentária**. Medido antes de consertar: os 5
     * agentes já existentes nos clones estavam limpos, então nenhum cliente foi
     * afetado — o defeito era latente, e pegava o próximo.
     */
    sementeDoAgente: {
        /**
         * O qualificador do ramo, como adjetivo ou locução — entra depois do
         * substantivo do vocabulário: "Clínica **odontológica**", "Agência **de
         * intercâmbio estudantil**".
         *
         * Vazio é válido e significa "não qualifica": num produto genérico,
         * "Empresa odontológica" seria errado e "Empresa" sozinho está certo.
         */
        ramo: string
        /**
         * O compromisso a que o agente conduz: o substantivo NU e o gênero.
         *
         * Nu porque a frase o usa em duas posições que pedem determinantes
         * diferentes — "agendamento de **uma** avaliação" e "agendar **sua**
         * avaliação". Guardá-lo com artigo serviria a uma e estragaria a outra.
         *
         * O gênero é DECLARADO, não deduzido, pela mesma razão que o do
         * vocabulário: terminação em -a não decide ("o dia"), e quem escreve o
         * produto sabe. Sem ele, "sua conversa inicial" viraria "seu conversa
         * inicial" em qualquer app que use substantivo masculino.
         */
        compromisso: { nome: string; genero: 'm' | 'f' }
        /** Sobre o que o agente tira dúvida: "tratamentos, valores e convênios". */
        duvidasSobre: string
        /**
         * Exemplos do que a organização oferece, para o cliente substituir —
         * por isso vêm entre colchetes, como o resto dos espaços a preencher:
         * "[especialidades: ortodontia, implante]", "[destinos: Canadá]".
         */
        exemplosDeOferta: string
        /**
         * O tipo de assunto que vai para a equipe humana, como adjetivo:
         * "clínico", "contratual". Entra em "quando o assunto for ___".
         */
        assuntoDaEquipe: string
        /**
         * Tópicos do TRABALHO próprios do ramo, um por linha, SEM o hífen.
         *
         * Irmão de `regrasDoRamo`, e a diferença é onde cada um cai: estes
         * entram na descrição do trabalho (o que o agente faz), aquelas no
         * prompt de sistema (como ele se comporta). Existe porque "confirmar se
         * a clínica atende o convênio da pessoa" é tarefa real num consultório
         * e não significa nada numa agência — e sem este campo o produto
         * odontológico perderia a linha ao sair do core.
         *
         * Vazio é válido: produto cujo trabalho não tem tarefa de nicho usa só
         * os tópicos comuns.
         */
        topicosDoRamo: readonly string[]
        /**
         * As regras de conduta próprias do ramo, uma por linha, SEM o hífen.
         *
         * Separadas das regras comuns (não inventar preço, pedir o nome uma
         * vez) porque essas valem em qualquer produto e vivem no core. Aqui
         * ficam as que só fazem sentido no ramo — "não prometa diagnóstico sem
         * avaliação presencial" não diz nada a uma agência.
         */
        regrasDoRamo: readonly string[]
    }
}
