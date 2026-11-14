import { z } from 'zod'

/**
 * A forma de um bloco de e-mail, validada na borda.
 *
 * `z.discriminatedUnion` e não `z.any()`: `blocks` é `Json` no banco, então
 * **esta é a única barreira** entre o que a tela manda e o que o renderizador
 * recebe. Sem ela, um bloco de tipo inventado atravessaria até o disparo e
 * sumiria calado em `lerBlocos` — a campanha sairia com um pedaço a menos e
 * ninguém seria avisado.
 *
 * Mora num arquivo próprio porque **criar e editar têm de aceitar exatamente a
 * mesma coisa**. Duas cópias divergiriam na primeira vez que um tipo de bloco
 * novo entrasse só numa delas, e o sintoma seria o editar recusar o que o criar
 * tinha acabado de gravar.
 *
 * As URLs são validadas aqui **e** escapadas no render (`urlSegura`, em
 * `lib/email/blocos.ts`). As duas, de propósito: esta recusa cedo e com
 * mensagem legível; aquela protege o que já está no banco, inclusive o que foi
 * gravado antes desta validação existir.
 */
export const blocoSchema = z.discriminatedUnion('tipo', [
    z.object({ tipo: z.literal('titulo'), texto: z.string().max(200) }),
    z.object({ tipo: z.literal('texto'), texto: z.string().max(5000) }),
    z.object({
        tipo: z.literal('imagem'),
        url: z.string().url('A imagem precisa de um endereço http(s)'),
        alt: z.string().max(200).optional(),
        link: z.string().url().optional(),
    }),
    z.object({
        tipo: z.literal('botao'),
        texto: z.string().min(1).max(60),
        url: z.string().url('O botão precisa de um endereço http(s)'),
    }),
    z.object({ tipo: z.literal('divisor') }),
])

/**
 * Teto de blocos num e-mail.
 *
 * Não é limite técnico — é que o Gmail corta a mensagem por volta de 102 KB
 * ("[Mensagem truncada]") e esconde justamente o fim, onde mora o link de
 * descadastro. E-mail cortado sem saída visível é o caminho curto para a
 * reclamação de spam.
 */
export const MAX_BLOCOS = 40
