import 'server-only'

import { CLASSES } from '@/lib/storage'
import { comoReferencia, enderecoDaMidia } from '@/lib/midia'

/**
 * O endereço utilizável da foto de um agente, cunhado na leitura.
 *
 * ## O defeito que isto fecha
 *
 * `POST /api/agents/[id]/avatar` gravava na coluna o retorno de `enderecoPara`.
 * Sem `PUBLIC_STORAGE_BASE_URL` configurado, aquela função **degrada para URL
 * assinada**, com validade máxima de 600 s. O efeito da cadeira é exatamente o
 * que o Andre relatou: a imagem aparece ao salvar — a assinatura acabou de
 * nascer — e some depois, na lista de agentes e no próprio Perfil, porque a
 * linha passou a apontar para um 403.
 *
 * Agora a coluna guarda `ref:publico:<chave>` e o endereço nasce aqui.
 *
 * ## A linha antiga, sem migração
 *
 * O que já está gravado é uma URL assinada vencida. Ela **não** é interpretada
 * como texto opaco: a chave do avatar é determinística — `<workspace>/agents/
 * <agente>.<ext>` — então basta reconhecer o sufixo no caminho e remontar a
 * referência. Isso faz a foto que já existe voltar a aparecer sem a clínica ter
 * de reenviá-la, e sem uma migração de dados para três linhas.
 *
 * Extensão desconhecida ou caminho que não casa: devolve o valor como está.
 * Perder o link é pior que devolver um que talvez funcione.
 */
const EXTENSOES = ['png', 'jpg', 'webp'] as const

export async function enderecoDoAvatar(
    agent: { id: string; workspaceId: string; avatar: string | null }
): Promise<string | null> {
    const valor = agent.avatar
    if (!valor) return null

    if (valor.startsWith('http')) {
        const legado = chaveLegada(valor, agent)
        if (!legado) return valor
        return enderecoDaMidia(comoReferencia({ classe: CLASSES.PUBLICO, chave: legado }))
    }

    return enderecoDaMidia(valor)
}

/** `…/<workspace>/agents/<agente>.png?X-Amz-…` → `<workspace>/agents/<agente>.png`. */
function chaveLegada(
    url: string,
    agent: { id: string; workspaceId: string }
): string | null {
    const caminho = url.split('?')[0]
    for (const ext of EXTENSOES) {
        if (caminho.endsWith(`/agents/${agent.id}.${ext}`)) {
            return `${agent.workspaceId}/agents/${agent.id}.${ext}`
        }
    }
    return null
}
