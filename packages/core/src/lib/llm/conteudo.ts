import type { LLMConteudo } from '../../types/llm'

/**
 * O texto de um conteúdo que pode ser multimodal.
 *
 * Módulo próprio, e não uma função privada do adaptador OpenAI, porque **dois**
 * lugares precisam dela: a conversão para a API, que descarta imagem em papel
 * que não a aceita, e o console de ensaio, que devolve o prompt do sistema para
 * a tela mostrar. Duas cópias divergiriam na primeira vez que `LLMConteudo`
 * ganhasse uma terceira forma.
 */
export function textoDoConteudo(content: LLMConteudo): string {
    return typeof content === 'string' ? content : content.texto
}
