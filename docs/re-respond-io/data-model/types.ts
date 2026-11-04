// Modelo de dados do respond.io para o clone (stack alvo: TypeScript).
// Fonte primária: SDK TypeScript OFICIAL [doc SRC-028] (enums e campos autoritativos).
// Complementos: API ref [doc SRC-029], OpenAPI reconstruído [doc SRC-030] (menos confiável).
// Lacunas marcadas com `// GAP Q-010` precisam ser observadas no produto logado.
// Nomes de campo em inglês (padrão do produto). Timestamps = Unix epoch (segundos).

// ───────────────────────── Enums (autoritativos, SDK [doc SRC-028]) ─────────────────────────

export type ChannelSource =
  | 'facebook' | 'instagram' | 'line' | 'telegram' | 'viber' | 'twitter' | 'wechat'
  | 'custom_channel' | 'gmail' | 'other_email'
  | 'twilio' | 'message_bird' | 'nexmo'
  | 'whatsapp' | 'whatsapp_cloud'
  | '360dialog_whatsapp' | 'twilio_whatsapp' | 'message_bird_whatsapp' | 'nexmo_whatsapp';

export type MessageType =
  | 'text' | 'attachment' | 'quick_reply' | 'email' | 'custom_payload' | 'whatsapp_template';

export type AttachmentType = 'image' | 'video' | 'audio' | 'file';

export type MessageTraffic = 'incoming' | 'outgoing';

export type MessageStatusValue = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';

export type MessageSenderSource = 'user' | 'ai_agent' | 'workflow' | 'api' | 'echo' | 'broadcast';

export type MessengerMessageTag = 'ACCOUNT_UPDATE' | 'POST_PURCHASE_UPDATE' | 'CONFIRMED_EVENT_UPDATE';

// Status de conversa EXPOSTO na API = apenas open|close [doc SRC-028].
// O produto mostra também "pending"/"snoozed" na UI → GAP Q-010 (confirmar enum real do produto).
export type ConversationApiStatus = 'open' | 'close';

export type UserRole = 'agent' | 'manager' | 'owner';

export type UserRestriction =
  | 'restrict_data_export' | 'restrict_contact_deletion' | 'restrict_space_setting'
  | 'show_team_contacts' | 'show_only_mine' | 'restrict_space_integration' | 'restrict_shortcuts';

export type CustomFieldDataType =
  | 'text' | 'list' | 'checkbox' | 'email' | 'number' | 'url' | 'date' | 'time';

export type FilterCategory = 'contactField' | 'contactTag' | 'lifecycle';

export type FilterOperator =
  | 'isEqualTo' | 'isNotEqualTo' | 'isTimestampAfter' | 'isTimestampBefore' | 'isTimestampBetween'
  | 'exists' | 'doesNotExist' | 'isGreaterThan' | 'isLessThan' | 'isBetween'
  | 'hasAnyOf' | 'hasAllOf' | 'hasNoneOf';

// WhatsApp template
export type TemplateComponentType = 'header' | 'body' | 'footer' | 'buttons';
export type TemplateFormat = 'text' | 'image' | 'video' | 'document' | 'location';
export type TemplateButtonType = 'quick_reply' | 'phone_number' | 'url' | 'catalog' | 'mpm';

// Estágios de lifecycle: string livre na API [doc SRC-028]; enum do tenant NÃO publicado.
// Defaults observados no produto: New Lead | Hot Lead | Payment | Customer (+ Cold Lead perdido) → confirmar Q-010.
export type LifecycleStage = string;

// ───────────────────────── Entidades ─────────────────────────

export interface Contact {
  id: number;
  firstName: string;            // obrigatório na criação
  lastName: string | null;
  phone: string | null;
  email: string | null;
  language: string | null;
  profilePic: string | null;    // uri
  countryCode: string | null;
  custom_fields: CustomFieldValue[] | null;
  status: 'open' | 'close';     // status da conversa corrente (NÃO é lifecycle)
  tags: string[];               // nomes de tags
  assignee: User | null;
  lifecycle: LifecycleStage | null;
  created_at: number;           // epoch
}

