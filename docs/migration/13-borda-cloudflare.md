# A borda da Cloudflare — o que está configurado, e por quê

> **Este documento existe porque o repositório não tinha nenhum.** Em
> 2026-10-24, a auditoria de segurança encontrou a zona `venn360.com` com zero
> regra própria, e as cinco que foram criadas naquela madrugada passaram a viver
> **só no painel**. Configuração que não está em lugar nenhum do código é
> configuração que ninguém revisa, ninguém sabe que existe, e que some numa
> troca de conta sem deixar rastro.
>
> `cloudflare.config.ts` declara o Worker, os bindings e os gatilhos. Ele **não**
> declara WAF, rate limiting, Access nem DNS — a API deles é de zona e de conta,
> não de script. Então o registro é este arquivo. **Mudou a borda, mude aqui.**

Zona: `venn360.com` · id `f01f6a4a622fb37f5ba0c7bbe0869fde` · plano **Free**
Conta: `7ee4810a45580562977d68b86ec709e7`

---

## 1. Rotas e DNS

| Nome | Tipo | Destino | Proxy |
|---|---|---|---|
| `odontobox.venn360.com` | AAAA `100::` | Custom Domain do Worker `odontobox` | sim |
| `evo-odontobox.venn360.com` | CNAME | `8d90f2b1-…cfargotunnel.com` | sim |

O `AAAA 100::` não é endereço real — é o marcador que a Cloudflare usa para um
hostname servido por Worker. O Worker é alcançado por **Custom Domain**, não por
Route: `cloudflare.config.ts` não tem `routes`.

**`workersDev: false`.** O subdomínio `odontobox.andre-7ee.workers.dev` está
desligado e responde 404. Ele servia o app inteiro e **não é da zona**, logo
nada do que está neste documento o alcançava. Até 2026-10-24 02:11 UTC **todo
webhook de WhatsApp entrava por ele**, porque era o valor gravado em
`WEBHOOK_BASE_URL` — a mensagem de paciente entrava pela porta sem borda.

`previewUrls: true` continua ligado: as URLs por PR (`pr-<n>-odontobox.andre-7ee.workers.dev`)
são outro mecanismo e desligá-las cegaria a revisão.

**Dois registros foram apagados** em 2026-10-24: `odontobox-api.venn360.com` e
`odontobox.evo.venn360.com`, ambos `A 157.254.207.42` (a Stay Cloud formatada) e
ambos **sem proxy**. Registro pendurado em IP que não é mais seu é tomada de
subdomínio com certificado TLS válido.

---

## 2. Regras próprias

Ruleset `regras-proprias` · `bb6f080ba6444e36bad0c2d49a4e5298` · fase
`http_request_firewall_custom`. **3 das 5 regras grátis ainda livres.**

### 2.1 Sondagem de caminho inexistente — `7ffc14d07cd14d92bb068402d55fd3d8`

```
(lower(http.request.uri.path) contains "/.env") or … "/.git" … "/wp-login"
… "/wp-admin" … "/xmlrpc.php" … "/phpmyadmin" … "/.ssh/" … "/.aws/"
… "/.ds_store" … "/vendor/"   →   block
```

Nenhum desses caminhos existe no app. Bloquear na borda **não é sobre segurança,
é sobre custo**: cada sondagem que chega ao Worker gasta invocação e pode acordar
o compute do Neon, cuja franquia é de 100 CU-hora/mês (ver
[`00-open-decisions.md`](00-open-decisions.md) e `src/lib/cron/agenda.ts`).

### 2.2 Webhook do Evolution travado na Vultr — `c1c1d3331574494bbc87787233fd5bd5`

```
starts_with(http.request.uri.path, "/api/webhooks/evolution-go/")
  and not ip.src in {216.238.127.233 2001:19f0:b800:2539::/64}   →   block
```

O webhook autentica por **segredo no caminho da URL**, porque o Evolution Go não
assina o que emite e o `/instance/connect` não aceita header (ver
`lib/whatsapp/webhook-evolution-go.ts`). Segredo em caminho aparece em log de
proxy. O IP é a segunda tranca.

