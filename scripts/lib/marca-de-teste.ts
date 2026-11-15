/**
 * Uma marca fictícia, registrada no import — para os verificadores que
 * exercitam código do core.
 *
 * ## Por que é necessária
 *
 * Desde que o core passou a PEDIR a marca em vez de importá-la, quem roda
 * código dele tem de registrá-la primeiro. O app faz isso em
 * `src/marca-init.ts`, nos dois pontos de entrada. Um script de verificação não
 * tem ponto de entrada de app nenhum — e foi assim que o build reprovou em
 * 14/11, no `check:auth`:
 *
 *     MarcaNaoRegistradaError
 *       at BRAND (packages/core/src/marca.ts)
 *       at montarSchema (packages/core/src/config/app.ts)
 *       at APP (packages/core/src/config/app.ts)
 *       at construir (packages/core/src/lib/auth/better-auth.ts)
 *       at main (scripts/check-auth.ts)
 *
 * O `check-auth` chama `getAuth()`, que monta a configuração, que lê a marca.
 * Ele só reprovava no builder porque roda dentro das provas contra o Neon, que
 * pedem `NEON_API_KEY` e não rodam nesta máquina.
 *
 * ## Por que fictícia, e não a marca real de um app
 *
 * Um verificador que registrasse a marca do odontobox passaria a provar o
 * comportamento DAQUELE app, e o mesmo script tem de valer para os três. Pior:
 * `scripts/` é da raiz, e `audit:isolation --strict` reprova identificador de
 * app em qualquer arquivo — foi assim que ele barrou um `.npmrc` em 13/11 e um
 * comentário meu hoje. Uma marca inventada não pertence a app nenhum.
 *
 * Os valores existem só para satisfazer o contrato. Verificador que depender
 * do CONTEÚDO de algum deles está testando a marca, não o código — e aí o
 * lugar certo é um teste do próprio `brand.ts` do app.
 *
 * ## Como usar
 *
 * `import './lib/marca-de-teste.ts'` como PRIMEIRO import do script, pelo
 * mesmo motivo que no app: o import roda antes do corpo de quem importa, então
 * a marca já está registrada quando qualquer módulo do core for avaliado.
 * `check-marca.mjs` cobra a presença desta linha em todo script que importa de
 * `@venn/core`.
 */
import { registrarBrand } from '@venn/core/marca'
import type { Brand } from '@venn/config/marca'

export const MARCA_DE_TESTE: Brand = {
    slug: 'teste',
    name: 'Produto de Teste',
    tagline: 'Marca fictícia, usada só pelos verificadores',
    vendor: 'Fornecedor de Teste',
    appHost: 'teste.invalido',
    colors: {
        navy: '#0b1f3b',
        teal: '#0a5566',
        mint: '#06b6d4',
        ice: '#e8f4f8',
        surface: '#ffffff',
    },
    logo: {
        wordmarkLight: '/logos/logo-wordmark-light.png',
        wordmarkDark: '/logos/logo-wordmark-dark.png',
        iconLight: '/logos/logo-icon-light.png',
        iconDark: '/logos/logo-icon-dark.png',
    },
    favicon: '/favicon.ico',
    og: '/logos/logo-wordmark-light.png',
    emailFooter: 'Produto de Teste · marca fictícia',
    vocabulario: {
        genero: {
            organizacao: 'f',
            pessoa: 'f',
            profissional: 'm',
            servico: 'm',
        },
        organizacao: 'organização',
        Organizacao: 'Organização',
        organizacoes: 'organizações',
        Organizacoes: 'Organizações',
        pessoa: 'pessoa',
        Pessoa: 'Pessoa',
        pessoas: 'pessoas',
        Pessoas: 'Pessoas',
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

registrarBrand(MARCA_DE_TESTE)
