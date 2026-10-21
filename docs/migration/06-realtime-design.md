# 06 — Tempo real

Necessidade **comprovada** no inventário, não presumida: há dois mecanismos de
tempo real em uso hoje.

| Uso | Hoje | Onde |
| --- | --- | --- |
| Conversa nova / mensagem nova | canal `conversations-realtime` em mudanças da tabela, **+ polling de 15 s** | `src/app/(dashboard)/atendimento/conversas/page.tsx` |
| "Digitando" | broadcast `typing:<conversationId>` | idem + `src/app/api/conversations/[id]/typing/route.ts` |
| Status dos agentes | — | requisito novo, declarado no MD |

## O problema que o Supabase resolvia de graça

O Supabase Realtime lia o **WAL do Postgres**: gravar a linha era publicar o
evento. O Neon não publica WAL para a Cloudflare, e nenhuma configuração muda
isso.

> **Escrita no Postgres não chega sozinha ao Durable Object.** É a frase que tem
> de estar clara antes de escrever a primeira linha — quem assume o contrário
> constrói um sistema que funciona em teste e perde eventos em produção.

## Desenho

```
rota/worker
   │
   ├─ BEGIN
   │    INSERT na tabela de domínio   ─┐  mesma
   │    INSERT em outbox              ─┘  transação
   └─ COMMIT
         │
         ▼
   publicador (Cron Trigger + chamada direta no caminho quente)
         │  lê outbox onde published_at IS NULL
         ▼
   Cloudflare Queue  ──►  consumidor  ──►  DO do workspace  ──►  WebSockets
         │                                                           │
         └─ marca published_at                                   navegadores
```

### Por que `outbox`, e não publicar direto

Publicar na Queue dentro da rota parece mais simples e é errado: se o commit
falhar depois do enqueue, o evento existe e o dado não. A `outbox` na **mesma
transação** torna as duas coisas atômicas — ou os dois existem, ou nenhum.

O publicador roda nos dois caminhos: chamada direta depois do commit, para
latência, e um Cron Trigger de varredura, para recuperar o que a chamada direta
perdeu. O segundo é o que torna o primeiro dispensável em caso de falha.

### Tabela

```sql
CREATE TABLE "outbox" (
    "id"           TEXT PRIMARY KEY,
    "workspaceId"  TEXT NOT NULL,
    "tipo"         TEXT NOT NULL,   -- 'mensagem.nova', 'conversa.alterada', 'agente.status'
    "payload"      JSONB NOT NULL,  -- mínimo: ids, nunca conteúdo clínico
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt"  TIMESTAMP(3),
    "tentativas"   INTEGER NOT NULL DEFAULT 0
);

-- O índice que importa: a varredura só procura o não publicado.
CREATE INDEX "outbox_pendente_idx" ON "outbox" ("createdAt")
    WHERE "publishedAt" IS NULL;
```

**`payload` carrega identificadores, não conteúdo.** O evento diz "a conversa X
tem mensagem nova"; o navegador busca o conteúdo pela rota autenticada. Assim o
conteúdo clínico não transita por Queue nem fica em log de fila.

### Um Durable Object por workspace

O DO **é** a fronteira de isolamento: ninguém recebe evento de outra clínica
porque não está no mesmo objeto. Não é filtro, é topologia — e filtro se esquece
de aplicar.

- **Autorização no handshake**: valida sessão e `workspaceId` no servidor, antes
  do upgrade. Nunca confiar no `workspaceId` que o navegador manda — a mesma
  regra que `src/lib/auth/workspace.ts` já aplica no cookie.
- **Hibernação da WebSocket API**: o DO hiberna sem derrubar as conexões. É o que
  mantém o custo baixo com clínica de expediente comercial.
- **Idempotência**: o cliente guarda o último id visto e descarta repetido —
  Queues entrega *at-least-once*, então repetição é o normal, não a exceção.
- **Reconexão**: ao reconectar, o cliente manda o último id visto e busca o
  intervalo pela rota HTTP. WebSocket não é fonte de verdade, é notificação.

### O debounce do `ai-reply` mora aqui também

Hoje o BullMQ dá debounce por conversa: três mensagens seguidas geram **uma**
resposta. Queues não tem isso. A implementação natural é um **DO por conversa**
com alarme: cada mensagem reagenda o alarme; o alarme dispara a resposta. Mesma
primitiva que o tempo real, já paga.

