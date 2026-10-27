# Migração para Cloudflare Email Sending

**Data:** 2026-10-26  
**Mudança:** de Resend → Cloudflare Email Sending  
**Status:** código migrado; aguardando configuração no painel

## O que mudou no código

| Aspecto | Antes | Depois |
|---------|-------|--------|
| Provider | Resend (HTTP API) | Cloudflare Email Sending |
| Implementação | `src/lib/email/send.ts` | Cloudflare Binding `env.EMAIL` |
| Config | `RESEND_API_KEY` em secret | Binding declarado em `cloudflare.config.ts` |
| Rate limit | Nenhum (estava aberto) | 5 envios/60s por IP em memória de Worker |
| Remetente | Qualquer domínio | Subdomínio dedicado `mail.venn360.com` |

## Checklist de configuração no painel da Cloudflare

### 1. Onboardar o subdomínio de envio

1. Ir para a zona **`venn360.com`** no painel da Cloudflare
2. Abrir **Email Sending** (ou procurar por "Email" no menu)
3. Clicar em **Create Email Routing Rule** ou **Add sender domain**
4. Adicionar `mail.venn360.com` como subdomínio de envio
5. Copiar os **registros DKIM** que a Cloudflare gera
6. Aplicar no DNS (se não estiver já na Cloudflare, aplicar no seu nameserver)
   - Três registros `CNAME` com prefixos `_dkim1.`, `_dkim2.`, `_dkim3.`
   - Um registro `CNAME` para `_domainkey`

**Validação:** o painel marcará verde quando a Cloudflare conseguir validar os registros (pode levar minutos).

### 2. Verificar o destination address

1. Ainda em **Email Sending**, procurar por **Destination Addresses** ou **Verified Recipients**
2. Verificar se `odontobox360@mail.venn360.com` está lá
   - Se não estiver, ir para **Email Routing** → **Catch-all address** e adicionar
   - Uma caixa de confirmação chegará no e-mail de destino; clicar no link para confirmar
3. **Sem esta verificação, o envio fica restrito a Workers Paid** e custa por destinatário

### 3. Garantir que o MX do apex não foi alterado

1. Ir para **DNS** na zona `venn360.com`
2. Verificar que o **MX record do apex** (`venn360.com`) aponta para o provedor original (Hostinger, Google, outro)
3. **Nunca mexer no MX do apex.** O subdomínio `mail.venn360.com` não precisa de MX, só de CNAME para DKIM

**Por quê?** Se mexer no MX do apex quebra a caixa de entrada do domínio principal e é impossível revertir rápido.

### 4. Testar o envio manual

1. Ir para uma rota de teste ou executar localmente com:
   ```bash
   # Verificar se o envio está pronto
   curl -X POST http://localhost:3000/api/test-email \
     -H "Content-Type: application/json" \
     -d '{"to":"seu-email@test.com", "subject":"Teste", "html":"<p>Teste</p>"}'
   ```
2. Confirmar que a mensagem chegou
3. Testar o rate limit:
   ```bash
   # Enviar 6 vezes seguidas do mesmo IP
   for i in {1..6}; do
     curl -X POST http://localhost:3000/api/test-email \
       -H "Content-Type: application/json" \
       -d '{"to":"seu-email@test.com", "subject":"#'$i'", "html":"Test '$i'"}'
   done
   # A 6ª deve retornar 429 (Too Many Requests)
   ```

## Limpeza de Resend

Depois que a Cloudflare estiver funcional:

1. ✅ Código: `RESEND_API_KEY` já removido de `cloudflare.config.ts`
2. ✅ Env: `RESEND_API_KEY` já removido de `.env.example`
3. **Secret:** remover com `wrangler secret delete RESEND_API_KEY --name odontobox`
4. **Histórico:** procurar a chave no histórico do git — se foi commitada, revogar no painel do Resend
   ```bash
   git log -S "RESEND_API_KEY" --oneline
   # Se encontrar, clicar no commit e procurar pelo valor
   ```

## Campos de erro esperados

Se algo der errado, o erro traz um `code` que diz:

| Código | Significado | Solução |
|--------|-------------|---------|
| `E_SENDER_NOT_VERIFIED` | Remetente (`mail.venn360.com`) não onboardado | Ver passo 1 acima |
| `E_RATE_LIMIT_EXCEEDED` | 5+ envios/min do mesmo IP | Esperar 60s ou usar IP diferente |
| `E_INVALID_ADDRESS` | Destinatário não verificado | Ver passo 2; também, testar com `odontobox360@mail.venn360.com` |

## Verificação final

Depois de tudo:
1. Enviar um e-mail de teste de verdade (cron de billing, signup, etc.)
2. Conferir que chega em menos de 30s
3. Conferir que o `Reply-To` endereça o remetente, não o técnico
4. Testar com subject ou corpo que teria injetado header de e-mail (ver `send.ts` para saneamento)

**🎯 Deploy:** Não é necessário; `cloudflare.config.ts` já está pronto e os bindings são declarativos.

