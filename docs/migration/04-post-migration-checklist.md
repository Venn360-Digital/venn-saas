# 04 — Depois da migração

## Dia 0 — nas primeiras 2 horas

- [ ] login funciona para os 3 usuários
- [ ] conversa abre, mensagem envia, mensagem recebida aparece
- [ ] WhatsApp: a sessão está de pé — e **conferir de novo depois de 105 s**,
      que é o tempo do defeito conhecido do Evolution Go
- [ ] webhook da Meta: aperto de mão responde
- [ ] webhook do Asaas: evento de teste chega e não cobra duas vezes
- [ ] upload e download de arquivo
- [ ] taxa de erro do Worker em zero
- [ ] nenhuma fila com item preso
- [ ] **VPS intacta**, nada desligado

## Dia 1

- [ ] os 13 crons dispararam **no horário certo** — a conversão BRT→UTC é a
      armadilha mais provável desta migração; conferir um a um
- [ ] briefing diário chegou às 7 h de Brasília, não às 4 h
- [ ] latência p95 ao Neon medida e anotada
- [ ] nenhum erro de pool de conexão
- [ ] *instant restore* do Neon com retenção ≥ 24 h **confirmada**

## Semana 1

- [ ] custo real acompanhado contra a estimativa, por serviço
- [ ] Durable Objects: reconexão e hibernação observadas em uso real
- [ ] se o polling de 15 s ainda cobre falha do tempo real, o tempo real ainda
      não está pronto para tirá-lo
- [ ] nenhum segredo em log — **conferir também o log do AI Gateway**
- [ ] filtro de PHI: contagem de bloqueios > 0 e nenhum conteúdo registrado

## Antes de desligar qualquer coisa — mínimo 14 dias

- [ ] **varrer o histórico do git por credencial.** Já apareceu senha de
      Postgres em texto puro commitada em outro projeto da Venn360; apagar o
      arquivo não tira do histórico
- [ ] rotacionar tudo que esteve na VPS: senha do Postgres, service role key,
      chaves do Evolution, qualquer token que tenha passado pelo `.env`
- [ ] dump final guardado **fora** da VPS, com integridade conferida
- [ ] arquivos clínicos: ou migrados para o provedor aprovado, ou com a cópia da
      VPS preservada e a decisão registrada
- [ ] confirmar com o André o prazo de retenção da VPS

## Ordem de desligamento ⚠️

Um por vez, confirmando entre cada um:

1. `odontobox360-app-1` e `odontobox360-worker-1`
2. pilha Supabase (`auth`, `rest`, `storage`, `realtime`, `studio`, `kong`,
   `meta`, `imgproxy`, `db`)
3. `redis`
4. `evolution-v2`, e o `postgres` dele
5. **`evolution-go` por último** — e só depois de a POC estar provada *em
   produção*, não em teste
6. `traefik`
7. a VPS

**Nunca** `docker compose down -v`: o `-v` apaga os volumes, e entre eles está o
`compose_supabase_storage_data` com os arquivos clínicos.

## Limpeza no código, depois de estabilizar

- [ ] remover `@supabase/*` do `package.json`
- [ ] remover `bullmq` e `ioredis`
- [ ] remover `bcryptjs`, que já está declarada **sem nenhum uso**
- [ ] remover `vercel.json`
- [ ] renomear `workers/` → o nome colide com Cloudflare Workers e vai confundir
      quem ler depois
- [ ] resolver `WEBHOOK_URL` × `WEBHOOK_BASE_URL`
- [ ] atualizar `README.md` e `infra/README.md`, que descrevem a VPS
- [ ] `.env.example` com as variáveis novas, **sem valor nenhum**
