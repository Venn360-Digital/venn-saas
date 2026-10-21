# 10 — Auditoria de segurança da migração

**Executada em** 2026-10-21, sobre a branch `migracao/cloudflare-neon`.

**Escopo:** as cinco superfícies que a migração mudou — autenticação Better Auth,
o cofre AES-GCM, o adaptador de storage por classificação, a remoção do RLS e o
middleware otimista — mais as dependências, porque a migração mexeu nelas.

Critério: **fronteira de confiança real e resultado concreto.** Desvio de boa
prática sem violação alcançável não entra como achado. Cada item abaixo diz qual
principal de menor confiança, qual entrada, qual controle, e o que acontece.

---

## Resumo

| # | Achado | Gravidade | Estado |
| --- | --- | --- | --- |
| 1 | Next.js 16.1.6: dois RCE críticos não autenticados e ~35 CVEs | **crítica** | **corrigido** — 16.4.2 |
| 2 | `@langchain/community` e `langchain` declarados e nunca usados, trazendo `handlebars` com 3 falhas críticas | **crítica** | **corrigido** — removidos |
| 3 | Limite de requisições em memória: inefetivo em Workers | **alta** | **corrigido** — contador em banco |
| 4 | `@xmldom/xmldom` 0.8.11 via `mammoth`, no caminho de upload de DOCX: 15 falhas | média | **corrigido** — 0.8.15 |
| 5 | Sessão de 7 dias em computador compartilhado de recepção | média | **corrigido** — 8 h de inatividade |
| 6 | Caminho público do middleware mais largo que o necessário | baixa | **corrigido** — estreitado |
| 7 | `chaveDe()` não validava o prefixo de inquilino | informativa | **corrigido** |
| 8 | Middleware otimista: cookie **forjado** passa o portão | — | **não é vulnerabilidade** — verificado página por página |
| 9 | `ws` 8.19.0: exaustão de memória | baixa | corrigido — 8.22.0 (caminho não usado) |
| 10 | `langsmith` 0.5.2: 3 falhas | — | **inalcançável** — tracing não configurado |
| 11 | Falha de entrega de e-mail é invisível a quem pediu | média | **em aberto** — ver `03-go-no-go.md` |
| 12 | Perda do RLS como segunda linha de defesa | — | **aceita e registrada** — ver `01-compatibility.md` §13 |

Vulnerabilidades de dependência: **40 → 24**, e **críticas de 2 → 0**.

---

## 1 — Next.js 16.1.6 com dois RCE críticos  🔴 corrigido

**Principal:** ator não autenticado, da internet.
**Entrada:** requisição à API de otimização de imagem com arquivo AVIF.
**Resultado:** execução remota de código.

O `npm audit` listava **35 CVEs** no Next 16.1.6, dois deles críticos:

- *Unauthenticated Remote Code Execution in Image Optimization API when AVIF
  files are used* — corrigido em 16.3.3;
- *Unauthenticated Remote Code Execution on windows-hosted servers* — 16.3.3
  (não aplicável ao destino, mas listado).

E vários **altos** que tocam exatamente o que esta migração construiu:

- *Middleware / Proxy bypass in App Router applications via segment-prefetch
  routes* — e um "incomplete fix follow-up" depois dele;
- *Middleware / Proxy bypass through dynamic route parameter injection*;
- *Server-Side Request Forgery in Image Optimization*;
- *null origin can bypass Server Actions CSRF checks*.

**Por que é alcançável aqui**, e não teoria: `next/image` é usado em três
componentes (`Logo`, `AgentCard`, `PerfilTab`) e **não há bloco `images` no
`next.config.ts`** — então a otimização está ligada e `/_next/image` está
exposto. E a aplicação é App Router com portão no middleware, que é o alvo dos
bypasses.

**Correção:** `next` e `eslint-config-next` para **16.4.2**. `npm audit` não
reporta mais nenhuma falha em `next`. **`npm run build` passa** — todas as rotas
compilam, inclusive o middleware e o catch-all do Better Auth.