A origem foi **medida**, não suposta — `wrangler tail` em 2026-10-24:
`ip=216.238.127.233`, `user-agent=Go-http-client/2.0`. O IPv6 entra como `/64`
porque o endereço específico pode mudar dentro da rede numa reconfiguração.

**Provada nas duas direções, em 2026-10-24.** Bloquear é fácil de verificar; o
que custa é provar que ela **não bloqueia demais**, e para isso só serve tráfego
real:

```
de fora   POST /api/webhooks/evolution-go/…        → 403 da Cloudflare
da Vultr  (log do Evolution, 01:32:43 BRT)
          webhook sent successfully · status: 200
          response: {"received":true,"queued":1,"skipped":0}
```

O 200 veio de uma mensagem de WhatsApp de verdade, atravessando a regra. Sem
essa metade, a regra estaria "configurada" e não "funcionando" — e a diferença
só apareceria quando um paciente escrevesse.

> ### ⚠️ Esta regra falha em silêncio
>
> **Se o IP da instância Vultr mudar, o WhatsApp para de receber e nada avisa.**
> As mensagens simplesmente não chegam, e a tela continua dizendo "No ar" — o
> `integration-health` confere a *conexão com o provedor*, não se o webhook está
> sendo entregue.
>
> Mexeu na instância `odontobox` (`c7e5d07a-e0dc-42ef-9323-eb6e33c28683`)?
> **Atualize esta regra junto.** Ver também o aviso em
> [`12-evolution-vps.md`](12-evolution-vps.md).

---

## 3. Limite de taxa

Ruleset `limite-de-taxa` · `4345aafeec964c8eb06f976b89b03e37` · regra
`aa08391245d4424f9443e4a8076cc392`

```
(http.request.method eq "POST" and starts_with(http.request.uri.path, "/api/auth/"))
→ block · 20 por 10 s · por ip.src + cf.colo.id · mitigação 10 s
```

**Não é o limite principal.** A aplicação limita em banco — 10/min no sign-in,
5/h no cadastro e na redefinição (`lib/auth/better-auth.ts`), e isso é
deliberado: em Workers um contador em memória é por isolate, ou seja quase sem
limite. A regra da borda existe para a enxurrada não custar invocação do Worker
e consulta ao Neon **antes** de ser barrada.

O plano Free só aceita **janela de 10 s** — tentar 60 devolve
`not entitled to use the period 60, can only use a period among [10]`.

O teto de 20 é folgado de propósito. A primeira versão tinha 10, e dez
atendentes de uma clínica atrás do mesmo NAT, entrando às 8h da segunda, bateriam
exatamente nisso.

---

## 4. Access / Zero Trust

Organização `snowy-boat-ed98.cloudflareaccess.com`, criada em 2026-10-24.

| Aplicação | Domínio | Tipo | Política |
|---|---|---|---|
| `evolution-go` · `2e5772ad-…` | `evo-odontobox.venn360.com` | self_hosted | `non_identity` (Service Auth) |

Service token `odontobox-worker` · `892e1e51de799e177bbf9a0b85ba5259.access`.
Os dois valores estão nos segredos do Worker como `CF_ACCESS_CLIENT_ID` e
`CF_ACCESS_CLIENT_SECRET`, declarados em `cloudflare.config.ts` — **declarados
porque aquela configuração é declarativa**: segredo gravado e não declarado é
removido no deploy seguinte.

**Sem política de navegador, de propósito.** O único cliente desse hostname é o
Worker (`lib/whatsapp/evolution-go.ts`, dois pontos de chamada). O Evolution é
administrado por túnel SSH para `localhost:8080`, que não passa pela borda.

**O token não expira** (ano 2126, padrão do painel) e
`service_token_inactivity` está desligado na conta. É credencial permanente para
o plano de controle do WhatsApp — vale trocar por uma de 1 ano e agendar
rotação.

