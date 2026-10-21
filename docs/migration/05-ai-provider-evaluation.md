# 05 — Provedores de IA

A IA está no projeto e é central: chat de atendimento, RAG, transcrição de áudio
e síntese de voz.

## Uso real, medido

| Função | Modelo hoje | Onde |
| --- | --- | --- |
| Resposta do agente | OpenAI chat | `workers/src/services/ai-reply.ts` |
| Embeddings do RAG | OpenAI, **1536 dimensões** | `workers/src/processors/rag-index.ts`, `src/lib/rag` |
| Transcrição de áudio | OpenAI | `workers/src/services/transcribe.ts` |
| Nota de voz do agente | OpenAI TTS | `workers/src/services/speech.ts` |
| Orquestração | `langchain` + `@langchain/openai` | `src/lib/llm`, `src/lib/rag` |

## Destino: AI Gateway com BYOK

O Gateway é **camada de controle** — observabilidade, limite, roteamento,
cache —, não o modelo. Muda-se a URL base; as chamadas continuam sendo da OpenAI
e pagas direto a ela. **Unified Billing fica desligado.**

| Tarefa | Provedor | Razão |
| --- | --- | --- |
| Chat / atendimento | **OpenAI** via Gateway | é o que está em produção e funciona |
| Pesquisa / análise | **Gemini** via Gateway | rota inicial aprovada |
| Embeddings | **OpenAI, sem alternativa** | ver abaixo |
| Transcrição e TTS | OpenAI via Gateway | TTS já tem custo medido por caractere |
| Workers AI | só comparar | eventual redução em classificação simples |

### Embeddings não se trocam sem reindexar — e isso não é detalhe

Os vetores em `KnowledgeChunk.embedding` são `vector(1536)` da OpenAI. Trocar o
modelo de embedding **invalida o índice inteiro**: as distâncias deixam de ter
sentido e a busca passa a devolver resultado plausível e errado, que é o pior
modo de falha possível — ninguém percebe.

Se um dia trocar: reindexar tudo, numa coluna nova, com troca atômica. Nunca no
lugar.

### "Gemini para pesquisa" não dá acesso à web

Escolher o Gemini **não** concede busca na internet. Se o recurso precisar de
web, exige ferramenta de busca/grounding explícita. Hoje o RAG pesquisa a
**base da clínica**, não a web — e para isso o pgvector basta e o Gemini é
desnecessário. Confirmar qual recurso realmente precisa de web antes de ligar
qualquer coisa.

## Privacidade — o item mais frágil hoje

A política é clara: só entrada minimizada e anonimizada; nada de dado de
paciente identificável para provedor externo.

**O código atual não cumpre isso.** `conversation-context.ts` monta o histórico
da conversa e o envia ao modelo — e o histórico de uma conversa de clínica **é**
conteúdo de paciente: nome, telefone, queixa, às vezes foto.

Isso não é configuração, é projeto. O que precisa existir:

1. **Filtro antes da chamada**, não depois: varre nome, telefone, CPF, e-mail e
   endereço, e substitui por marcador estável (`<PACIENTE_1>`) para que o modelo
   mantenha a coerência do diálogo sem receber o identificador.
2. **Bloqueio quando o filtro não tem confiança.** Se não é possível remover com
   segurança, a chamada **não acontece**. Degradar é melhor que vazar.
3. **Registrar a recusa sem registrar o conteúdo**: motivo e contagem, nunca o
   texto.
4. **Nenhum prompt ou resposta sensível em log**, e isso inclui o log do AI
   Gateway — conferir o que ele retém antes de ligar.

> Pseudonimização simples **não** é anonimização. Substituir nome por `P1` e
> deixar telefone e endereço no texto não anonimiza nada. O filtro tem de ser
> avaliado pelo conjunto, não campo a campo.

Mudar essa política exige aprovação expressa e revisão jurídica.

## Benchmark a fazer

Casos sintéticos, nunca dado real. Medir: qualidade, latência p50/p95, tokens,
custo por atendimento, rate limit e comportamento em falha.

- [ ] OpenAI chat via Gateway × direto — latência adicional do Gateway
- [ ] Gemini em análise, se houver caso que o justifique
- [ ] Workers AI em classificação simples (triagem de intenção)
- [ ] o filtro de PHI: conjunto de casos que **devem** ser bloqueados, e a prova
      de que são
- [ ] custo real contra o modelo de crédito já implantado