> **Efeito colateral honesto.** O `eslint-config-next` 16.4 ligou os
> diagnósticos do React Compiler, que apontaram **52 padrões pré-existentes** no
> React do app — 38 `setState` dentro de efeito, 10 de imutabilidade, mais
> pureza e refs. Nada nasceu da atualização; o que mudou foi o linter passar a
> ver. Foram rebaixados a **aviso** com justificativa em `eslint.config.mjs`:
> consertar 38 é refator de interface com risco próprio e não cabe num commit de
> segurança, mas deixar o `eslint` vermelho seria pior — portão sempre quebrado
> deixa de ser portão, e o próximo erro de verdade passaria no ruído. Tarefa
> própria aberta.

## 2 — Dependências mortas carregando falhas críticas  🔴 corrigido

**Principal:** nenhum alcançável — e é esse o ponto.

`handlebars@4.7.8` estava na árvore com **três falhas críticas** de injeção de
JavaScript. Ao rastrear a origem:

```
@langchain/community@1.1.13 → @langchain/classic@1.0.16 → handlebars@4.7.8
```

E ao conferir o uso real, **só dois pacotes LangChain são importados**:

| Pacote | Importado | Onde |
| --- | --- | --- |
| `@langchain/openai` | **2 vezes** | `lib/rag/embedder.ts`, `lib/rag/retriever.ts` |
| `@langchain/textsplitters` | **1 vez** | `lib/rag/chunker.ts` |
| `@langchain/core` | nunca direto | peer dos dois acima; fica como transitivo |
| `@langchain/community` | **nunca** | — |
| `langchain` | **nunca** | — |

**Correção:** `@langchain/community` e `langchain` removidos. O `handlebars`
saiu da árvore por completo, e com ele as três críticas. Ganho secundário que
importa para o destino: menos dependência no bundle do Worker.

`next.config.ts` foi ajustado — os dois saíram de `serverExternalPackages`, e
`@langchain/core` ficou, com o motivo escrito: ele não é importado direto, mas
faz require dinâmico que o bundler quebra.

## 3 — O limite de requisições não limitaria nada em Workers  🟠 corrigido

**Principal:** ator não autenticado.
**Entrada:** `POST /api/auth/sign-in/email` em repetição.
**Controle pretendido:** limite de requisições — a biblioteca o liga **sozinha**
em produção, então é controle declarado, não ausente.
**Resultado:** adivinhação de senha sem estrangulamento efetivo.

O padrão do Better Auth é `storage: "memory"`. Lido na implementação
(`better-auth/dist/api/rate-limiter/index.mjs`), isso é literalmente:

```js
const memory = /* @__PURE__ */ new Map();
```

Um `Map` no módulo. **Em Cloudflare Workers cada isolate carrega o módulo de
novo e tem o próprio mapa** — e os isolates são muitos, espalhados por colo, e
descartados com frequência. O limite efetivo passa a ser "100 por janela **por
isolate**", que para quem adivinha senha é o mesmo que não haver limite.

**Correção:** `storage: 'database'`, tabela `auth_rate_limits`
(migração `20261021070000_rate_limit_em_banco`), e regras apertadas por rota —
porque o padrão de 100 em 10 s é generoso demais para adivinhação: a esse ritmo
uma lista de dez mil senhas comuns passa em menos de vinte minutos.

| Rota | Janela | Máximo | Por quê |
| --- | --- | --- | --- |
| `/sign-in/email` | 60 s | 10 | quem erra a senha tenta três vezes, não dez |
| `/request-password-reset`, `/forget-password` | 1 h | 5 | protege a conta e a reputação de remetente |
| `/reset-password` | 1 h | 10 | adivinhar token é inviável por entropia; o limite fecha de vez |
| `/sign-up/email` | 1 h | 5 | o cadastro está aberto para homologação |
| `/change-password` | 10 min | 10 | exige a senha atual: é oráculo se não limitado |

