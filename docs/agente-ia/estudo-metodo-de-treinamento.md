<!--
Estudo escrito em 2026-10-30 a pedido do André; a comparação com o código é a
próxima etapa. Nasceu de ~/.claude/plans/vamos-iniciar-um-plano-hidden-finch.md,
mas **este arquivo é a versão canônica**: os produtos irmãos são citados de forma
genérica porque `npm run audit:isolation` (R12) reprova o nome deles neste repo.
Não regenere este arquivo copiando o plano por cima.
-->

# Estudo — o método para "treinar" um agente de atendimento com LLM

**Data:** 2026-10-30 · **Projeto:** OdontoBox360 (e, por clonagem, os dois
produtos irmãos — nomeá-los aqui reprova a auditoria de isolamento, R12)

## Contexto

O André pediu um estudo profundo, antes de qualquer código: qual é o melhor
método, e quais ferramentas, skills e MCPs são necessários para desenvolver o
**agente de treinamento de IA** — a disciplina pela qual uma clínica ensina o
seu agente de atendimento a responder bem, agir certo e melhorar com o uso.
Depois ele compara este desenho com o que já existe aqui.

Leitura do pedido: "treinar" não é fine-tuning. Em 2026, todos os produtos
de referência (Intercom Fin, Decagon, Sierra, respond.io, Chatwoot Captain)
treinam o agente **sem tocar nos pesos do modelo**. Treinar é: dar
conhecimento recuperável, dar regras de comportamento e procedimentos, dar
ferramentas com guardas, dar memória, **medir** e fechar o laço com o que
acontece em produção. O estudo cobre essas seis camadas e desenha o método
ideal para um agente de WhatsApp de clínica, rodando em Cloudflare Workers +
Neon, com crédito por ação entregue.

O que o estudo **não** é: não é a comparação com o código (vem depois, a
pedido dele). A seção 5 traz uma leitura inicial do terreno, e a seção 7 o
resultado de testar o desenho contra o código real — para a comparação
começar com os fatos na mesa.

Como foi feito: três levantamentos do repositório (runtime do agente;
treinamento, RAG e medição; documentação e engenharia reversa do respond.io),
pesquisa externa de 2026-10-30 (produtos de referência, literatura de RAG,
avaliação e memória, documentação da OpenAI e da Cloudflare), e uma revisão
de arquiteto que conferiu cada componente do desenho contra o código e contra
o banco de produção (só leitura).

---

## 1. A tese em uma página

Um agente de atendimento com LLM é a soma de seis camadas, e "treinar" é
mexer em cada uma com um instrumento próprio:

| Camada | O que é | Instrumento de treinamento | Como se mede |
|---|---|---|---|
| **Conhecimento** | fatos consultáveis (serviços, preços, FAQ, empresa) | documentos estruturados + recuperação (RAG) | acerto@k, posição, "o trecho certo chegou?" |
| **Comportamento** | quem o agente é, regras, precedência, procedimentos | documentos de prompt + cenários passo a passo | juiz com rubrica, pareado entre versões |
| **Ação** | o que ele faz no mundo (agenda, funil, handoff) | ferramentas tipadas com guardas determinísticas | taxa de ação correta em transcrições reais |
| **Memória** | o que ele lembra dentro e entre atendimentos | janela + resumo + fatos do paciente no CRM | perguntas que dependem do passado |
| **Avaliação** | saber se melhorou antes de publicar | conjunto dourado + juiz calibrado + holdout | concordância com humano (kappa) |
| **Laço** | aprender com produção | lacunas, correções, FAQ sugerida | % de conversas sem "vou verificar", % escaladas |

A regra que organiza tudo: **nada que não possa depender da busca acertar vai
na busca** (comportamento e limites vão sempre no prompt); **nada que custa em
toda mensagem pode ser manual** (regra, não texto corrido); e **nenhuma
mudança de treinamento publica sem número** (medição antes do deploy, laço
depois).

---

## 2. Estado da arte, por camada (pesquisa de 2026-10-30)

### 2.1 Conhecimento — recuperação

O que a literatura e os produtos convergem em 2026:

- **Busca híbrida é o padrão de produção.** Vetor + BM25 (texto completo) sobe
  MRR de ~57% para ~66%; vetor puro falha em termo exato (nome de
  procedimento, sigla de convênio, "R$ 180"), e BM25 puro falha em sinônimo.
  É o conserto certo para um documento de "Sinônimos e FAQ", que é um problema
  lexical.
- **Recuperação contextual** (Anthropic): prefixar cada trecho com o contexto
  do documento antes de vetorizar reduz falha de recuperação em ~35%; com BM25
  ~49%; com reranking ~67%. Colar o caminho de cabeçalhos no trecho
  ("Serviços › Ortodontia › Preço") é a forma barata disso.
- **Reranking** com cross-encoder depois da busca (top-50 → top-5). Na
  Cloudflare, `@cf/baai/bge-reranker-base` via Workers AI; AI Search já faz
  híbrido + rerank por padrão.
- **Corte por seção do autor**, não por caractere; seção maior que um trecho
  avisa o autor em vez de ser cortada por dentro.
- **Cloudflare AI Search** ficou GA em 2026-10-01 (cobrança a partir de
  2026-11-01): híbrido por padrão, rerank embutido, filtro por tenant via
  pasta/metadado, binding de Workers, reescrita de consulta. É a opção
  gerenciada caso o RAG próprio em pgvector pese. Limite: 10 MiB por arquivo,
  isolamento por filtro, latência não documentada.

**O cálculo "no prompt vs na busca" mudou com prompt caching.** OpenAI: cache
automático acima de 1.024 tokens, casamento por **prefixo exato**, leitura em
cache a **10% do preço** (GPT-5.x/6.x; 90% de desconto), escrita 1,25×,
retenção estendida de 24 h nos modelos novos, `prompt_cache_key` para fixar
roteamento. Consequência: um documento estável de 3 mil tokens no prompt custa
~300 tokens efetivos por mensagem a partir da segunda. O custo deixou de ser o
argumento; o argumento que sobra é **atenção** (lost in the middle) — e esse
só se resolve escrevendo regra, não manual. Por isso a decisão prompt vs RAG
deve ser **por medição de recuperação**, documento a documento, e não por
tamanho.

### 2.2 Comportamento — instruções e procedimentos

Os quatro produtos de referência separam **conhecimento estático** de
**procedimento**, e o procedimento virou artefato de primeira classe:

| Produto | Artefato | Formato | Como testa |
|---|---|---|---|
| Intercom Fin | *Procedures* | linguagem natural ("como treinar um colega novo") + blocos determinísticos + conectores | simulações fim a fim, biblioteca de regressão, raciocínio visível por passo |
| Decagon | *AOPs* (Agent Operating Procedures) | texto + código no mesmo artefato; copiloto converte SOP existente | unit test por AOP, **replay de transcrições históricas**, personas simuladas, A/B ao vivo com rollback |
| Sierra | *Journeys* | blocos visuais compostos; Studio (sem código) ou SDK | simulação em escala, suítes de regressão, workspaces versionados staging → produção |
| Chatwoot Captain (open source) | *Scenarios* | título + descrição + instruções passo a passo que podem chamar `@ferramenta`; mais *Response guidelines* e *Guardrails* separados | playground com "run details" (quais cenários dispararam, se houve transferência) |

Padrões que saem disso:

- **Três textos distintos**, não um prompt só: *guardrails* (o que não
  responde), *guidelines* (tom, tamanho, forma) e *cenários* (quando X, faça
  1-2-3 usando a ferramenta Y). Misturá-los num texto corrido é o que faz o
  agente "esquecer" regra. O respond.io, ao contrário, tem **um campo
  "Instruções"** só — e é exatamente o que a engenharia reversa registrou.
- **Precedência declarada** entre textos que vão se contradizer (limite
  clínico > identidade > processo comercial > técnica de venda > fato
  recuperado).
- **Altitude certa** (Anthropic, *Effective context engineering*): instrução
  nem tão específica que vira if/else frágil, nem tão genérica que não guia.
  Menor conjunto de tokens de alto sinal.
- **Divulgação progressiva** (Agent Skills, padrão aberto de dez/2025):
  catálogo curto sempre carregado, instrução completa só quando o assunto
  aparece. Para atendimento: cenário inteiro entra no prompt **só quando a
  conversa chega nele**, não todos sempre.
- **Exemplos são estilo, não fonte de verdade.** Exemplo de resposta
  indexado junto de fato vira texto que o modelo repete literalmente, inclusive
  da pergunta vizinha.

### 2.3 Ação — ferramentas e guardas

- Guia da OpenAI (*A practical guide to building agents*): rotinas de suporte
  mapeiam ~1:1 para artigos de procedimento; ferramenta com descrição clara,
  poucos parâmetros, erro devolvido como texto para o modelo decidir.
- **Guarda determinística acima do modelo**: revalidar no banco antes de
  escrever, nunca palpitar em ambiguidade (devolver lista), escrita sempre com
  rastro visível à equipe e desfazível.
- **Handoff tem de ser ação, não frase.** Em todos os produtos de referência
  "passar para humano" é uma ferramenta que muda estado, com contexto completo
  (transcrição, artigos já mostrados, perfil).
- **Alucinação é majoritariamente falha de recuperação**: a mitigação
  principal é aterrar estritamente no recuperado, e ter um *fallback gracioso*
  ("vou confirmar com a equipe") com teto de tentativas antes de escalar
  incondicionalmente.
