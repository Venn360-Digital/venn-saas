# E-004 Channel
Product term: Channel (SpaceChannel / ContactChannel) · Parent: none · Status: draft

## Fields

| Field | Type | Required | Default | Constraints or enum | Source |
|---|---|---|---|---|---|
| id | number | sim | — | id do canal | [doc SRC-028] |
| name | string | sim | — | nome do canal | [doc SRC-028] |
| source | ChannelSource | sim | — | enum abaixo | [doc SRC-028] |
| created_at | number | sistema | — | epoch | [doc SRC-028] |
| meta | object | não | — | só em ContactChannel | [doc SRC-028] |
| lastMessageTime | number | não | — | só em ContactChannel | [doc SRC-028] |
| lastIncomingMessageTime | number | não | — | só em ContactChannel | [doc SRC-028] |

### Enum ChannelSource (autoritativo)
`facebook` · `instagram` · `line` · `telegram` · `viber` · `twitter` · `wechat` · `custom_channel` · `gmail` · `other_email` · `twilio` · `message_bird` · `nexmo` · `whatsapp` · `whatsapp_cloud` · `360dialog_whatsapp` · `twilio_whatsapp` · `message_bird_whatsapp` · `nexmo_whatsapp`. [doc SRC-028]
(Observado na trial: pelo menos um canal `instagram` conectado. [obs EV-001])
Catálogo de conexão observado (6 categorias) confirma os sources: WhatsApp Business Platform (API, via Facebook) e WhatsApp Cloud API, Messenger, Instagram, TikTok (beta), Telegram, Viber, LINE, WeChat, Custom Channel; voz: Telnyx; SMS: Twilio/Bird/Vonage/Telnyx/custom; e-mail: Google Workspace/Gmail/Yahoo/Microsoft 365/SMTP; chat: Website widget/custom. [obs EV-004]

## Relations

| Relation | Target | Cardinality | On delete | Source |
|---|---|---|---|---|
| mensagens | E-003 Message | 1—N | — | [doc SRC-028] |
| contatos | E-001 Contact | N—N (ContactChannel) | — | [doc SRC-028] |
| templates | E-012 WhatsAppTemplate | 1—N (só WhatsApp) | — | [doc SRC-028] |

## Lifecycle

Conectado → ativo → (desconectado). Criação/gestão de canais **não é exposta na API pública**; é feita no produto (Settings > Channels / Onboarding) via OAuth/BSP. [doc SRC-028]

## System fields

| Field | Set when | Source |
|---|---|---|
| id, created_at | ao conectar | [doc SRC-028] |

## Rules

- Conectar canal WhatsApp depende de BSP/Meta (ver BR-001). OAuth de canal = A5: no estudo, abrir e cancelar, nunca conectar.

## Not tested

- Fluxo real de conexão de cada canal (OAuth) — read-only por segurança.
- Quais sources estão disponíveis no plano Growth da trial.
- Configuração de canal de voz (Telnyx/Messenger Calls).
