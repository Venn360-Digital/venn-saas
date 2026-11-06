# Open questions

| ID | Question | Why it matters | How to answer | Status |
|---|---|---|---|---|
| Q-001 | Segmento-alvo exato do clone no Brasil (suporte? vendas? agência? porte)? | Define pesos de mercado das barreiras e prioridades do PRD | André confirma | open |
| Q-002 | Decisão sobre termos de uso: os ToS do respond.io (SRC-021) **não** proíbem engenharia reversa nominalmente, mas vedam reproduzir/explorar "any portion" (§6.4) e criar derivados (§1.2). Prosseguir com clone clean-room? | Risco jurídico/contratual do próprio estudo e do clone | André + jurídico decidem (ver "Needs human") | open |
| Q-003 | Requisitos atuais do programa **Meta Tech Provider / BSP** (due diligence, prazos, custo) para o clone acessar a WhatsApp Cloud API direto | Determina se BR-001 é blocks launch real e o lead time | Jurídico/BizDev + docs Meta | open |
| Q-004 | Audit logs do respond.io são Advanced/Enterprise ou todos os planos? | Afeta BR-003 e paridade enterprise | Observar em Settings logado / suporte | open |
| Q-005 | Tabela oficial Meta de pricing por mensagem no **Brasil** (marketing/utility/auth/service), valores 2026 | Custo variável do canal WhatsApp no modelo de negócio | Confirmar em developers.facebook.com (SRC-025) | open |
| Q-006 | Leitura jurídica LGPD: base legal para tratar conteúdo de conversa, exigência de DPO, regras de transferência internacional p/ operador estrangeiro | Define BR-002 (blocks feature enterprise) | Advogado (LGPD) | open |
| Q-007 | PSP/gateway brasileiro para billing do SaaS (Pix/boleto/cartão) e viabilidade de pagamento-no-chat | BR-004 custo e escopo de commerce | BizDev + jurídico | open |
| Q-008 | Modelo fiscal do SaaS no Brasil (NFS-e municipal, ISS, regime tributário) | BR-005 lead time de faturamento | Contador | open |
| Q-009 | Regras locais de SMS (registro de remetente/short code, antispam) e deliverability e-mail | BR-006 | Provedor SMS/e-mail + jurídico | open |
| Q-010 | Enums de produto. **Parcial [net EV-007]:** status inclui `pending`; snooze/auto-close confirmados; janela 24h via `messageWindowExpiry`; lifecycle é FK `lifecycleId`. **Falta:** mapa lifecycleId→nome, categorias/status de template WhatsApp, shape real de paginação, assinatura de webhook | Modelo de dados do clone | Observar no produto + api-shapes.js | partial |
| Q-011 | Matriz de permissões por papel (Owner/Manager/Agent) e flags por usuário | Modelo de permissões do clone | **Resolvido [obs EV-016]**: 3 papéis + restrições avançadas (visibilidade/chamadas/workflows/masking PRO) em `data-model/permissions.md`. Falta só as flags finas em "Alterar". | resolved |
