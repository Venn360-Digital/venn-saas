# E-015 Snippet
Product term: Snippet (Trecho) · Parent: none · Status: draft (observado no editor)

## Fields (observado — Settings > Trechos > Criar Snippet)
| Field | Type | Required | Default | Constraints or enum | Source |
|---|---|---|---|---|---|
| name | string | sim | — | "Nomeie seu Snippet (ex: saudação1)" | [obs EV-013] |
| fieldId (slug) | string | sim | — | "ID do campo" — identificador para inserção | [obs EV-013] |
| message | text | sim | — | conteúdo; inserido no Inbox digitando "/" | [obs EV-013] |
| topic | string | não | — | "Tópico (opcional)" (ex: Suporte, Vendas) — organiza/filtra | [obs EV-013] |
| file | file | não | — | "Enviar arquivo (opcional)" | [obs EV-013] |

Usado em: **Inbox, Broadcasts e Workflows** ("Crie respostas prontas a serem utilizadas na caixa de entrada, nos broadcasts e fluxos de trabalho"). Atalho no Inbox: Ctrl+S [doc SRC-009]. Serve de Knowledge Source para IA [doc SRC-004].

## Relations
| Relation | Target | Cardinality | On delete | Source |
|---|---|---|---|---|
| usado em | E-003 Message | o—N | — | [doc SRC-004] |
| alimenta | E-016 AIAgent (knowledge) | o—N | — | [doc SRC-004] |

## Lifecycle
Criado em Settings > Snippets; inserido no Inbox via atalho. A observar (F-019/F-083).

## System fields
| Field | Set when | Source |
|---|---|---|
| id | na criação | [obs EV-013] |

## Rules
- Pode servir de Knowledge Source para AI Agents/AI Assist [doc SRC-004].

## Not tested
- Variáveis dinâmicas dentro da mensagem; escopo (workspace vs usuário); limite de tamanho/anexo.
