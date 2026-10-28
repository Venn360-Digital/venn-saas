/**
 * A base da API da OpenAI — o **único** lugar que sabe se o tráfego vai direto
 * ou pelo AI Gateway.
 *
 * Existem cinco chamadas à OpenAI neste app: o SDK (chat), os embeddings do
 * RAG, a transcrição de áudio, a síntese de voz e a prévia de voz da tela do
 * agente. Antes, cada uma montava a URL por conta própria — e um portão que
 * cobre quatro de cinco não é portão: a observabilidade que sustenta o débito
 * de crédito ficaria com um buraco exatamente onde ninguém olha.
 *
 * **O formato muda entre os dois destinos, e é por isso que a base é uma só.**
 * Direto, o caminho é `https://api.openai.com/v1/...`. Pelo portão, o `v1` do
 * provedor some e vira `.../{gateway}/openai/...`. Com a base unificada, quem
 * chama escreve sempre o mesmo sufixo (`/audio/speech`, `/chat/completions`) e
 * não precisa saber qual dos dois está em uso.
 *
 * O padrão é ir **direto**: sem a variável, o comportamento é o de antes. Isso
 * mantém o desenvolvimento local e qualquer ambiente sem gateway funcionando
 * sem configuração extra — e torna a adoção do portão uma mudança de
 * configuração, não de código.
 */
export const OPENAI_BASE_URL =
    process.env.OPENAI_BASE_URL?.replace(/\/+$/, '') || 'https://api.openai.com/v1'