### A ordem de implantação, que não pode inverter

1. criar o service token;
2. gravar os dois segredos no Worker;
3. publicar o código que os envia;
4. **só então** criar a aplicação do Access.

Inverter 3 e 4 derruba a linha: a Cloudflare passa a devolver 403 para um Worker
que ainda não manda credencial. É por isso que `cabecalhosDoAccess()` devolve
`{}` quando o segredo falta — inofensivo antes de trancar, necessário depois.

---

## 5. O que está DESLIGADO de propósito

| Recurso | Estado | Por quê |
|---|---|---|
| `ai_bots_protection` | disabled | Decisão do André (2026-10-19): os sites têm de ser legíveis por IA |
| `crawler_protection` | disabled | idem |
| `ai_training` | disabled | idem |
| `fight_mode` (Bot Fight) | disabled | idem — ele barra crawler de IA junto |

**Não religue nenhum** sem rever aquela decisão. Em zona nova o padrão da
Cloudflare é recusar treinamento, então isso precisa ser desfeito de propósito.

Managed rulesets ativos (não são nossos, vêm da Cloudflare): Normalization,
Managed Response Firewall, **Managed Free Ruleset** e DDoS L7.

---

## 6. O que NÃO está configurado, e a razão

| | |
|---|---|
| **mTLS / API Shield** | Enterprise. Não cabe no Free, e o Access com service token cobre o caso que importava |
| **Bot Management pago** | conflita com a decisão de legibilidade por IA |
| **CSP com nonce** | avaliado em 2026-10-24 e **recusado por ora**. Exige renderização dinâmica e a auditoria não achou nenhum vetor de XSS alcançável — sem `dangerouslySetInnerHTML`, sem `eval`, sem `innerHTML` dinâmico. Defesa em profundidade sem violação alcançável não paga mudança arquitetural em 22 páginas. O lugar dele, quando valer, é `src/proxy.ts` |
| **Vigia de inbound parado** | o modo de falha silencioso da regra 2.2 mereceria um alerta de "nenhuma mensagem recebida em N horas no expediente". Não construído: é funcionalidade nova com limiar a definir, não conserto |

Os cabeçalhos de resposta (CSP, HSTS, `nosniff`, `X-Frame-Options`,
`Referrer-Policy`, `Permissions-Policy`) **não** estão na borda: estão em
`next.config.ts`, versionados e revisáveis. Ver o comentário de lá para a razão
de cada diretiva.

---

## 7. Como conferir que tudo isto está de pé

```bash
# a sondagem é bloqueada na borda (403 da Cloudflare, não do app)
curl -s -o /dev/null -w '%{http_code}\n' https://odontobox.venn360.com/.env

# o webhook recusa quem não é a Vultr
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  https://odontobox.venn360.com/api/webhooks/evolution-go/qualquer

# o túnel recusa quem não tem o service token
curl -s -o /dev/null -w '%{http_code}\n' https://evo-odontobox.venn360.com/server/ok

# o workers.dev está fechado
curl -s -o /dev/null -w '%{http_code}\n' https://odontobox.andre-7ee.workers.dev/api/health

# e o uso normal passa
curl -s -o /dev/null -w '%{http_code}\n' https://odontobox.venn360.com/login
```

Esperado: `403 · 403 · 403 · 404 · 200`.

**O que esses comandos não provam:** que a Vultr **ainda passa** pela regra 2.2.
Para isso só serve uma mensagem de WhatsApp de verdade. Foi exercitado em
2026-10-24 e está registrado em §2.2 — mas é a metade que envelhece: ela volta a
valer a cada mudança na instância, e nenhum `curl` a substitui.

Para refazer:

```bash
npx wrangler tail odontobox --format json
```

Mande uma mensagem ao número da clínica e procure `webhook sent successfully`
com `status: 200` no log do Evolution (`docker logs` na Vultr), ou
`FILA odontobox-whatsapp-inbound` no tail.
