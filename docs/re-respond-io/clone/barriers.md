# Production barriers: respond.io

Clone target market: Brasil, PMEs/agências de atendimento conversacional WhatsApp-first (ver `00-charter.md`).
Not legal advice. Leituras jurídicas sem fonte são `[inf]` com um `Q-###` para o jurídico em `questions.md`.
Datas de leitura das fontes: 2026-10-25 (ver `sources.md`); o PRD trata fontes com mais de 6 meses como a reverificar.

## Summary

Launch blockers primeiro.

| Barrier | Category | Severity | Market weight | Blocks | Lead time |
|---|---|---|---|---|---|
| BR-001 WhatsApp/Meta (BSP, verificação, templates, pricing) | permissioned integration | blocks launch + moat | required to sell | F-002, F-012, F-039, F-050, F-084 | 2–8 semanas |
| BR-002 LGPD (DPA, DPO, transferência internacional) | regulation | adds lead time → blocks feature | required to sell (BR) | F-082, F-083, cross | 4–8 semanas |
| BR-003 SSO + audit logs (+ SOC 2 ausente) | enterprise requirement | blocks feature + moat | important | F-083 | SSO 2–4 sem; SOC 2 6–12 meses |
| BR-004 Pix e meios de pagamento locais | regulation/payments | adds cost / blocks feature (parcial) | important | operação do clone; commerce no chat | 1–3 semanas |
| BR-005 NF-e / NFS-e (faturamento do SaaS) | regulation/fiscal | adds lead time + adds cost | required to operate | operação do clone | 1–2 semanas |
| BR-006 Limites de e-mail/SMS (deliverability) | distribution | adds lead time + adds cost | minor–important | canais auxiliares e-mail/SMS | SMS short code 2–6 semanas |

### BR-001 Mensagens WhatsApp exigem Meta Business Platform via BSP
- Category: permissioned integration
- Blocks: F-002 (conectar canal WhatsApp), F-012 (chamadas), F-039 (voice), F-050 (broadcast), F-084 (catálogo de canais)
- Gatekeeper: Meta, WhatsApp Business Platform
- Severity: blocks launch + moat
- Market weight: required to sell (CRM conversacional no Brasil é WhatsApp-first) [inf] Q-003
- What it takes: o produto é uma camada sobre o WhatsApp Business Platform; respond.io é **BSP oficial e Meta Business/Premier Partner**, conecta via **WhatsApp Cloud API** direto à Meta. O clone precisa ser **BSP / Meta Tech Provider** ou revender via BSP. Exige verificação de negócio (Meta Business Verification), números na plataforma e **aprovação de templates**.
- Pricing: modelo **por mensagem entregue** desde 2025-07-01 (categorias marketing/utility/authentication/service; janela service 24h grátis). Valores Brasil [doc SRC-026] a confirmar na tabela oficial Meta — Q-005.
- Lead time and cost: 2–8 semanas (verificação + onboarding BSP); custo variável por mensagem (repasse Meta) + eventual markup de BSP [doc SRC-025]
- Mitigation: integrar como Tech Provider próprio via Cloud API; começar revendendo por BSP estabelecido para encurtar time-to-market
- Evidence: [doc SRC-023] [doc SRC-024] [doc SRC-025] [doc SRC-026]

### BR-002 LGPD — dados pessoais de conversa, DPA, DPO, transferência internacional
- Category: regulation and data protection
- Blocks: F-082 (contatos), F-083 (settings/retention), transversal (todo o conteúdo de conversa)
- Gatekeeper: ANPD; times de compliance dos clientes
- Severity: adds lead time; vira blocks feature para vender grande conta sem DPA/residência
- Market weight: required to sell no Brasil [inf] Q-006
- What it takes: base legal/consentimento, encarregado (DPO), direitos do titular (acesso/correção/eliminação), política de retenção, DPA com cláusulas de transferência internacional, registro de subprocessadores. respond.io opera via **Rocketbots Malaysia** + subprocessadores US/UE → transferência internacional inerente. [doc SRC-022] [doc SRC-027]
- Lead time and cost: 4–8 semanas; DPO + assessoria jurídica
- Mitigation: DPA em PT-BR, nomear encarregado, mapear fluxo de dados de conversa, retenção configurável, avaliar residência AWS São Paulo (sa-east-1)
- Evidence: [doc SRC-022] [doc SRC-027] · leitura jurídica [inf] Q-006

### BR-003 SSO + audit logs como requisito enterprise (e SOC 2 ausente no original)
- Category: certifications buyers require / enterprise must-haves
- Blocks: F-083 (settings de segurança)
- Gatekeeper: time de segurança/compliance do comprador
- Severity: blocks feature (enterprise) + moat
- Market weight: important (obrigatório só em contas grandes)
- What it takes: SSO/SAML + SCIM + audit logs. No respond.io, SSO é **Advanced+** [doc SRC-017]; ISO 27001 sim, **SOC 2 não mencionado publicamente** [doc SRC-019] [doc SRC-020] — oportunidade de moat se o clone obtiver SOC 2.
- Lead time and cost: SSO/SAML 2–4 semanas de dev; SOC 2 Type II 6–12 meses de observação + custo de auditoria
- Mitigation: implementar SAML/SCIM e audit log cedo; priorizar ISO 27001 e, se visar US, SOC 2
- Evidence: [doc SRC-017] [doc SRC-020] · plano do audit log a confirmar Q-004

### BR-004 Pix e meios de pagamento locais
- Category: payments / regulation
- Blocks: operação do clone (cobrar clientes) e, se houver, pagamento-no-chat (commerce)
- Gatekeeper: PSP/adquirente, Banco Central (arranjo Pix)
- Severity: adds cost (billing) / blocks feature parcial (se prometer pagamento-no-chat)
- Market weight: important
- What it takes: gateway local com Pix/boleto/cartão + conciliação; para commerce no WhatsApp, checkout/Pix integrado
- Lead time and cost: 1–3 semanas (integração PSP); taxa de gateway
- Mitigation: integrar PSP brasileiro para billing; pagamento-no-chat como fase 2
- Evidence: [inf] Q-007

### BR-005 NF-e / NFS-e para faturar o SaaS no Brasil
- Category: regulation / fiscal
- Blocks: faturar legalmente a operação do clone (não bloqueia o produto)
- Gatekeeper: prefeitura (NFS-e), Receita Federal
- Severity: adds lead time + adds cost
- Market weight: required to operate
- What it takes: emissão de NFS-e municipal por cliente PJ; retenções (ISS); enquadramento tributário
- Lead time and cost: 1–2 semanas com contador; emissor de NFS-e (API) + contabilidade
- Mitigation: emissor de NFS-e integrado + contabilidade; definir regime tributário
- Evidence: [inf] Q-008

### BR-006 Limites e deliverability de e-mail/SMS (canais auxiliares)
- Category: distribution gatekeepers
- Blocks: canais auxiliares e-mail/SMS (notificação/opt-in/OTP)
- Gatekeeper: provedores (SendGrid), operadoras de telefonia, regras antispam
- Severity: adds lead time + adds cost
- Market weight: minor–important (core é WhatsApp; e-mail/SMS complementam)
- What it takes: SPF/DKIM/DMARC e reputação (e-mail); registro de remetente/short code e regras antispam (SMS Brasil)
- Lead time and cost: SMS short code 2–6 semanas
- Mitigation: configurar SPF/DKIM/DMARC; provedor de SMS com registro no Brasil; aquecer domínio/IP
- Evidence: [doc SRC-022] · regras locais [inf] Q-009