export interface CustomFieldValue { name: string; value: string | number | boolean | null }

export interface User { id: number; firstName: string; lastName: string; email: string }

export interface SpaceUser extends User {
  role: UserRole;
  team: Team | null;
  restrictions: UserRestriction[];
}

export interface Team { id: number; name: string }

export interface SpaceChannel { id: number; name: string; source: ChannelSource; created_at: number }
export interface ContactChannel extends SpaceChannel {
  meta?: Record<string, unknown>;
  lastMessageTime?: number;
  lastIncomingMessageTime?: number;
}

export interface SpaceTag { id: number; name: string; description?: string; emoji?: string; colorCode?: string }

export interface CustomField {
  id: number; name: string; description: string;
  dataType: CustomFieldDataType; allowedValues?: string[];
}

export interface ClosingNote { category: string; description: string }

export interface Comment { contactId: number; text: string; created_at: number } // interno; menção @[email]

// Conversa: leitura reconstruída [doc SRC-030]; status API open|close [doc SRC-028].
export interface Conversation {
  contactId: number;
  status: ConversationApiStatus;
  assignee: User | null;
  opened: number;               // epoch
  closed: number | null;        // epoch
  // category/summary = closing note aplicada ao fechar
}

// Mensagem (union discriminado por `type`)
export type Message =
  | { type: 'text'; text: string; messageTag?: MessengerMessageTag }
  | { type: 'attachment'; attachment: { type: AttachmentType; url: string } }
  | { type: 'quick_reply'; title: string; replies: string[] }
  | { type: 'email'; text: string; subject?: string; cc?: string[]; bcc?: string[];
      replyToMessageId?: number; attachments?: { type: string; url: string; fileName: string }[] }
  | { type: 'custom_payload'; payload: Record<string, unknown> }
  | { type: 'whatsapp_template'; template: WhatsAppTemplateSend };

export interface GetMessageResponse {
  messageId: number;
  channelMessageId: string | number;
  contactId: number;
  channelId: number;
  traffic: MessageTraffic;
  message: Message;
  status?: { value: MessageStatusValue; timestamp: number; message?: string }[];
  sender?: {
    source: MessageSenderSource;
    userId?: number; teamId?: number; workflowId?: number; broadcastHistoryId?: number;
  };
}

export interface WhatsAppTemplateSend {
  name: string; languageCode: string; components?: TemplateComponent[];
}
export interface TemplateComponent {
  type: TemplateComponentType; format?: TemplateFormat;
  text?: string; parameters?: { type: TemplateFormat; [k: string]: unknown }[];
  buttons?: { type: TemplateButtonType; [k: string]: unknown }[];
}
export interface WhatsAppTemplate {
  id: number; name: string; components: TemplateComponent[]; bundle?: string;
  channelId: number; botId: number; languageCode: string; namespace?: string;
  category: string; status?: string; statusDetail?: string;
}

// Filtro de contatos (usado em POST /contact/list)
export interface ContactFilter {
  search?: string; timezone: string;
  filter: { $and?: FilterCondition[]; $or?: FilterCondition[] };
}
export interface FilterCondition {
  category: FilterCategory; field: string; operator: FilterOperator; value: unknown;
}

// ───── Conceitos de produto SEM entidade na API pública (gerenciados só no app) [doc SRC-028] ─────
// Broadcast  → aparece só como sender.source='broadcast' + broadcastHistoryId. Modelar no clone: E-013.
// Workflow   → aparece só como sender.source='workflow' + workflowId. Modelar no clone: E-014.
// Snippet    → sem endpoint. Modelar no clone: E-015.
// AI Agent   → aparece só como assignee / sender.source='ai_agent'. Modelar no clone: E-016.
// Estes serão especificados por observação no produto (deep dive), não pela API.