- **MCP no runtime do agente de atendimento: não.** MCP resolve transporte de
  capacidade entre sistemas distintos; aqui as ferramentas são funções
  internas do mesmo Worker, com o mesmo banco e a mesma autorização. MCP
  adiciona latência, autenticação e lista de ferramentas "faminta de contexto"
  sem ganho. Vale para o **desenvolvimento** (§4), e no futuro para
  integrações de terceiros que já falem MCP.

### 2.4 Memória

- Três horizontes: janela da conversa (mensagens cruas), **compactação**
  (resumo estruturado quando a janela estoura, mantendo o que foi combinado) e
  **fatos duráveis do contato** (preferências, restrições, o que já foi
  prometido).
- Mem0/Zep/Letta são o padrão de "memória como serviço": extração de fatos por
  LLM, deduplicação, resolução de conflito. Limitação conhecida: sem
  versionamento nem janela de validade — a atualização sobrescreve.
- Para um CRM de clínica, **o CRM já é a memória de longo prazo**. O desenho
  certo é o agente **escrever** fatos no contato (campo estruturado + nota) e
  **ler** na montagem do contexto, não um vetor de memórias à parte. Chatwoot
  Captain faz exatamente isso ("Memories" viram notas do contato).

### 2.5 Avaliação

- **Framework orientado a avaliação** (paper de 2026 sobre suporte a 100 M de
  usuários): coleta → juiz LLM calibrado → análise de padrão de falha →
  otimização do prompt → validação humana das mudanças críticas → deploy.
  Dimensões: correção, utilidade, conformidade com política, tom. Dados reais
  **e** sintéticos; concordância entre anotadores medida (kappa).
- **Juiz LLM calibrado contra humano**: 100–300 traços de produção rotulados
  por 2–3 pessoas; kappa > 0,6 aceitável, > 0,8 forte; depois medir juiz vs
  humano na mesma escala. Raciocínio critério a critério antes da nota, e
  exemplos no prompt do juiz, sobem a concordância. **Pareado ganha de
  absoluto**: comparar duas versões lado a lado concorda mais com humano (até
  +12 pontos de Macro-F1) do que dar nota isolada.
- **Usuário simulado é proxy fraco** (*Lost in Simulation*, 2026):
  simuladores são 60–70% menos variáveis que humanos, superestimam sucesso em
  10–30 pontos e não abandonam a conversa como gente abandona. Uso: cobrir
  caso extremo **antes** do deploy, nunca como métrica primária. A métrica
  primária é **replay de transcrição real** (o que Decagon faz).
- **Juiz não é oráculo** (*LLM-as-a-Judge Is Not an Oracle*, 2026): onze
  modos de falha em laços de auto-melhoria (viés do juiz, ground-truth
  corrompido, reward hacking, parser silencioso). Remédio: **holdout
  congelado** que nunca entra na otimização, **canários** (nota perfeita =
  suspeita), verificações de aceitação determinísticas acima do juiz, e papéis
  separados entre quem gera e quem avalia.
- Métricas de recuperação à parte das de resposta: acerto@k e posição por
  pergunta, com "trecho certo veio?" como teste barato e estável.

### 2.6 Laço de melhoria

- **Detecção de lacuna** a partir de produção: perguntas que terminaram em
  escalada, em "vou verificar", em abandono ou em contato repetido. Decagon e
  Chatwoot geram **rascunho de FAQ** a partir disso, ordenado por demanda, e o
  humano **aprova** (humano como aprovador, não como redator).
- **Correção vira exemplo**: quando alguém corrige a resposta, o par
  (pergunta, resposta corrigida) vira exemplo recuperável por similaridade —
  few-shot dinâmico sem mexer no prompt.
- **Três papéis** (worker → harvester → tuner, humano aprova): o agente
  trabalha, algo colhe reações, algo propõe mudança, a pessoa aprova.
- Versionamento do treinamento com rollback é condição para o laço: sem
  "versão 12 vs versão 13" não há A/B nem regressão.

### 2.7 Observabilidade e custo

- Rastro por resposta: tamanho do prompt, tokens em cache, trechos
  recuperados e similaridade, rodadas de ferramenta, modelo, latência, custo.
  Cloudflare AI Gateway já dá tokens, latência, status e cache por chamada
  (**não confiar no campo `cost`** dele — catálogo de preço desatualizado;
  custo sai da tabela própria).
- Degradar antes de calar: tirar áudio, tirar ferramenta, depois avisar.
- Ferramentas de avaliação do mercado: Braintrust (melhor CI, GitHub Action
  que bloqueia PR por nota), Promptfoo (local, open source, CI por CLI),
  Langfuse (open source, self-host, foco em rastro; CI manual). **Nenhuma tem
  conector MCP disponível neste ambiente** (consultado o registro).

---

## 3. O método — desenho

### 3.0 Duas leituras do pedido, uma resposta

"Agente de treinamento" admite duas leituras, e o método precisa das duas:

- **O método de treinamento** — como a clínica ensina o agente de
  atendimento (artefatos, prompt, busca, ferramentas, memória, medição).
- **O agente treinador** — uma IA que executa o método: entrevista a clínica
  e redige os documentos, lê as conversas reais e aponta lacunas, gera casos
  de teste, roda a medição, propõe a edição e **espera aprovação humana**.

No laço de melhoria da literatura (worker → harvester → tuner → humano
aprova), o agente de atendimento é o *worker*; o agente treinador é o
*harvester* e o *tuner*; a clínica (ou o André) é quem aprova. O treinador
nunca publica sozinho.

### 3.1 Princípios (os que decidem empates)

1. **Treinar é editar artefato versionado, nunca o modelo.** Fine-tuning fica
   fora: caro, lento, invalida a cada mudança de preço, e nenhum produto de
   referência usa para conhecimento de cliente.
2. **Três tipos de texto, três lugares.** *Regra* vai sempre no prompt (não
   pode depender da busca acertar). *Fato* vai na busca (não pode custar em
   toda mensagem). *Procedimento* entra sob demanda, só quando a conversa
   chega nele.
3. **O modo de cada documento é decidido por medição**, não por tamanho nem
   por intuição. Com prompt caching a 10%, custo deixou de ser o critério; o
   critério é "a busca encontra este documento quando a pergunta pede?".
4. **Nada escreve no mundo sem guarda determinística** acima do modelo:
   revalidar no banco, nunca palpitar em ambiguidade, rastro visível, desfaz
   com um clique. Handoff é ação, não frase.
5. **Nenhum treinamento publica sem número.** Rascunho → medição (recuperação
   e resposta, pareada contra a versão publicada) → publicar. Rollback é um
   clique.
6. **Humano aprova, não redige.** Lacunas, FAQ sugerida, correções e
   casos de teste chegam prontos; a pessoa aceita ou rejeita.
7. **A tela ensina onde escrever o quê** — modo no campo, teto visível,
   conferência de estrutura ao digitar, e o que o agente recebeu em cada
   ensaio.
8. **Degradar antes de calar, e nunca vazar.** Sem crédito cai áudio, depois
   ferramenta, depois avisa. Identificadores do paciente são minimizados
   antes de sair para o modelo; falha do filtro bloqueia, não envia.
9. **Lógica pura, casca fina.** Toda decisão nova (fusão, diversidade,
   escalada, juiz, agrupamento) é função pura provada em Node com
   `scripts/test-*.ts`, porque o workerd não roda nesta máquina.
10. **Chamada de LLM por mensagem recebida é orçamento fechado**: embedding +
    geração + rodadas de ferramenta. Nada novo entra nesse caminho sem
    medição que justifique.

### 3.2 Os artefatos de treinamento

A espinha continua sendo documentos em Markdown com cabeçalho como metadado —
é o formato que o corte por seção, a precedência e a exportação já exploram.
O método ideal tem **nove artefatos em quatro famílias**:

| Família | Artefato | Modo | Como entra | Teto |
|---|---|---|---|---|
| **Regras** (sempre) | Informações e privacidade | prompt | bloco estável, precedência 1 | 10k |
| | Instruções centrais (identidade, tom, objetivo, limites) | prompt | bloco estável, precedência 2 | 10k |
| | Processo comercial e políticas | prompt | bloco estável, precedência 3 | 10k |
| **Fatos** (sob busca) | Detalhamento da empresa | **decidido por medição** | busca híbrida, ou prompt se a medição mandar | 10k/50k |
| | Serviços prestados | rag | busca híbrida, um `##` por serviço | 50k |
| | Sinônimos e FAQ | rag | busca híbrida (o lexical é o que resolve sinônimo) | 50k |
| | Metodologia de venda | **decidido por medição** | idem Empresa | 10k/50k |
| **Procedimentos** (sob demanda) | **Cenários** — *novo* | `procedimento` | catálogo de títulos + gatilho sempre no prompt (~30 tokens cada); o corpo do cenário entra quando disparado pela busca | 50k |
| **Exemplos** (estilo) | Exemplos de resposta (seção reservada em cada doc) + **Correções aprovadas** — *novo* | `exemplo` | recuperados por similaridade e apresentados como *estilo*, nunca como fonte de verdade | — |

