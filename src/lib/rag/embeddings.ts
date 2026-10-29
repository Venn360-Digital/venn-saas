import 'server-only'
import { OpenAIEmbeddings } from '@langchain/openai'
import { OPENAI_BASE_URL } from '@/lib/llm/base-url'

/**
 * O cliente de embedding do Cérebro — um só, para indexar e para buscar.
 *
 * Existia em duplicata: `embedder.ts` montava o seu e `retriever.ts` montava
 * outro, cada um declarando o modelo por conta própria. Dois defeitos nasciam
 * disso, e o segundo é grave:
 *
 *   - **O portão só via metade.** O indexador passava pelo AI Gateway e a busca
 *     ia direto ao provedor. A busca é a chamada de IA **mais frequente do
 *     sistema** — uma por mensagem recebida —, então o que ficava de fora do
 *     portão era justamente o maior volume: sem cache, sem teto de gasto e
 *     invisível na observabilidade.
 *   - **Trocar o modelo num lado e não no outro devolve lixo em silêncio.**
 *     Vetor de `3-small` comparado com vetor de outro modelo não dá erro: dá
 *     distância sem sentido. A busca continuaria respondendo, com os trechos
 *     errados, e o sintoma apareceria como "o agente não sabe o que está no
 *     Cérebro" — longe da causa.
 *
 * Com uma função só, os dois são impossíveis por construção: quem indexa e quem
 * busca recebem o mesmo modelo e o mesmo endereço, sempre.
 */

/**
 * O modelo que vetoriza o acervo.
 *
 * **Trocar isto obriga a reindexar tudo.** A dimensão do vetor está no schema
 * (`vector(1536)`) e os vetores já gravados não são convertíveis: um acervo
 * meio novo e meio velho é o caso de lixo silencioso descrito acima. A troca é
 * migração, não configuração — por isso é constante, e não variável de
 * ambiente.
 */
export const EMBEDDING_MODEL = 'text-embedding-3-small'

export function criarEmbeddings(): OpenAIEmbeddings {
    return new OpenAIEmbeddings({
        openAIApiKey: process.env.OPENAI_API_KEY,
        // Sem a variável, `OPENAI_BASE_URL` devolve o endereço do provedor e a
        // chamada vai direto — é o que mantém o desenvolvimento local de pé.
        configuration: { baseURL: OPENAI_BASE_URL },
        modelName: EMBEDDING_MODEL,
    })
}
