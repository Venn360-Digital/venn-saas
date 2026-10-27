# E-mails Transacionais — Análise e Recomendações

**Data:** 2026-10-26  
**Status:** 8 tipos ativos; 3 recomendados

---

## E-mails Ativos Atualmente

### 1. **Autenticação** (1 tipo)

#### 1.1 Reset de Senha
- **Disparo:** Quando usuário solicita reset em `/auth/forgot-password`
- **Destinatário:** Usuário (independente de workspace)
- **Tone:** Neutro
- **Função:** Permitir que usuário bloqueado possa voltar ao sistema
- **Criticidade:** 🔴 Alta — sem este, usuário não consegue acessar a conta

---

### 2. **Billing / Ciclo de Vida de Avaliação** (7 tipos)

#### 2.1 Faltam 2 Dias (trial_day_5)
- **Disparo:** Cron diário, 5 dias antes do fim
- **Destinatário:** OWNER do workspace
- **Tone:** Neutro
- **Função:** Dar tempo para decisão
- **Idempotência:** Por workspace (uma vez no período)

#### 2.2 Último Dia (trial_day_6)
- **Disparo:** Cron diário, 1 dia antes do fim
- **Destinatário:** OWNER do workspace
- **Tone:** Urgente (vermelho)
- **Função:** Último aviso antes do corte
- **Idempotência:** Por workspace (uma vez no período)

#### 2.3 Avaliação Encerrada (trial_ended)
- **Disparo:** Cron que marca fim do trial
- **Destinatário:** OWNER do workspace
- **Tone:** Urgente
- **Função:** Informar corte + opção de contratar
- **Idempotência:** Por workspace (uma vez no período)

#### 2.4 80% de Créditos de IA (credits_80)
- **Disparo:** Cron diário se uso > 80%
- **Destinatário:** OWNER do workspace
- **Tone:** Neutro
- **Função:** Avisar antes de ficar sem créditos
- **Idempotência:** Por período

#### 2.5 Retenção — 60 dias até deleção (retention_60)
- **Disparo:** Cron, 60 dias após não contratação
- **Destinatário:** OWNER do workspace
- **Tone:** Neutro
- **Função:** Avisar sobre deleção com prazo
- **Idempotência:** Por workspace (uma vez no período)

#### 2.6 Retenção — 7 dias até deleção (retention_7)
- **Disparo:** Cron, 7 dias antes da deleção
- **Destinatário:** OWNER do workspace
- **Tone:** Urgente
- **Função:** Último aviso antes de deleção irreversível
- **Idempotência:** Por workspace (uma vez no período)

#### 2.7 Cobrança Vencida (payment_overdue)
- **Disparo:** Webhook do Asaas quando boleto vence
- **Destinatário:** MASTER da Account (proprietário responsável por pagamento)
- **Tone:** Urgente
- **Função:** Avisar sobre prazo de carência (5-10 dias)
- **Idempotência:** Por data de vencimento (uma vez por vencimento)

#### 2.8 Atendimento Pausado (access_suspended)
- **Disparo:** Cron, quando carência expira
- **Destinatário:** MASTER da Account
- **Tone:** Urgente
- **Função:** Informar que sistema entrou em read-only
- **Idempotência:** Por workspace (uma vez no período)

---

## Análise de Cobertura

| Evento | Coberto? | Observação |
|--------|----------|------------|
| **Auth:** Login | ❌ Não | Feedback via OAuth/SMS |
| **Auth:** Reset de senha | ✅ Sim | `sendResetPassword` |
| **Auth:** Novo usuário convidado | ❌ Não | 📋 Recomendado |
| **Workspace:** Novo workspace criado | ❌ Não | Poderia ter guia rápido |
| **Workspace:** Membro adicionado | ❌ Não | 📋 Recomendado |
| **WhatsApp:** Número não conectando | ❌ Não | Apenas avisos em Dashboard |
| **Cobrança:** Pagamento recebido | ❌ Não | 📋 Recomendado |
| **Cobrança:** Fatura disponível | ❌ Não | Apenas notificação no painel |
| **Integração:** Credencial expirada | ❌ Não | Problema aberto |
| **Agente de IA:** Ativado | ❌ Não | Apenas feedback na tela |
| **Agente de IA:** Sem crédito | ✅ Sim | `credits_80` |

---

## E-mails Recomendados

### 📋 1. Boas-vindas ao Novo Workspace
**Prioridade:** 🟡 Média  
**Disparo:** Ao criar primeiro workspace  
**Destinatário:** OWNER do workspace  
**Motivo:**
- Primeira impressão (SaaS best practice)
- Oportunidade de guiar onboarding
- Reduz abandono antes de primeiro uso

**Conteúdo sugerido:**
- Parabéns + contexto (clínica/unidade criada)
- Links para: Dashboard, WhatsApp setup, Docs
- Contato de suporte (WhatsApp ou email)

---

### 📋 2. Convite para Novo Membro
**Prioridade:** 🟢 Alta  
**Disparo:** Quando OWNER convida colega  
**Destinatário:** Novo membro (email do convite)  
**Motivo:**
- Onboarding de equipe é crítico
- Email é o canal oficial de notificação
- Sem ele, convite é "silencioso" (só fica na interface)

**Conteúdo sugerido:**
- "Você foi convidado para [clínica] no OdontoBox360"
- Nome de quem convidou + role
- Link direto para aceitar
- Contexto: qual workspace / qual setor

---

### 📋 3. Confirmação de Pagamento Recebido
**Prioridade:** 🟢 Alta  
**Disparo:** Webhook do Asaas quando boleto é pago  
**Destinatário:** MASTER da Account  
**Motivo:**
- Reduz suporte ("já paguei, por que não funciona?")
- Tranquilidade para cliente
- Confirmação de quanto foi cobrado + próxima data

**Conteúdo sugerido:**
- Confirmação de recebimento
- Valor pago + data
- Próxima cobrança (data)
- Restauração automática (vai voltar em 24h)
- Link para fatura

---

## Estrutura de Decisão Recomendada

Para cada novo tipo, considerar:

1. **Criticidade:** Sem este e-mail, usuário perde funcionalidade?
2. **Timing:** É tempo-crítico (horas vs dias)?
3. **Idempotência:** A mesma situação pode disparar múltiplas vezes?
4. **Destinatário:** OWNER do workspace, MASTER da Account, ou User?
5. **Contexto dinâmico:** Precisa de valores (data, valor, nome)?

---

## Implementação dos Recomendados

Se aprovado para implementar:

1. **Adicionar tipos** a `BillingEmailKind` (ou criar tipo novo)
2. **Criar copy** em `copyFor()` do `billing.ts`
3. **Adicionar disparador:**
   - Cron: adicionar em `src/trabalhos/processadores/cron/`
   - Webhook: adicionar em processador existente (Asaas, etc)
   - API: hook em rota (ex: POST `/workspaces`)
4. **Testar idempotência** antes de deploy

---

## Resumo de Impacto

### Cadeia de Valor
```
Signup → Primeiro uso → Contratação → Pagamento → Renovação
   ↓           ↓              ↓             ↓          ↓
  [?]      [Bem-vindo?]   [Avisos]   [Confirmação] [Avisos]
                                     [Recomendado]
```

### Gaps Críticos
- ❌ Novo workspace: sem guia rápido
- ❌ Pagamento: sem confirmação de recebimento
- ⚠️ Convite: sem e-mail de notificação

### Oportunidades Rápidas
- **Convite:** 2-3 horas de implementação
- **Boas-vindas:** 1-2 horas de implementação
- **Confirmação de pagamento:** 1-2 horas + webhook do Asaas já existe

