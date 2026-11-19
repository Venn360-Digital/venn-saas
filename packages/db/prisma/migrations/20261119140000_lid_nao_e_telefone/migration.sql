-- O LID sai de `phone` e passa a ter coluna própria.
--
-- ## O defeito, medido
--
-- O WhatsApp passou a endereçar contas por **LID** — um identificador de conta
-- que não é telefone e existe justamente para não ser. No inbound do canal QR
-- (Evolution Go/whatsmeow) o JID chega como `<id>@lid`, e `toMsisdn` tira o
-- sufixo de qualquer JID: sobram dígitos plausíveis, e eles eram gravados em
-- `contacts.phone`.
--
-- Em 19/11/2026, na base da Implante Já:
--
--   14 fichas com LID em `phone` (14 ou 15 dígitos), todas `createdVia=inbound`,
--   todas criadas a partir de 11/11/2026;
--   18 mensagens de saída para elas, **todas** com `status = 'failed'`.
--
-- Zero respostas entregues. O envio monta `<numero>@s.whatsapp.net`, e um LID
-- ali não é conta de ninguém — então a clínica escrevia, o WhatsApp recusava, e
-- a tela mostrava `failed` sem uma linha dizendo por quê. Eram leads de anúncio
-- pago ("Gostaria de saber mais sobre as promoções de Implante Dentário!"), e
-- um deles é a mesma pessoa que já tinha ficha pelo telefone: a paciente
-- `553191420149` mandou um áudio que caiu na ficha do LID às 13:19:12 e outro
-- na ficha real treze segundos depois — o "áudio em duas mensagens" que a
-- clínica reportou.
--
-- ## Por que coluna, e não conserto só no caminho de entrada
--
-- O caminho de entrada passa a preferir o telefone que o whatsmeow manda no par
-- (ver `telefoneAlternativoNoInfo`), mas o par pode não vir. Quando não vem, o
-- LID é a **única** identidade daquele fio, e descartá-lo deixaria a conversa
-- sem dono. A coluna é o que permite as duas coisas ao mesmo tempo: o fio tem
-- dono, e nada confunde o LID com telefone — não é formatado como celular, não
-- entra na busca por telefone, não passa pela regra do nono dígito e não é
-- usado como destino de envio.
--
-- É o mesmo desenho de `instagramId`, pela mesma razão, e isso não é
-- coincidência: é a terceira vez que um identificador de canal tenta morar em
-- `phone`.

-- expand
ALTER TABLE "contacts" ADD COLUMN "lid" TEXT;

CREATE INDEX "contacts_lid_idx" ON "contacts"("lid");
CREATE UNIQUE INDEX "contacts_workspaceId_lid_key" ON "contacts"("workspaceId", "lid");

-- migrate
--
-- As fichas que já nasceram com LID em `phone`: o valor muda de coluna e o
-- telefone fica **nulo**, que é a verdade — não sabemos o número daquela pessoa.
--
-- Três condições, e cada uma recusa um falso positivo:
--
--   `length >= 14`  — celular brasileiro tem 12 ou 13 dígitos. O E.164 admite
--                     quinze, então isto sozinho poderia pegar um estrangeiro
--                     legítimo; daí as outras duas.
--   `createdVia = 'inbound'` — ficha digitada pela recepção nunca é tocada.
--   nenhum envio bem-sucedido — se alguma mensagem já chegou neste número, ele
--                     é real, seja o tamanho que for. É a condição que torna o
--                     recorte seguro em vez de estatístico.
UPDATE "contacts" c
   SET "lid" = c."phone",
       "phone" = NULL,
       -- O nome automático era "WhatsApp <lid>", que mostra à atendente um
       -- telefone que não existe. Nome editado à mão é preservado.
       "name" = CASE
                  WHEN c."name" = 'WhatsApp ' || c."phone" THEN 'Lead sem número identificado'
                  ELSE c."name"
                END
 WHERE c."phone" IS NOT NULL
   AND length(regexp_replace(c."phone", '\D', '', 'g')) >= 14
   AND c."createdVia" = 'inbound'
   AND c."instagramId" IS NULL
   AND NOT EXISTS (
         SELECT 1
           FROM "conversations" cv
           JOIN "messages" m ON m."conversationId" = cv.id
          WHERE cv."contactId" = c.id
            AND m."direction" = 'outbound'
            -- `pending` não é prova: é mensagem que ainda não saiu. Uma das
            -- catorze fichas tem exatamente isso, e contá-la como sucesso
            -- deixaria o LID em `phone`.
            AND m."status" IN ('sent', 'delivered', 'read')
       );
