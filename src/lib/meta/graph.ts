/**
 * A versão da Graph API, num lugar só.
 *
 * Fixada em vez de "mais recente": a Meta descontinua versão por data, e uma
 * chamada que muda de comportamento sozinha num sábado é o pior tipo de defeito.
 *
 * Vale para o WhatsApp e para o Instagram — os dois falam com a mesma Graph, e
 * subir a versão de um sem o outro deixaria a aplicação testada numa e rodando
 * na outra.
 */
export const GRAPH = 'https://graph.facebook.com/v23.0'