**Provado** em `npm run check:auth`: HTTP 429 na décima primeira tentativa,
contador **no banco** com chave `203.0.113.7|/sign-in/email`, `count=10`.

> **Um achado dentro do achado.** A primeira versão do teste chamava
> `auth.api.signInEmail` direto e deu doze 401 com zero linhas no contador — o
> que parecia limite quebrado era teste que não passava por ele. `auth.api.*`
> **pula a cadeia HTTP**, e o limitador vive nela. Importa além do teste:
> endpoint próprio que chame `auth.api` **não** está limitado.

## 4 — `xmldom` vulnerável no caminho de upload de DOCX  🟡 corrigido

**Principal:** usuário autenticado da clínica.
**Entrada:** DOCX malformado em `POST /api/agents/knowledge/extract`.
**Resultado:** parsing quadrático e ReDoS; injeção de nós XML no texto extraído.

`mammoth@1.11.0` resolvia `@xmldom/xmldom@0.8.11`, com **15 falhas** — injeção
de XML por CDATA, por comentário, por instrução de processamento; recursão
descontrolada; deduplicação de atributos em tempo quadrático; ReDoS no parser de
tag de fechamento.

O caminho existe: `mammoth` processa arquivo enviado pelo usuário.

**Gravidade média, e não alta, de propósito.** O ator é pessoal autenticado da
clínica, e o alvo é a própria base de conhecimento dela: em Workers o limite de
CPU é por requisição, então a exaustão mata o próprio pedido. O efeito é
majoritariamente sobre o próprio principal — tratá-lo como travessia de
fronteira seria inflar o achado.

**Correção:** `mammoth@1.13.0` e `overrides` fixando `@xmldom/xmldom@0.8.15`,
que corrige as 15 e satisfaz o mesmo `^0.8.6` que o mammoth pede — nada no
mammoth muda. O `npm audit` sugeria "corrigir" **descendo** para `mammoth@0.3.29`,
o que seria absurdo; o override é a saída certa.

## 5 — Sessão de sete dias em máquina compartilhada  🟡 corrigido

O padrão do Better Auth é `expiresIn: 7 dias`. Numa clínica o computador da
recepção é compartilhado e fica ligado: sete dias significa que quem sentar nele
amanhã continua logado como a atendente de ontem, **com acesso a prontuário**.

**Correção:** `expiresIn: 8 h`, `updateAge: 1 h`. Com a renovação de hora em
hora, quem está trabalhando não é interrompido — então na prática é um limite de
**oito horas de inatividade**, não de jornada. A máquina deixada ligada à noite
desloga; quem passa o dia na tela, não.

É um número e muda em uma linha, se a operação pedir outro.

## 6 — Caminho público mais largo que o necessário  🟢 corrigido

Ao trocar o middleware, a regra pública passou de `/auth` para `/api/auth/` — e
isso capturou duas rotas **da aplicação** que moram sob o mesmo prefixo:
`/api/auth/me` e `/api/auth/check-workspace`.

**Não abriu nada:** as duas conferem a sessão por conta própria, verificado. Mas
regra mais larga do que precisa é dívida — a terceira rota que alguém criar ali
talvez não confira.

**Correção:** as duas foram excluídas da regra pública, explicitamente.

## 7 — `chaveDe()` não validava o prefixo de inquilino  ⚪ corrigido

A função recusava `..` nas partes da chave, mas **não** no `workspaceId`. Não
alcançável hoje: ele vem sempre de `getWorkspaceMember()`, resolvido no servidor
contra o banco.

Corrigido porque a garantia é de hoje: a função aceita uma string, e ela é a
peça que **define** a fronteira de inquilino no storage. É a última que deve
depender de o chamador ter conferido.

## 8 — O middleware otimista: por que não é vulnerabilidade  ✅ verificado