**Cenários** são o que Fin chama *Procedures*, Decagon *AOPs* e Chatwoot
*Scenarios*: um `##` por situação, com `Quando:` (o gatilho em uma frase) e
`Passos:` (numerados, podendo citar ferramentas: *"consulte
`consultar_horarios_livres` e ofereça no máximo três opções"*). Vivem num
documento próprio porque: (a) misturados ao Processo comercial inflam o bloco
que vai em toda mensagem; (b) o modelo segue melhor passo numerado curto do
que prosa; (c) a seção inteira (`Quando:` + `Passos:`) é curta, cabe num
trecho de 1.500 e é indexada como um só, com um `type` próprio que o prompt
apresenta como *procedimento*, não como fato. Vetorizar só o gatilho é
refinamento para depois, se a medição pedir — exige texto de embedding
diferente do texto gravado, que o indexador de hoje não separa.

Exemplos mínimos de cenário para clínica: *paciente quer remarcar* (não
remarca; coleta o pedido; passa para a equipe), *pergunta de preço sem
avaliação* (regra de "a partir de", convite à avaliação), *urgência/dor* (passa
imediatamente, com telefone), *objeção "tá caro"* (técnica de venda +
limite de privacidade), *paciente pede para apagar dados* (LGPD), *quer falar
com humano* (handoff na hora).

**Correções aprovadas** têm hoje **uma** fonte: o botão "guardar este caso"
no console de ensaio (pergunta + contexto + trechos → resposta aprovada ou
corrigida pelo instrutor). A segunda fonte da literatura — o atendente editar
uma resposta sugerida antes de enviar — não existe neste produto: o agente
envia direto, sem sugestão. Fica fora até existir sugestão de resposta ao
atendente. O par aprovado é recuperado por similaridade como *exemplo de
estilo* — few-shot dinâmico sem mexer no prompt.

**Continuam colunas estruturadas, fora dos documentos:** nome da empresa (o
widget se desenha com ele), saudação inicial (é produto, enviada literalmente),
tom de voz da fala (enum que escolhe instrução de TTS) e fuso horário (relógio
do agente e do agendamento). O que só alimenta o prompt é absorvido pelo .MD.

### 3.3 O prompt — montagem

Esqueleto ideal, do estável para o volátil (o prefixo estável é o que entra em
cache a 10% do preço a partir da 2ª mensagem; qualquer token volátil antes dele
quebra o cache de tudo que vem depois):

```
[ESTÁVEL — idêntico mensagem a mensagem]
  Instruções centrais
  ## Precedência            (lista explícita: Privacidade > Centrais > Processo > ... > fato recuperado)
  ## Informações e privacidade
  ## Processo comercial e políticas
  (## Empresa / ## Metodologia, se a medição mandou para o prompt)
  ## Cenários disponíveis   (só os títulos + gatilho em uma linha)
  ## Ferramentas            (o que pode fazer, e o que NÃO pode — remarcar, cancelar, prometer resultado)
  ## Formato                (WhatsApp, curto, sem markdown, 1 pergunta por vez)
  ## Quando não souber      (fallback: "vou confirmar com a equipe"; nunca inventar preço, horário ou prazo;
                             se for a 2ª vez sem resposta, chame passar_para_equipe)
[VOLÁTIL — muda por mensagem]
  ## Esta conversa          (agora, nome, fase do funil, próximos compromissos, FATOS do paciente)
  ## Procedimento para esta situação   (corpo do cenário disparado, se houver)
  ## Base de conhecimento   ([1] título › seção\ntexto — "fonte de verdade")
  ## Exemplos de estilo     (correções aprovadas semelhantes — "assim respondemos")
  resumo compactado (se houver) + histórico (janela)
```

Regras de montagem:

- **"Quando não souber" é estável e existe sempre.** Hoje a única instrução
  de fallback do produto mora dentro de "Base de conhecimento" e só é emitida
  quando a busca trouxe algo — quando não traz nada, o caso em que o fallback
  mais importa, o modelo não recebe instrução nenhuma.
- `max_tokens` definido em **~450** (coerente com o teto de 900 caracteres
  da fala; folga para a rodada que emite argumentos de ferramenta), e
  `finish_reason` lido e gravado — resposta cortada por limite tem de ser
  visível, não silenciosa.
- `prompt_cache_key` por agente; `cached_tokens` da resposta gravado no
  rastro — sem isso o cache de prefixo é invisível.
- A frase de precedência escrita, não só ordenada (já é assim).
- A seção "Exemplos de resposta" dos documentos **nunca** entra no bloco de
  fatos: é desviada na indexação para o tipo `exemplo`.

### 3.4 Recuperação

| Decisão | Escolha | Por quê |
|---|---|---|
| Motor | **pgvector no Neon, próprio** (não migrar para AI Search agora) | pipeline existe, está medido e passa pelo AI Gateway; AI Search começa a cobrar em 2026-11-01, isola tenant por filtro e tira o acervo do banco onde mora o resto. Reavaliar se o custo de manter o próprio subir. |
| Busca | **híbrida**: cosseno (pgvector) + `tsvector` em `portuguese` sem acento, fundidas por RRF | resolve o documento de sinônimos (lexical), o preço "R$ 180" (termo exato) e tira a vantagem estrutural da FAQ "escrita como pergunta" |
| Consulta lexical | **só a última fala do paciente**, lexemas em OR | a consulta expandida (até 400 caracteres de histórico) com `tsquery` em AND devolveria zero para quase toda pergunta; a expansão fica só na perna vetorial |
| Fusão e diversidade | **em TypeScript puro**; o SQL (uma CTE, uma ida ao banco) devolve só os candidatos com rank de cada perna | é o padrão da casa (lógica pura, casca fina) e é testável em Node |
| Índice | **HNSW** na coluna de vetor + GIN no `tsvector` | hoje é varredura sequencial; com o acervo atual (24 trechos) o ganho é zero — a justificativa é "antes de o acervo crescer", e criar agora custa milissegundos |
| Candidatos → entregues | 12 candidatos → **diversidade por documento** (máx. 3 por doc) → 5 trechos | trecho por seção é menor e mais preciso; pede mais trechos; sem diversidade a FAQ ocupa tudo |
| Reranking | fase 2, **`@cf/baai/bge-reranker-base` via `env.AI`** | é uma chamada de IA a mais por mensagem (Workers AI, grátis); só depois do híbrido medido; o binding `AI` ainda não está declarado |
| Trecho | seção do autor, ≤1.500, caminho de cabeçalho prefixado (**já é a forma barata de recuperação contextual**) | — |
| Contexto do trecho | fase 2: uma linha de contexto gerada por LLM **na indexação**, só para Serviços (tabela de preço perde o cabeçalho da coluna) | custa uma vez por seção, não por mensagem |
| Piso e k | **um só lugar**: o esquema validado de ambiente; a rota de medição **devolve** piso e k em vez de o script repetir | hoje o piso 0,35 está repetido no retriever (lido fora do esquema validado) e no script de medição, e o console de ensaio marca trecho "fraco" abaixo de 0,45 por conta própria — três números, nenhum derivado do outro |
| Embedding | `text-embedding-3-small` fica; trocar exige reindexar tudo em coluna nova com troca atômica | distâncias de modelos diferentes não se comparam |

Esqueleto da consulta (uma ida ao banco; fusão e corte em TS):

```sql
WITH vec AS (
  SELECT id, 1 - (embedding <=> $q::vector) AS sim,
         ROW_NUMBER() OVER (ORDER BY embedding <=> $q::vector) AS vec_rank
  FROM knowledge_documents
  WHERE "agentId" = $agent AND embedding IS NOT NULL
    AND type IN ($tipos) AND 1 - (embedding <=> $q::vector) >= $piso
  ORDER BY embedding <=> $q::vector LIMIT $n
), lex AS (
  SELECT id, ts_rank_cd("searchVector", q) AS rank,
         ROW_NUMBER() OVER (ORDER BY ts_rank_cd("searchVector", q) DESC) AS lex_rank
  FROM knowledge_documents, to_tsquery('portuguese', $termosOr) q
  WHERE "agentId" = $agent AND type IN ($tipos) AND "searchVector" @@ q
  ORDER BY rank DESC LIMIT $n
)
SELECT d.id, d.title, d.type, d.content, d.metadata, vec.sim, vec.vec_rank, lex.lex_rank
FROM knowledge_documents d
LEFT JOIN vec ON vec.id = d.id LEFT JOIN lex ON lex.id = d.id
WHERE vec.id IS NOT NULL OR lex.id IS NOT NULL;
```

`fundirRRF(linhas, k = 60)` soma `1/(k+rank)` por perna presente;
`diversificarPorDocumento(ordenados, 3, 5)` corta. A coluna `searchVector` é
gerada (`GENERATED ALWAYS AS (to_tsvector('portuguese',
immutable_unaccent(content))) STORED`), no mesmo padrão da migração de busca
sem acento que já existe no repositório.

### 3.5 Ferramentas do agente de atendimento

As quatro existentes (agenda do paciente, horários livres, marcar consulta,
mover negócio) seguem com as guardas que já têm. O método acrescenta **três**:

| Ferramenta | O que faz | Guarda |
|---|---|---|
| `passar_para_equipe(motivo, resumo)` | marca a conversa como entregue (coluna própria `handoffAt`), atribui a pessoa ou departamento da linha quando houver, grava nota interna com o resumo, devolve a frase de despedida | única forma de o agente escalar. **O silêncio do agente passa a depender de `handoffAt`, não só de `assignedTo`**: hoje, se a linha não tem responsável, o handoff deixa `assignedTo` nulo e o agente responde a próxima mensagem |
| `anotar_paciente(fato, categoria)` | grava fato durável no contato (preferência, restrição, o que foi prometido) | só categorias fechadas; aparece como nota visível à equipe; é a memória de longo prazo. Cabe nas colunas de notas/campos do contato, sem migração |
| `nao_encontrei(pergunta)` | registra lacuna de conhecimento (pergunta + trechos que vieram) e devolve a instrução de fallback | **a detecção principal é determinística**, no processador: melhor similaridade abaixo do piso (ou vazio) **e** resposta com a frase de fallback — sem rodada extra. A ferramenta cobre só o caso em que a busca trouxe algo e o modelo mesmo assim não achou. A 2ª lacuna na mesma conversa dispara `passar_para_equipe` por regra, não pelo modelo |

Regras que permanecem: ≤3 rodadas e a última sem ferramentas; erro vira texto
para o modelo; modo econômico derruba áudio antes de ferramenta — e **medir**
quanto agendamento se perde quando a ferramenta cai, antes de manter essa
ordem.

**Ensaio com ferramentas: por flag, não por dados de teste.** O contexto de
ferramenta ganha `modo: 'ensaio'`: leitura roda de verdade (horários livres
não precisam de contato), escrita devolve "teria marcado terça 14h" e não
grava rastro. Evita criar Conversa e Contato de teste, que exigiriam filtro em
toda leitura do sistema.

### 3.6 Memória

Três horizontes, nenhum serviço externo:

1. **Janela** — últimas 20 mensagens (existe).
2. **Compactação** — quando a conversa passa de ~30 mensagens, um resumo
   estruturado (resumo, pendências, combinados, tom) gravado na conversa e
   injetado antes da janela; recalculado a cada 10 novas mensagens. **O
   prompt e as colunas já existem** no resumo de conversa da tela; falta
   chamar do processador, **depois** do envio da resposta (fora do caminho
   quente), com modelo barato, **sem debitar crédito** (não é ação entregue).
   Em produção nenhuma conversa chegou a 30 mensagens (máximo 23, p90 14,5):
   o custo hoje é zero e, quando disparar, é uma chamada barata a cada ~5
   mensagens recebidas.
3. **Fatos do paciente** — o CRM é a memória de longo prazo: `anotar_paciente`
   escreve, "Esta conversa" lê. Sem vetor de memórias à parte; sem Mem0.

### 3.7 Avaliação — três andares

**Andar 1 — recuperação** (barato, determinístico, sem crédito, roda em CI
contra homologação): para cada pergunta, o documento esperado chegou **no
top-k da produção** (não num k maior)? Métricas: acerto@k, posição média,
"raspando o piso". Regras: toda pergunta tem `esperado` ou é marcada como "não
precisa de fato"; **todo documento do acervo tem ≥ 5 perguntas**; perguntas
vêm de dois poços — escritas à mão e **mineradas das mensagens reais** (as 200
inbound mais recentes agrupadas por similaridade). Resultado **persiste** por
versão do treinamento (há precedente no repositório: baselines em JSON), com
diff contra a medição anterior.

**Andar 2 — resposta** (o que o Andar 1 não vê): o conjunto dourado nasce do
console de ensaio por "guardar este caso" (pergunta, contexto, trechos,
resposta aprovada ou corrigida). O juiz é um LLM com rubrica por critério,
raciocínio critério a critério antes da nota, exemplos no prompt do juiz.
Critérios: fiel aos trechos; não inventou preço/horário/prazo; respeitou a
precedência; agiu certo (ferramenta certa, handoff quando devia); forma de
WhatsApp; tom. **Pareado**, não absoluto: rascunho vs publicado, lado a lado,
com a ordem embaralhada. Calibração: 100–300 casos rotulados por 2 pessoas,
kappa medido; **20% de holdout congelado** que nunca entra na afinação;
**canários** (nota perfeita no conjunto inteiro é suspeita, não vitória).
Usuário simulado só para regressão de caso extremo, nunca como métrica
primária.

Duas decisões de custo: (a) o juiz começa com o **maior modelo da OpenAI do
catálogo**, pelo mesmo gateway — provedor Anthropic é código novo (o tipo de
provedor hoje só admite OpenAI), segredo novo e caminho novo no gateway;
entra depois, como provedor só de geração, para a segunda opinião de outra
família. (b) **"Medir agora" não debita crédito**: é instrumentação, como a
medição de recuperação; registra em `usage_logs` com canal próprio para a
margem. Sem isso, 100 casos pareados custariam 200 créditos da clínica por
clique. O ensaio interativo continua debitando.

**Andar 3 — produção** (o laço): por agente e por semana — % de respostas
com fallback ("vou confirmar"), % de conversas escaladas e por qual motivo,
lacunas registradas, interações por conversa, agendamentos feitos pela IA,
custo por resposta, % de tokens em cache, latência, respostas cortadas por
`max_tokens`. Alerta quando fallback ou escalada sobem acima da média móvel.

### 3.8 O laço de melhoria — onde mora o agente treinador

O agente treinador tem **cinco funções**, todas terminando em proposta para
aprovação humana:

| Função | Entrada | Saída (proposta) | Quando |
|---|---|---|---|
| **Entrevistar e redigir** | perguntas guiadas + site da clínica + cadastro | rascunho dos documentos que hoje começam vazios (Serviços, FAQ, Cenários) | criação do agente e sob demanda |
| **Minerar lacunas** | lacunas detectadas, respostas com fallback, escaladas, perguntas repetidas | lista agrupada por demanda, cada item com rascunho de entrada de FAQ/Serviço/Cenário | semanal (cron, um despertar — irrelevante para o orçamento do Neon) + sob demanda |
| **Colher correções** | "guardar este caso" no console | par pergunta→resposta como exemplo de estilo; ou proposta de edição do documento quando a correção é fato | contínuo |
| **Gerar e manter testes** | mensagens reais + documentos | perguntas de medição com `esperado`; casos para o conjunto dourado | a cada versão de treinamento |
| **Medir e comparar** | rascunho vs publicado | relatório: acerto@k por documento, veredito pareado do juiz, custo do prompt, o que piorou | antes de publicar |

**Versionamento é pré-requisito do laço — e o mínimo basta.** Cada documento
ganha um conteúdo de rascunho ao lado do publicado; "Publicar" grava um
snapshot (versão N) numa tabela de versões, reindexa o que é busca, e o
agente passa a usar a versão N. Rollback restaura N-1. A medição roda sempre
**contra o rascunho** e mostra o delta contra o publicado. Rascunho de
documento de busca é indexado com um `type` próprio, e a busca filtra pela
versão pedida. Não se versiona o acervo de trechos.

**Dois lugares onde o treinador aparece:**

- **No produto** (o que importa): dentro da seção Treinamento — guia
  *Lacunas* (fila de aprovação), guia *Medição* (histórico por versão, delta,
  botão "medir agora"), botão *Rascunhar com IA* nos documentos vazios,
  *Entrevista* na criação do agente. Roda no Worker com o mesmo gateway;
  são chamadas pontuais, não um agente de longa duração. A avaliação em lote
  roda na fila de cron existente (um tipo de job a mais), sem fila nova.
- **Para o desenvolvedor**: as mesmas APIs expostas a um agente de código
  (Claude) via scripts ou um MCP interno — mineração, medição, comparação,
  proposta de edição — para o André iterar o treinamento de uma conta de
  teste sem abrir a tela. É casca fina sobre o mesmo núcleo.

### 3.9 Observabilidade, custo e privacidade

- **Rastro por resposta**: tokens de prompt e **em cache**, `finish_reason`,
  trechos (id, documento, similaridade), cenário disparado, ferramentas e
  rodadas, modelo, latência, custo pela tabela própria (não pelo `cost` do
  gateway). Tudo cabe no JSON de metadados de `usage_logs`, sem migração.
- **Crédito segue "uma ação entregue, um crédito"**; o custo real por
  resposta fica em `usage_logs` e é o que a medição de custo lê. Medir
  **respostas por atendimento** de verdade (hoje 2,5 é palpite; produção
  mostra ~1,7 chamada por conversa, em 12 conversas — pouco volume).
- **Privacidade — escopo definido antes do filtro.** O prompt injeta o
  primeiro nome do paciente **de propósito** (para o agente não perguntar de
  novo); um marcador `<PACIENTE_1>` quebraria isso. Minimizar
  **identificadores** (CPF com dígito verificador, telefone, e-mail, endereço,
  data de nascimento), não o nome. Filtro determinístico e puro, aplicado nos
  três pontos por onde texto de paciente sai para o modelo (histórico, consulta
  de busca, transcrição do resumo); classificador por LLM seria uma chamada
  por mensagem. Consertar já o log do Worker que grava os primeiros 80
  caracteres do resultado de ferramenta (nome e data de consulta). E verificar
  no painel do AI Gateway que a coleta de logs está desligada — exigência do
  inventário de migração que o código não consegue provar.

### 3.10 Modelos

| Papel | Modelo | Razão |
|---|---|---|
| Resposta ao paciente | frontier via AI Gateway (`gpt-6.x`/`gpt-5.x` do catálogo), temperatura baixa (≤0,5) para fato | texto que o cliente lê; chamada de ferramenta confiável |
| Classificação, resumo, compactação, rascunho de FAQ | modelo barato da mesma família | tarefas internas; é a Fase B do gateway (candidatas a Workers AI) |
| Juiz da avaliação | o maior da OpenAI do catálogo, em lote e offline; **Anthropic depois**, como segunda opinião de outra família | evita viés de autopreferência quando houver duas famílias; custo não é por mensagem |
| Embedding | `text-embedding-3-small` | trocar é reindexar tudo |
| Reranker | `@cf/baai/bge-reranker-base` (Workers AI) | grátis, latência local; exige declarar o binding `AI` |
| Voz | mantém frontier | diferencial do produto |

---

## 4. Ferramentas, skills e MCPs necessários

### 4.1 No runtime do agente de atendimento

**Nenhum MCP.** As ferramentas são funções do mesmo Worker, com o mesmo banco
e a mesma autorização; MCP só adicionaria latência, autenticação e uma lista
de ferramentas "faminta de contexto". A biblioteca de LLM própria
(`LLMFactory`/`OpenAIProvider`) basta — **não** adotar AI SDK/eve/LangGraph
só para isso; o custo de migração não paga, e o laço de ferramentas de 3
rodadas já está escrito e testado. Reavaliar se surgir streaming para o widget.

### 4.2 Para desenvolver o método e o treinador (este ambiente)

| Precisa de | O que | Já disponível? |
|---|---|---|
| Banco | **Neon MCP** (`run_sql`, branches): minerar perguntas reais, medir acerto, criar **branch de avaliação** para rodar a medição sem tocar produção. Já serviu nesta sessão para conferir pgvector 0.8.6, `unaccent`, `pg_trgm`, índices e volumes | sim, conectado |
| Borda e IA | **Cloudflare API MCP**: logs do AI Gateway (tokens em cache por chamada), modelos do Workers AI (reranker), AI Search se um dia migrar | sim, conectado (leitura) |
| Migrações | **Prisma local MCP** / `prisma migrate` para `tsvector`, HNSW, versões dos documentos — sempre aditivas, agrupadas em poucos arquivos (a produção dos clones não tem caminho de migração) | sim |
| Tela | **Playwright MCP** para verificar as guias Lacunas/Medição logado | sim (aba com login) |
| Avaliação | **Nenhum MCP de Langfuse/Braintrust/Promptfoo existe no registro.** Decisão: **não adotar plataforma SaaS de eval**. O padrão da casa (scripts `tsx` com `conferir()`, exit code, CI) já cobre o Andar 1 e serve ao Andar 2; a persistência de medições vai em tabela própria; o rastro vem do AI Gateway + `usage_logs`. | — |
| Juiz de outra família | **skill `claude-api`** + chave Anthropic no gateway (o AI Gateway é multi-provedor) — fase posterior | skill sim; provedor, chave e caminho a criar |
| Postgres | **skills `neon-postgres`** (HNSW, `tsvector`, hybrid) e **`neon-postgres-branches`** (branch por avaliação) | sim |
| Padrão de tela | `DESIGN.md` §5 (Tela 03 — guias com índice) governa Lacunas e Medição | sim |

### 4.3 Skills do agente treinador (artefatos a escrever)

Os **modelos dos sete documentos** que o André vai escrever são, na prática,
as *skills* do treinador: cada um ensina **como se redige** aquele documento
(seções, o que vai onde, exemplos bons e maus, o que nunca entra). O formato
`SKILL.md` (nome + descrição curtas sempre carregadas; corpo só quando o
assunto aparece) é exatamente o certo:

- `redigir-instrucoes-centrais`, `redigir-privacidade`, `redigir-processo-comercial`
- `redigir-empresa`, `redigir-servicos` (um `##` por serviço, preço "a partir de", condições)
- `redigir-faq` (um `##` por pergunta, com os sinônimos **dentro** da resposta)
- `redigir-cenarios` (`Quando:` + `Passos:`; cita ferramentas pelo nome)
- `minerar-lacunas`, `gerar-perguntas-de-medicao`, `julgar-resposta` (rubrica)

Servem ao treinador no produto (como prompts do rascunho assistido) **e** ao
Claude no desenvolvimento (como skills de verdade). Um único texto, dois
consumidores — por isso escrever os sete `.md` de modelo vem antes de qualquer
código do treinador. Hoje `MODELOS` está vazio e o teste de treinamento
confere que os cabeçalhos do modelo batem com o catálogo.

---

## 5. Leitura inicial do terreno (para a comparação que vem)

Só o que os levantamentos e a revisão trouxeram; a comparação de verdade é a
próxima etapa, a pedido do André. Números de produção (consulta só-leitura ao
Neon em 2026-10-30): **24 trechos indexados, 1 agente, 496 kB de acervo; 16
conversas, mediana 6 mensagens, máximo 23; 20 chamadas de WhatsApp em 12
conversas; zero registros com tokens em cache no rastro.**

| Camada | O que já existe | O que o método pede e ainda não há |
|---|---|---|
| Artefatos | 7 documentos em `.md`, catálogo com modo/teto/precedência, tabela `agent_training_docs` com hash, tela única para os sete, importar/exportar, conferência de estrutura | Cenários; Correções aprovadas; rascunho/publicado e snapshot por versão; `MODELOS` vazio; "Exemplos de resposta" reservada no catálogo mas **indexada como fato** no runtime (o indexador passa o documento inteiro) |
| Prompt | estável antes do volátil (provado por teste), precedência escrita, prefixo cacheável | `max_tokens` existe no provedor e **não é preenchido** na resposta ao paciente; sem `prompt_cache_key`; `finish_reason` não lido; sem bloco de estilo; **fallback "vou verificar" só é emitido quando a busca trouxe algo**; explicação de Empresa e Técnicas diz "consultado quando pede" num campo que vai em toda mensagem; faixa de orçamento calibrada para 3 docs quando são 5 (máximo real 50.000, não 30.000) |
| Recuperação | pgvector, corte por seção com caminho de cabeçalho, consulta completada com fala do paciente, um cliente de embedding no gateway, piso 0,35 | **sem índice vetorial**, sem híbrido/`tsvector`, sem reranking, sem diversidade por documento, k=4 não acompanhou o chunker, piso em 3 lugares (0,35 / 0,35 / 0,45), o piso lido fora do esquema validado de ambiente |
| Ferramentas | 4 tools com guardas fortes (revalida vaga, nunca palpita nome), ≤3 rodadas, rastro interno | handoff não é ferramenta **e, sem responsável na linha, não silencia o agente**; sem memória escrita; sem registro de lacuna; ensaio não exercita ferramentas |
| Memória | janela de 20; CRM dá nome/fase/compromissos; **prompt e colunas de resumo existem** (rota de resumo da tela) | sem compactação automática; sem fatos duráveis do paciente |
| Avaliação | **Andar 1 existe** (`medir-recuperacao`, 27 perguntas, decidiu modo de 2 docs); console de ensaio mostra consulta, trechos e prompt | medição usa k=8 contra 4 da produção (acerto inflado); só 11 perguntas com `esperado`, nenhuma para 4 dos 7 docs; perguntas não vêm de conversas reais; nada persiste; **Andar 2 não existe**; Andar 3 não existe |
| Laço | — | nada: sem lacunas, sem FAQ sugerida, sem correção colhida, sem versão para comparar |
| Observabilidade | `usage_logs` por chamada com custo próprio; AI Gateway com tokens/latência/cache | `cached_tokens` não gravado; trechos e similaridade não ficam no rastro; **log do Worker grava 80 caracteres do resultado de ferramenta** (nome e data); minimização de identificadores pendente desde o inventário de migração; coleta de logs do gateway não verificada |
| Treinador | `gerarRascunho` determinístico para 3 de 7 | nenhuma IA redige; Serviços/FAQ/Cenários começam vazios |

**Três contradições de documentação achadas de passagem** (resolver antes da
comparação, senão ela parte de texto errado): `PRODUCT.md` §2 ainda diz
"1 crédito = 1 centavo de dólar" (o código implementa "1 ação entregue = 1
crédito", e a confusão já custou um dia em 2026-10-28); `DESIGN.md` fala em
"cinco guias da Personalidade" (são dez de Treinamento, derivadas do catálogo);
o método dos sete documentos **só existe em comentário de código** — nenhum
`.md` do repositório o descreve.

---

## 6. Sequência recomendada (decisão, não cardápio)

Ordem por "o que destrava o resto" e por risco. A coluna de migração importa
porque cada arquivo de migração é um a mais que a produção dos clones não tem
como aplicar — agrupar.

| # | Passo | Reutiliza | Novo | Migração | Prova em Node | Esforço |
|---|---|---|---|---|---|---|
| 1 | **Coerência do que existe**: explicação dos docs de prompt; faixa para 5 docs; piso e k no esquema de ambiente e devolvidos pela rota de medição; medição com k da produção; `max_tokens` ~450 + `finish_reason`; `prompt_cache_key` + `cached_tokens` no rastro; "Quando não souber" no bloco estável; "Exemplos de resposta" desviada do acervo; log de ferramenta sem conteúdo | catálogo, esquema de ambiente, retriever, rota e script de medição, provedor OpenAI (já aceita `max_tokens`), `usage-tracker`, indexador, `secoes` | `separarExemplos(secoes)` puro; `RagDocType 'exemplo'` | **não** | estender `test-prompt` (fallback estável; estável antes de volátil) e `test-treinamento` (faixas; exemplos) | P |
| 2 | **Busca híbrida + HNSW + diversidade** | retriever (`$queryRaw` + `::vector`), `immutable_unaccent` da migração de busca sem acento, `textoParaBusca`, `check-neon`, JSON de perguntas | `src/lib/rag/fusao.ts` (puro: `fundirRRF`, `diversificarPorDocumento`, `termosLexicais`); CTE única; ≥5 perguntas por doc | **sim, aditiva** (coluna gerada `searchVector`, GIN, HNSW; no schema `Unsupported("tsvector")?`) | `scripts/test-fusao.ts`; casos novos em `check-neon`; medir antes/depois com o mesmo JSON e k de produção | M |
| 3 | **`passar_para_equipe` + lacuna determinística (+ `nao_encontrei`) + `anotar_paciente`** | registro de tools, `resolveAssignee` do executor de regras (extrair de método privado para módulo compartilhado), `isHumanHandled`, `departmentId` da linha, notas/campos do contato, `loadConversationContext` | `src/lib/rules/atribuicao.ts`; `integrationId` no contexto de ferramenta; `src/lib/atendimento/escalada.ts` (puro); tabela `knowledge_gaps`; `handoffAt` lido por `isHumanHandled` e pelo processador; `modo: 'ensaio'` no contexto de ferramenta | **sim, aditiva** (`knowledge_gaps`, `conversations.handoffAt`) | `scripts/test-escalada.ts`; SQL em branch do Neon | M |
| 4 | **Rascunho/publicado + "guardar este caso" + Andar 2 (juiz pareado)** | `AgentTrainingDoc`, montagem do prompt e `ensaiarResposta`, hash do indexador, `LLMFactory`, `trackUsage`, rota de ensaio, baselines JSON | `src/lib/treinamento/versao.ts` (puro); `src/lib/avaliacao/juiz.ts` e `pareado.ts` (puros: prompt do juiz, embaralho, parser, canários, kappa, holdout); rota de avaliação; job na fila de cron (união de tipos, sem fila nova); `type 'treinamento-rascunho'` + filtro por versão no retriever | **sim, aditiva** (`draftContent`, `publishedVersion`, `publishedAt`; tabelas de versões, casos e avaliações) | `scripts/test-juiz.ts`, `test-pareado.ts` com respostas gravadas | G |
| 5 | **Mineração de lacunas + FAQ sugerida + guia Lacunas** | `knowledge_gaps`, embedding em lote, `secoes`, padrão de cron (nome na união, handler obrigatório, rotina em BRT ≤ 20h por causa da conversão de dia da semana), Tela 03 | cron semanal `minerar-lacunas`; `src/lib/lacunas/agrupar.ts` (puro) e `rascunho.ts`; rotas de lacunas | **sim, aditiva** (colunas de grupo/rascunho/status — no mesmo arquivo do passo 3 se forem juntos) | `scripts/test-agrupar.ts`; `check:filas` para o cron | M–G |
| 6 | **Cenários + compactação** | catálogo, `secionarMarkdown`, indexador, `type` do trecho, seção volátil no prompt, prompt e colunas do resumo de conversa | `ModoDoDocumento 'procedimento'`; `src/lib/treinamento/cenarios.ts` (puro); roteamento por `type: 'cenario'`; `src/lib/conversas/resumo.ts` (puro: `precisaCompactar`); chamada pós-envio | **não** | `scripts/test-cenarios.ts`, `test-resumo.ts` | M |
| 7 | **Treinador no produto** (entrevista, rascunho com IA) | `gerar.ts`, `modelos.ts`, `modeloDoDocumento`, `LLMFactory`, `spendAiCredits` (1 crédito, como o resumo) | `src/lib/treinamento/redator.ts` (prompts derivados dos 7 `.md`); rota de rascunho com IA; entrevista na criação | **não** | prompts puros, testáveis por estrutura | M |

**Bloqueio externo do passo 7:** os sete `.md` de modelo do André (são as
skills do redator). **Dependência do passo 5:** a minimização de
identificadores (§3.9), porque texto de paciente vai ao LLM redator em lote.

Reranking (exige declarar o binding `AI`), contexto gerado por trecho e
migração para AI Search ficam condicionados ao que a medição mostrar depois
do passo 2.

---

## 7. O desenho testado contra o código (revisão de arquiteto)

Cada componente foi conferido contra arquivos e contra o banco. O que a
revisão **mudou** no desenho, com a prova:

| Mudança | Prova |
|---|---|
| Cenários indexados inteiros, não só o `Quando:` | o indexador vetoriza o mesmo texto que grava; separar exigiria caminho próprio e uso do `metadata` (nunca escrito) |
| "Quando não souber" vai para o bloco estável | a única instrução de fallback vive dentro de "Base de conhecimento", emitida só quando `knowledge.length > 0` |
| `max_tokens` ~450 (não 300) e `finish_reason` exposto | o limite vale também para a rodada que emite argumentos de ferramenta; o provedor não lê `finish_reason` |
| Handoff grava `handoffAt`, e o silêncio lê essa coluna | `isHumanHandled = Boolean(assignedTo)`; `notifyHuman` grava `assignedTo: assignee ?? null` — linha sem responsável devolve a conversa ao agente |
| Perna lexical com a última fala em OR | a consulta expandida tem até 400 caracteres de histórico; `tsquery` em AND devolveria zero |
| RRF e diversidade em TS, SQL devolve ranks | padrão da casa (lógica pura, casca fina; `secoes.ts` separado de `chunker.ts` pelo `server-only`) |
| HNSW "antes de crescer", não "está lento" | 24 trechos, 1 agente — o planejador usa o índice de `agentId` |
| Compactação sem crédito, pós-envio, reutilizando o resumo | colunas `summary*` e o prompt de 4 seções já existem na rota de resumo; `spendAiCredits` define crédito como valor entregue |
| Juiz começa na OpenAI; Anthropic depois | tipo de provedor só admite `'openai'`; Gemini/Anthropic foram removidos de propósito; gateway só tem o caminho `/openai` |
| "Medir agora" não debita | o ensaio debita 1 por geração; 100 casos pareados = 200 créditos da clínica |
| Versionamento mínimo (rascunho + snapshot), sem versionar trechos | `AgentTrainingDoc` tem um `content` só; indexador e prompt leem dele |
| PHI: minimizar identificadores, não o nome | o prompt injeta o primeiro nome de propósito ("não pergunte o nome dela de novo") |
| Lacuna detectada no processador, ferramenta opcional | lacuna = similaridade abaixo do piso + frase de fallback; não precisa de rodada extra |
| Ensaio com ferramentas por flag `modo: 'ensaio'` | o ensaio hoje não tem contexto de ferramenta; dados de teste exigiriam filtro em toda leitura |
| Correções aprovadas só do console | não existe "resposta sugerida" no WhatsApp — o agente envia direto |
| Reranker só após declarar `AI` e medir o híbrido | `cloudflare.config.ts` não declara `AI`; `bindings.ai()` existe no pacote; é uma chamada de IA a mais por mensagem |

O que a revisão **confirmou** sem alteração: artefatos em `.md` com catálogo
em código (nenhuma migração para o 8º documento); prefixo estável provado por
teste; crédito por ação entregue; cron semanal irrelevante para o orçamento de
CU-hora; jobs levam referência, não texto (teto de 120.000 bytes já guardado);
tsvector e HNSW não exigem extensão nova (pgvector 0.8.6, `unaccent` e
`pg_trgm` já instalados).

---

## 8. Verificação do estudo (o que prova que o desenho está certo, quando for implementado)

- **Andar 1 antes e depois do passo 2**, mesmo JSON de perguntas (≥5 por
  documento), k da produção: acerto@k de Serviços nas perguntas de preço tem
  de subir; a FAQ deixa de ser 1ª em 13 de 14 recuperações.
- **Cache visível**: após o passo 1, `cached_tokens` > 0 da 2ª mensagem em
  diante numa conversa de ensaio, no rastro e no AI Gateway.
- **Fallback sem trecho**: ensaio com pergunta fora do acervo responde "vou
  confirmar com a equipe" e registra lacuna; a 2ª pergunta sem resposta na
  mesma conversa chama `passar_para_equipe`.
- **Handoff silencia**: após `passar_para_equipe` numa linha sem
  departamento, a mensagem seguinte do paciente **não** gera resposta do
  agente (`handoffAt` preenchido).
- **Pareado funciona**: a mesma versão contra si mesma dá ~50% de
  preferência (canário); um documento com um preço errado de propósito perde
  no critério "não inventou preço".
- **Scripts em Node**: `test-fusao`, `test-escalada`, `test-juiz`,
  `test-pareado`, `test-cenarios`, `test-resumo` na lista do CI, todos verdes;
  `check:filas` aceita o cron semanal.

---

---

# Parte II — Parametrização e o dono da conversa (perguntas de 2026-10-30)

Levantamento feito sobre `atendimento/agentes/comandos` (seção
**Parametrização**: guias *Regras de ação* e *Parâmetros do agente*) e sobre
tudo o que escreve e lê `assignedTo`.

## 10. As quatro perguntas

### 10.1 Essas telas aperfeiçoam o treinamento?

**Regras de ação — não treinam; são a camada determinística que fica fora do
modelo.** O executor não chama LLM em ponto nenhum e nada das regras entra no
prompt. Elas rodam a cada mensagem recebida (não só na primeira), **antes** do
agente, em WhatsApp e Instagram; e se qualquer regra responde ou transfere, o
agente não responde naquela mensagem. No método, isso é a "guarda
determinística acima do modelo" (§3.1, princípio 4): o lugar certo para o que
**não pode depender de o modelo entender** — a palavra "humano", "urgente",
"dor"; o tempo sem resposta. Com as duas condições que a tela oferece hoje
(*a mensagem contém* e *minutos desde a última mensagem*), a cobertura é
estreita, mas o papel é legítimo e complementar.

**Parâmetros do agente — não treinam; regulam o runtime.** Os sete campos
chegam ao código, todos. Três mexem na resposta (manter contexto, restringir
assuntos, emojis), dois são válvulas (limite de interações, prazo para
finalizar), dois são percepção (digitando, velocidade). No método eles
pertencem ao bloco de comportamento, como parâmetros fixos; um deles deveria
sumir (10.4).

### 10.2 Estão funcionando? Precisam de adequação?

Funcionam. Oito pontos precisam de conserto, dois deles graves:

| # | Achado | Gravidade |
|---|---|---|
| 1 | **Excluir regra na tela não exclui no banco.** A guia só tira do array local; o hook faz `PATCH`/`POST`, nunca `DELETE`. A regra "apagada" continua ativa e **continua rodando**. A rota `DELETE` existe e ninguém a chama | grave |
| 2 | **Manter contexto desligado pode zerar a busca e a pergunta.** Com `take: 1` por data, sem filtro de direção, se a última mensagem for do agente (saudação, mensagem de regra) a consulta do RAG fica vazia e o prompt sai sem a fala do paciente | grave |
| 3 | **Regras não valem no widget do site** (vai direto para a geração), nem velocidade nem "digitando". Nada na tela avisa | médio |
| 4 | `notify_human` sem departamento cala o agente e deixa a conversa **sem ninguém** — e **apaga** um responsável que já existisse | médio (resolvido por §11) |
| 5 | Não existe condição "primeira mensagem" (o tempo decorrido é falso na 1ª) nem "fora do expediente"; não existe ação "encerrar conversa" | lacuna |
| 6 | A API aceita o que a tela recusa: `user_intent` e `custom` (inertes, sempre falsos), operador incompatível com o tipo, ação sem parâmetro obrigatório | baixo |
| 7 | Prioridade sem desempate no runtime (ordem imprevisível em empate, e as flags são OR) | baixo |
| 8 | Nota do `notify_human` gravada como `outbound` em vez de `internal`; `snoozed` e `CONVERSATION_AUTOCLOSE_HOURS` são resíduos em comentário | baixo |

Adequação recomendada, nesta ordem: (1) ligar o `DELETE`; (2) tirar o
interruptor "manter contexto" (10.4); (3) avisar na tela que regras,
velocidade e "digitando" não valem no widget; (4) condições "primeira
mensagem" e "fora do expediente" e ação "encerrar conversa"; (5) validar
na API o que a tela já valida e remover `user_intent`/`custom` do schema.

### 10.3 "Agendar", "transferir se o assunto for X", "encerrar se o assunto for X": .MD ou Regra?

A resposta depende de **quem consegue reconhecer o gatilho**, não do custo
("consultada a cada prompt" não é problema: regra é determinística, roda em
microssegundos e não gasta crédito; documento de prompt também vai em toda
mensagem, com cache).

| Gatilho | Onde | Por quê |
|---|---|---|
| **Literal**: a mensagem contém "humano", "atendente", "urgente", "dor", "cancelar"; passou N minutos; primeira mensagem; fora do expediente | **Regra de ação** | reconhecível sem entender; 100% previsível; roda antes do modelo; não depende da busca acertar |
| **Semântico**: "quer remarcar", "é reclamação", "pede orçamento de implante", "assunto X" em geral | **.MD — documento de Cenários + ferramenta** | a regra **não consegue**: a condição de intenção é inerte e não há classificador. Quem entende assunto é o modelo; quem executa com guarda é a ferramenta (`passar_para_equipe`, `encerrar_atendimento`) |
| **Agendar** | **ferramenta do agente** (`marcar_consulta`), conduzida por cenário no .MD | nunca é regra: exige entender data, especialista, revalidar vaga |
| **Encerrar por silêncio** | parâmetro `autoCloseDays` (já existe) | já é cron |
| **Encerrar por assunto** | ferramenta nova `encerrar_atendimento`, com cenário | é semântico; e hoje não existe nem como regra nem como ferramenta |

Duas decisões que decorrem disso:

- **Não** acrescentar classificador de intenção às regras: seria uma chamada
  de modelo a mais por mensagem (princípio 10). O entendimento semântico
  acontece **dentro** do turno do agente, via cenário + ferramenta — custo
  zero adicional, porque o modelo já está lendo a mensagem.
- Tudo que, se errar, causa dano (urgência não transferida) ganha **os dois
  caminhos**: a regra literal como rede ("dor", "urgente" → transfere na
  hora) e o cenário para o modelo reconhecer a mesma situação dita de outro
  jeito.

Na prática o cliente escreve "se o assunto for remarcação, transfira para a
equipe" **no documento de Cenários** (`Quando:` paciente quer mudar data ou
horário de consulta já marcada · `Passos:` 1. não remarque; 2. pergunte a
data pretendida; 3. chame `passar_para_equipe` com o pedido). E escreve
"palavra urgente → transferir" **na Regra de ação**.

### 10.4 "Manter contexto da conversa" favorece a precisão?

**Sim, decisivamente — e desligado é defeito, não opção.** Desligado, o
histórico cai para **uma** mensagem: "e quanto custa?" perde o referente; a
expansão da consulta do RAG (que completa pergunta curta com o que o paciente
já disse) deixa de existir; e, pelo defeito do item 2 de 10.2, se a última
mensagem for do próprio agente a busca sai vazia. A única razão para existir
era custo, e ela não se sustenta: 20 mensagens de WhatsApp são ~600–1.000
tokens, e a compactação do método (§3.6) cuida das conversas longas.

**Decisão: remover o interruptor e manter contexto sempre.** Enquanto não
sai, corrigir o `take: 1` para "última mensagem **do paciente**".

## 11. Dono da conversa com o agente ainda atendendo

### 11.1 O problema real, no código

`assignedTo` tem **dois significados ao mesmo tempo**:

- **Mutex do agente de IA.** Quatro portões independentes leem
  `Boolean(assignedTo)` como "humano assumiu, agente cala": entrada do
  WhatsApp/Instagram, geração após o debounce, widget e follow-up automático.
  O interruptor que permitia o contrário foi removido de propósito.
- **Responsável.** A caixa de entrada ("Em espera" = ativa **e** sem
  `assignedTo`; "Ativas" = com), o medidor da fila, o painel, os gráficos, o
  escopo "meus pacientes" e o dono do negócio (assumir a conversa dá o
  negócio aberto sem dono a quem assumiu) leem o mesmo campo.

Logo, **qualquer distribuição que grave `assignedTo` silencia o agente no ato
de distribuir** — o oposto do pedido. Mais sete fatos que o desenho tem de
respeitar:

1. Cinco gravadores concorrentes sem árbitro (assumir, transferir, regra,
   recepção, **enviar mensagem** — inclusive nota interna), e três que apagam
   (devolver ao bot, reabrir, paciente que volta a escrever). Nada registra
   por quem nem por quê.
2. O handoff do limite de interações **não atribui ninguém**: conta com a
   conversa já estar sem dono para "aparecer em Em espera".
3. Conversa não tem departamento; a **linha** tem. Intake, widget e histórico
   antigo não têm linha — caem na fila geral.
4. Não existe horário comercial por clínica, turno por pessoa, fuso por
   pessoa nem presença (online/ausente). O fuso é constante
   (`America/Sao_Paulo`) e o expediente 9–18 está fixo no cron de follow-up.
5. Não existe nenhuma distribuição automática (a única "política" é o membro
   mais antigo do departamento, usada pela regra).
6. Os Cron Triggers são estáticos, gerados em build — política por clínica
   não pode nascer de cron; tem de ser avaliada no evento.
7. "Assumir" não verifica se já tem dono (a API deixa roubar); "transferir"
   exige permissão, "assumir" e "devolver" não.

### 11.2 Decisão de desenho

**Separar os dois conceitos em dois campos e deixar `assignedTo` como está.**

- `assignedTo` continua significando **"um humano está atendendo agora"** —
  é o mutex do agente, com mais de vinte leitores; renomear é risco sem
  ganho.
- **Novo** `Conversation.ownerId` (+ `ownerAssignedAt`, `ownerSource`:
  `manual | rodizio | balanceado | aleatorio | regra | recepcao`) é o
  **responsável**: quem responde por esta conversa quando um humano for
  preciso, quem a vê na própria fila, quem é avisado. **Não silencia o
  agente.**

Regras de convivência (as que resolvem os fatos acima):

| Situação | O que acontece |
|---|---|
| Conversa nasce (ou reabre sem dono) | a política escolhe `ownerId`; o agente segue atendendo normalmente; a conversa continua em "Em espera" (= com o bot), agora com responsável visível |
| **Handoff** (limite de interações, `passar_para_equipe`, regra sem destino, 2ª lacuna, sem crédito) | `assignedTo = ownerId` quando houver dono → a conversa cai nas "Ativas" do dono e ele recebe notificação. Sem dono, fica como hoje (sem responsável, em espera). **Isto fecha o buraco do handoff que não atribui ninguém** |
| Paciente volta a escrever depois de finalizada | `assignedTo` zera (o bot retoma), **`ownerId` permanece** — o dono é da relação com o paciente, não do turno |
| Alguém que não é o dono quer assumir | permitido, mas passa a exigir a mesma permissão de transferir (`canTransfer`); o dono assume livremente; "assumir" passa a recusar se já há outro humano atendendo |
| Enviar **nota interna** | não atribui mais ninguém (só mensagem ao paciente atribui) |
| Regra `notify_human` sem destino | não apaga dono existente; com dono, entrega ao dono |
| Negócio aberto sem dono | recebe `userId = ownerId` (mesma regra de hoje, agora pela posse e não pelo assumir) |
| Dono desativado/removido | redistribui na próxima mensagem (`ownerId` sem FK hoje; passa a ter FK com `SetNull`) |

**Caixa de entrada.** "Em espera" continua sendo "com o bot", mas ganha o
responsável no cartão e o filtro "Só as minhas". Atendente vê em "Em
espera" o que é **dele ou sem dono** dentro das filas dele; gestão vê tudo.
Painel e gráficos passam a agrupar por `ownerId` (com `assignedTo` como
reserva onde não houver dono).

### 11.3 A política — o que o cliente escolhe

Mora em `Workspace.automations` (JSON com defaults centralizados, lido e
gravado pela rota de automações; Tela 03 → guia **Automações**), com o turno
por pessoa na guia **Usuários**, onde já se editam papel, permissão de
transferir e departamentos.

```
distribuicao:
  estrategia: nenhuma | rodizio | balanceado | aleatoria        (padrão: nenhuma)
  quem: departamento-da-linha                                   (linha sem departamento → todos os elegíveis)
  papeis: [ATENDENTE, GESTOR]                                   (OWNER/ADMIN entram só se marcarem "recebo conversas")
  foraDoTurno: sem-dono | plantao                               (plantao → plantaoUserId)
  fuso: America/Sao_Paulo                                       (fuso da clínica; Multiclínica pode ter um por unidade)

por membro (Usuários):
  disponivel: true | false                                      (interruptor manual "Disponível para receber conversas")
  recebeDistribuicao: true | false
  turno: { dias: [1..5], inicio: "08:00", fim: "18:00", fuso?: ... }   (vazio = sempre)
```

As três estratégias são **funções puras sobre a lista de elegíveis**, sem
estado nem cursor (robustas a concorrência e a mudança de equipe):

| Estratégia | Escolhe | Quando usar |
|---|---|---|
| **Rodízio** (padrão) | quem recebeu conversa **há mais tempo** (`max(ownerAssignedAt)` mais antigo; quem nunca recebeu vem primeiro) | distribuição justa em volume; é o "round robin" sem ponteiro |
| **Balanceado** | quem tem **menos conversas abertas como dono** (`status = active`), desempate por rodízio | qualidade: evita sobrecarregar quem está com muitas |
| **Aleatória** | sorteio uniforme entre elegíveis | é o que o cliente pediu como "fila aleatória / randômica"; **dominada pelo rodízio** (mesma média, pior variância) — fica disponível, não é padrão |

**Elegível** = membro ativo do workspace, com papel aceito, `disponivel`,
`recebeDistribuicao`, **dentro do turno** (no fuso dele ou da clínica) e
membro do departamento da linha (ou qualquer um, se a linha não tem
departamento). Sem elegível → `foraDoTurno`: deixa sem dono (o bot atende; a
próxima mensagem dentro do turno distribui) ou entrega ao plantão.

"Por fuso horário" vira **turno por pessoa no fuso certo**, que é o que a
frase significa na prática: a clínica de Manaus marca 08–18 no fuso dela, e a
de São Paulo no dela; a mesma função decide.

**Presença**: não há sistema de presença e inferir por sessão de login é
errado (sessão de 7 dias não diz quem está na mesa). O interruptor manual
"Disponível" + turno resolve o caso real (férias, folga, almoço). Presença
automática é fase posterior, se for pedida.

### 11.4 Onde roda e o que muda no código

- **No evento, não em cron**: na criação/reabertura da conversa no inbound
  (`resolveConversation`) e no intake da recepção. Uma consulta de elegíveis
  (com `ultimaAtribuicao` e `abertas`) + a função pura `escolherDono(elegiveis,
  politica, agora)` + um `update`. Concorrência entre duas conversas no mesmo
  milissegundo pode repetir a pessoa no rodízio — aceitável, e o balanceado
  se corrige sozinho.
- **Migração aditiva, uma só**: `conversations.ownerId` (FK `SetNull`),
  `ownerAssignedAt`, `ownerSource`, índice; `workspace_users.turno Json?`,
  `disponivel`, `recebeDistribuicao`. A política fica no JSON de automações
  (sem migração).
- **Leitores a ajustar**: as três guias e os contadores da caixa; escopo
  "meus pacientes"; painel e gráficos; a rota de mensagens (nota interna não
  atribui); `assign`/`transfer` (regras de 11.2); `notify_human`
  (`resolveAssignee` passa a preferir o dono); os pontos de handoff
  (`assignedTo = ownerId`).
- **Prova em Node**: `scripts/test-distribuicao.ts` — rodízio escolhe quem
  está há mais tempo sem receber; balanceado escolhe quem tem menos abertas;
  turno respeita dia, hora e fuso; linha sem departamento abre para todos;
  sem elegível devolve `null` ou o plantão; dono persiste na reabertura;
  handoff com dono preenche `assignedTo`.
- **Esforço**: M–G (migração, função pura, gancho no inbound e no intake,
  caixa de entrada, duas guias da Tela 03). Entra como **passo 3b** da
  sequência da §6, junto de `passar_para_equipe`, porque os dois escrevem no
  mesmo lugar e o handoff com destino é o que dá sentido ao dono.

### 11.5 O método ajuda nesta demanda?

Ajuda em três pontos concretos: (1) `passar_para_equipe` e a escalada por
lacuna ganham **destino** — o dono — em vez de largar a conversa sem ninguém;
(2) a notificação ao dono no handoff é a metade humana do laço de melhoria
(quem corrige, quem aprova FAQ sugerida da própria carteira); (3) o conceito
de dono dá à "Em espera" o significado que ela sempre quis ter: **"o bot está
atendendo, e esta pessoa responde por isso"**, em vez de "ninguém".

Referências de mercado consultadas (2026-10-30): Chatwoot (rodízio e
balanceado, prioridade por tempo de espera, teto de conversas por janela,
capacidade por atendente), respond.io (rodízio ou "menos contatos abertos",
filtro "só online", receita low-cost vs high-quality), Intercom (reivindicação
manual, rodízio, balanceado que pula ausentes).

---

## 12. Fontes

- Chatwoot, *Advanced Assignment Policies (v2)* — https://www.chatwoot.com/hc/user-guide/articles/1763978164-chatwoot-assignment-v2
- respond.io, *Assignment Strategy: automatic contact distribution & load balancing* — https://respond.io/help/convert-leads/assignment-strategy-automatic-contact-distribution-load-balancing
- Macha, *Intercom Shared Inbox (2026): team inboxes, assignment* — https://www.getmacha.com/blog/intercom-shared-inbox-explained
- Anthropic, *Effective context engineering for AI agents* — https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- Anthropic, *Contextual Retrieval* (números de 35/49/67%) — via https://aiworkflowlab.dev/article/rag-chunking-strategies-late-contextual-semantic-2026
- OpenAI Cookbook, *Prompt Caching 201* — https://developers.openai.com/cookbook/examples/prompt_caching_201
- OpenAI, *A practical guide to building agents* — https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf
- Fin AI, *AI Procedures vs AOPs vs Journeys* — https://fin.ai/learn/ai-agent-procedures-aops-journeys
- Chatwoot, *Captain* (user guide) — https://www.chatwoot.com/hc/user-guide/en/categories/captain
- respond.io, *How respond.io's AI Agents work reliably at scale* — https://respond.io/blog/how-respondio-ai-agents-work
- Cloudflare, *AI Search — Workers binding* — https://developers.cloudflare.com/ai-search/usage/workers-binding/
- Cloudflare, *AI Search — Multitenancy* — https://developers.cloudflare.com/ai-search/how-to/per-tenant-search/
- Cloudflare, *AI Search is generally available* (2026-10-01) — https://developers.cloudflare.com/changelog/post/2026-10-01-ai-search-generally-available/
- arXiv 2606.08867, *Building Customer Support AI Agents at 100M-User Scale: An Evaluation-Driven Framework*
- arXiv 2601.17087, *Lost in Simulation: LLM-Simulated Users are Unreliable Proxies*
- arXiv 2609.02246, *LLM-as-a-Judge Is Not an Oracle: Why Self-Improving Agents Need Deterministic Guardrails*
- τ²-bench (ICML 2026) — https://icml.cc/virtual/2026/oral/71171
- FutureAGI, *LLM-as-Judge Best Practices in 2026* — https://futureagi.com/blog/llm-as-judge-best-practices-2026/
- Learnixo, *Pointwise vs Pairwise Evaluation* — https://learnixo.io/blog/eval-pointwise-pairwise
- CallMissed, *RAG Best Practices 2026* — https://www.callmissed.com/en/blog/rag-best-practices-2026
- Braintrust, *Best AI eval tools for CI/CD* — https://www.braintrust.dev/articles/best-ai-evals-tools-cicd-2025
- Dev.to, *The 10 best AI memory layers for agents in 2026* — https://dev.to/jonathanfarrow/the-10-best-ai-memory-layers-for-agents-in-2026-448e
- Decagon, *Knowledge base AI systems* — https://decagon.ai/blog/knowledge-base-ai
- SleekFlow, *AI agents for dental and aesthetic clinics in 2026* — https://sleekflow.io/en-us/blog/ai-agents-for-dental-aesthetic-clinics
- Internos: `docs/re-respond-io/` (engenharia reversa, encerrada em 2026-10-25), `docs/paridade-respond-io/PLANO.md`, `docs/migration/05-ai-provider-evaluation.md`, `src/lib/treinamento/documentos.ts`, `src/trabalhos/servicos/prompt.ts`, `scripts/medir-recuperacao.ts`
