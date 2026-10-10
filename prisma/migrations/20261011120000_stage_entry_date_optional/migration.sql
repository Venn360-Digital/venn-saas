-- A data de uma passagem pela fase passa a ser opcional.
--
-- A clínica registra a jornada depois do fato: "passou pela avaliação, não sei
-- quando". Até aqui limpar a data no painel não gravava nada — o campo voltava
-- ao valor antigo e a pessoa não tinha como dizer "a fase aconteceu, a data eu
-- não sei". Nulo é essa resposta.
--
-- Nenhuma linha muda: só a restrição sai.
ALTER TABLE "deal_stage_entries" ALTER COLUMN "enteredAt" DROP NOT NULL;
