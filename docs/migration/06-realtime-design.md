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