`getSessionCookie` **não verifica assinatura nenhuma**. Lido na implementação
(`better-auth/dist/cookies/index.mjs`): ele lê o cabeçalho `cookie`, acha o nome
esperado e devolve o valor. Então não é só cookie expirado que passa — um cookie
**inventado** passa.

Verificado página por página se isso vaza algo:

| Superfície | Comportamento com cookie forjado |
| --- | --- |
| `(dashboard)/dashboard/page.tsx` | `getWorkspaceMember()` falha → `redirect('/login')` |
| `(dashboard)/atendimento/page.tsx` | falha → redireciona para `/atendimento/conversas` |
| `(dashboard)/layout.tsx` | `marcaDaSessao()` passa pela mesma função → `null`, marca genérica |
| demais páginas do segmento | são de cliente e buscam por `/api/*`, onde a sessão é resolvida contra `auth_sessions` |
| rotas de API | 401 |

**Efeito máximo: carregar o esqueleto da interface.** Nenhum dado de paciente
atravessa.

**Mas é invariante, não coincidência.** Ela se mantém enquanto nenhuma página do
segmento renderizar dado sem chamar `getWorkspaceMember()`, e é
`scripts/lint-workspace.mjs` que impede isso de passar no build. O comentário do
middleware foi reescrito para dizer "forjado" em vez de "expirado", com a
verificação registrada.

## 9 e 10 — Presentes e não alcançáveis

**`ws@8.19.0`** (exaustão de memória por fragmentos minúsculos): vem do `openai`
e do `@supabase/supabase-js`. O caminho vulnerável é um **servidor aceitando**
WebSocket por essa biblioteca, que não é o caso — o tempo real do navegador usa
WebSocket nativo, e os Durable Objects usarão a implementação da Cloudflare.
Atualizado para 8.22.0 por override, porque era de graça.

**`langsmith@0.5.2`** (3 falhas, incluindo desserialização de manifesto não
confiável): vem de `@langchain/core`. As três exigem **tracing do LangSmith
ligado** ou pull de prompt do Hub. Conferido: nenhuma variável de ambiente de
LangSmith existe, e nada no código importa ou configura tracing. A linha 0.5.x
para em 0.5.26, ainda no intervalo vulnerável — a correção exigiria salto maior,
que `@langchain/core@1.1.20` pode não aceitar.

> **Fica como condição, não como pendência:** se alguém ligar o tracing do
> LangSmith, estas três passam a ser alcançáveis e precisam de reavaliação.

## 11 — O que segue em aberto

**Entrega de e-mail é invisível a quem pediu.** O gancho `sendResetPassword`
roda por `runInBackgroundOrAwait`: o que ele lança não chega à resposta, e
`requestPasswordReset` devolve 200 mesmo com o envio falhando. O único sinal é
uma linha de log. Precisa de contador na vigia de integrações — a mesma que já
existe para o Asaas. Registrado em [`03-go-no-go.md`](03-go-no-go.md).

## 12 — A perda aceita

A remoção do RLS tira a segunda linha de defesa contra um defeito de
autorização da aplicação. O controle saiu junto com a exposição que ele
compensava — detalhe e justificativa em
[`01-compatibility.md`](01-compatibility.md) §13 — mas o preço é real: com uma
via de acesso só, **os testes multi-tenant da Fase 5 deixaram de ser opcionais.**

---

## O que esta auditoria **não** cobriu

Para que ninguém a leia como mais do que é:

- **Não houve teste contra ambiente implantado.** A aplicação ainda não está em
  Workers; todo achado é de código e de dependência, mais execução local
  isolada contra a branch de homologação do Neon.
- **Não cobriu as superfícies que a migração ainda não tocou:** Queues e cron,
  os Durable Objects do tempo real, o Container do Evolution Go, o ciclo real
  no R2 (falta token de API) e o provedor brasileiro de storage.
- **Não cobriu os webhooks** (Asaas, Meta, Evolution) nem o widget público além
  do que o inventário registrou.
- **Não é declaração de conformidade com a LGPD.**
