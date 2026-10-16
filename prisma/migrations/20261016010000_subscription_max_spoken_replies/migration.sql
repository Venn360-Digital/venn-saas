-- Teto mensal de respostas faladas, por plano.
--
-- A fala custa cerca de dez vezes o texto. Cobrar 2 créditos por resposta
-- falada deixava a carteira imprevisível para quem olha a tela; o teto mantém o
-- crédito uniforme e protege a margem igual.
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "maxSpokenReplies" INTEGER NOT NULL DEFAULT 0;

-- Preenche pelas faixas dos planos, para a assinatura que já existe não ficar
-- sem fala até alguém reaplicar o plano à mão.
UPDATE "subscriptions" SET "maxSpokenReplies" = CASE "plan"
    WHEN 'flow' THEN 400
    WHEN 'pro' THEN 750
    WHEN 'advanced' THEN 1500
    ELSE 400
END WHERE "maxSpokenReplies" = 0;