### O polling de 15 s fica

Permanece no primeiro corte como rede de segurança, e sai quando os DOs tiverem
histórico em produção. Já existe, já funciona, e tirá-lo no mesmo corte seria
remover o plano B junto com a estreia do plano A.

## O que testar

- [ ] mensagem nova aparece sem recarregar
- [ ] conexão de outro workspace **não** recebe o evento
- [ ] WebSocket sem sessão válida é recusada no handshake
- [ ] evento duplicado não duplica na tela
- [ ] Queue indisponível: `outbox` acumula e a varredura recupera
- [ ] deploy do Worker: conexões reconectam sem perder evento
- [ ] hibernação não derruba conexão ociosa
- [ ] `ai-reply`: três mensagens em 5 s geram **uma** resposta

---

## Estado da implementação — 2026-10-21

### Construído e provado

| Peça | Onde | Provado por |
| --- | --- | --- |
| Tabela `outbox_events` com índice **parcial** no pendente | migração `20261021080000` | `check:filas` |
| Gravação na mesma transação do dado | `src/lib/outbox/index.ts` | `check:filas` — inclui a prova de que transação revertida não deixa evento órfão |
| Publicador com tentativa, desistência e poda | idem | `check:filas` |
| Protocolo do WebSocket e recuperação de reconexão | `src/lib/realtime/protocolo.ts` | `check:tempo-real` |
| Debounce da resposta do agente | `src/lib/realtime/debounce.ts` | `check:tempo-real` |
| `SalaDoWorkspace` (fan-out por workspace) | `src/cloudflare/sala-do-workspace.ts` | typecheck com os tipos reais da Cloudflare |
| `AgendaDaConversa` (debounce por alarme) | `src/cloudflare/agenda-da-conversa.ts` | idem |
| Entrega outbox → sala, agrupada por workspace | `src/cloudflare/publicador.ts` | idem |

### A restrição que decidiu a forma

Os Durable Objects **não rodam nesta máquina**: o `workerd` exige macOS 13.5+ e
o Mac de desenvolvimento está em 12.7.6. Não havia como executar uma linha
daquelas classes.

A saída foi tirar **toda decisão que pode errar** de dentro dos objetos e pôr em
função pura, onde há teste — e deixar as classes sendo cascas que aplicam o que a
função devolveu. Os dois pedaços que ganharam mais com isso são também os que
erram mais em silêncio:

- **a recuperação de reconexão**: entregar a lacuna errada deixa a tela num
  estado que não corresponde ao banco, e ninguém percebe até alguém reclamar que
  a conversa "sumiu";
- **o debounce**: errar faz o agente não responder, sem erro em lugar nenhum.

### Um defeito encontrado ao modelar, que o BullMQ também tem

O debounce atual chama `changeDelay` a cada mensagem nova, **sem teto**. Quem
manda mensagem a cada 3 s com debounce de 4 s empurra a resposta para sempre: ela
nunca sai. Na prática ninguém digita assim por muito tempo — mas uma sequência de
notas de voz, um paciente ansioso ou um bot do outro lado produzem exatamente
esse padrão, e o sintoma é "o agente não respondeu".

O desenho novo tem **teto de 30 s** contado da primeira mensagem da rajada.
`check:tempo-real` simula 30 mensagens a cada 3 s e prova que o alarme para de
ser empurrado.

### Falta

- **O cliente.** `src/app/(dashboard)/atendimento/conversas/page.tsx` ainda usa
  Supabase Realtime. Trocar por WebSocket contra a sala é o próximo passo, e o
  polling de 15 s fica como rede de segurança no primeiro corte.
- **A rota de handshake**, que resolve a sessão, confere a participação no
  workspace e encaminha para a sala. É onde a autorização acontece — a sala não
  revalida, e não deveria: ela não tem como consultar o banco sem pagar uma
  conexão por sala.
- **A gravação dos eventos nos pontos de escrita.** A outbox existe e está
  testada, mas nenhuma rota chama `gravarEvento()` ainda. Entra junto com o
  porte dos processadores.
- **A trava distribuída** (`workers/src/lock.ts`), que vira um Durable Object.
