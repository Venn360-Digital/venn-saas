# OdontoBox360 — regras de produto

Decisões de produto que o código precisa cumprir. Quando houver divergência entre
este documento e a implementação, **o documento está certo e o código é o bug**.

O sistema visual mora em [`DESIGN.md`](DESIGN.md). Aqui ficam as regras de
negócio: avaliação, planos, créditos, limites e retenção.

Última revisão: 7 de outubro de 2026.

---

## 1. Período de avaliação

**Início:** no cadastro do proprietário — o primeiro acesso ao workspace, não a
conclusão do onboarding.

**Fim:** às **23:59 do sétimo dia completo** após o cadastro, no fuso
`America/Sao_Paulo`. Comprar um plano antes disso não encurta a avaliação.

**O que a avaliação dá:** 1.000 créditos de IA e acesso completo. Sem cartão de
crédito, sem cobrança.

**Contagem:** a interface mostra **dias e minutos** restantes, no fuso de São
Paulo. UTC erraria em três horas.

---

## 2. Créditos

A unidade é o custo real de LLM: **1 crédito = 1 centavo de dólar**
(`arredondaParaCima(custoUSD × 100)`). Mil créditos equivalem a cerca de US$ 10
de uso.

São **dois saldos distintos**, e isso não é detalhe de implementação — eles
expiram de formas diferentes:

| Saldo | Origem | Validade |
|---|---|---|
| **Crédito de plano** | a assinatura | renova 30 dias após a contratação, **sem acumular** |
| **Crédito avulso** | compra extra | **90 dias** a partir da compra, ou até esgotar |

**Ordem de consumo:** gasta-se primeiro o crédito de plano, depois o avulso. O de
plano morre na renovação de qualquer jeito; o avulso é do cliente e não deve ser
queimado antes do que já ia expirar.

**Renovação:** 30 dias **contados da assinatura**, não na virada do mês. Se na
renovação sobravam 500 créditos de plano, eles são descartados e o saldo volta ao
valor do plano. Avulsos não são tocados.

**Troca de plano durante a avaliação:** os 1.000 créditos de teste são
**substituídos** pelos do plano, não somados.

**Quando o crédito acaba:**

- O agente **para de responder**. Antes de silenciar, envia **uma** mensagem de
  transferência ao paciente: *"Vamos continuar seu atendimento em instantes."*
  Uma só — repetir vira robô.
- **Tudo o mais continua**: mensagens chegam, atendentes respondem, CRM, agenda e
  relatórios funcionam.
- No rodapé da barra lateral, o texto de crédito fica **vermelho, em negrito, com
  ícone de alerta**.

**Compra de créditos avulsos** exige, simultaneamente: **plano ativo** e estar
**fora do período de avaliação**. Sem as duas condições a compra é recusada —
comprar crédito sem plano permitiria usar o produto indefinidamente por fora da
assinatura.

**Quem pode comprar:** OWNER e ADMIN.

---

## 3. Fim da avaliação sem plano

No dia 7, às 23:59, o workspace entra em **somente-leitura**.

**Continua funcionando:** receber e gravar mensagens, ler todo o histórico,
navegar por todas as telas, exportar dados, e a tela de planos — para que
assinar seja sempre possível.

**Para de funcionar:** enviar mensagem (agente e atendente), criar ou editar
agente, contato, negócio, atividade, etiqueta e produto.

O WhatsApp **não é desconectado**. O número segue recebendo; nada se perde. A
clínica apenas deixa de operar.

Na primeira mensagem de cada conversa durante o bloqueio, **uma única resposta
automática** orienta o paciente a ligar na clínica. Uma por conversa, não por
mensagem.

Assinar um plano restaura tudo imediatamente, sem reconectar nada.

---

## 4. Limites por plano

| | Essencial | Evolução | Clínica 360 |
|---|---|---|---|
| Preço | R$ 490,00 | R$ 690,00 | R$ 1.290,00 |
| Agentes de IA | 1 | 2 | 3 |
| Números de WhatsApp | 1 | 2 | 3 |
| Usuários | ilimitados | ilimitados | ilimitados |

Canais em todos: WhatsApp QR-Code, WhatsApp API Oficial, Instagram, Facebook.

**Downgrade:** os excedentes são **pausados por ordem decrescente de cadastro** —
o mais antigo sobrevive. Um agente pausado por limite **não pode ser reativado**
enquanto o plano não comportá-lo. Vale igual para números de WhatsApp.

---

## 5. Segunda avaliação

Permitida, com **outro e-mail**. Mas **um número de WhatsApp pertence a um
workspace por vez**: para conectá-lo num workspace novo, é preciso desconectá-lo
do anterior. É o que impede encadear avaliações com o mesmo número.

---

## 6. Avisos

Enviados por e-mail, em português, com chamada para assinar:

- **Dia 5** da avaliação
- **Dia 6** da avaliação
- **80% dos créditos** consumidos
- **Dia 37** (30 dias após o bloqueio): aviso de exclusão em 60 dias
- **Dia 90**: segundo aviso, 7 dias antes da exclusão

---

## 7. Retenção e LGPD

> Esta seção descreve a prática implementada, **não é parecer jurídico**.
> Retenção de dado de saúde tem exigências próprias e precisa de revisão por
> advogado.

**Papéis:** a **clínica é a controladora** dos dados dos pacientes; o
OdontoBox360 é **operador**. Isso precisa constar em contrato.

**Escala após o fim da avaliação sem plano:**

| Momento | O que acontece |
|---|---|
| Dia 7 | Somente-leitura. Exportação liberada. |
| Dia 37 | Aviso de exclusão em 60 dias |
| Dia 90 | Segundo aviso, 7 dias antes |
| Dia 97 | Exclusão dos dados do workspace |

**A exportação fica disponível o tempo todo.** Apagar dado de paciente sem que a
clínica tenha podido levá-lo embora é o pior cenário, legal e comercialmente.

**Aceite:** os termos são apresentados na **última tela do onboarding**, com
aceite explícito registrado (quem, quando, qual versão).

> **A exclusão está desligada.** O job de retenção roda e registra o que
> *apagaria*, mas só apaga de fato com `RETENTION_DELETION_ENABLED=true` no
> ambiente. Deve continuar assim até o produto rodar tempo suficiente para as
> datas serem reais — um job que apaga prontuário, escrito hoje, está a um erro de
> aritmética de destruir o histórico de uma clínica, e não existe backup fora da
> máquina para recuperar.

---

## 8. Atendimento que a clínica começa

O atendimento normalmente começa pelo paciente: ele escreve, o webhook cria a
ficha, o negócio e a conversa. Duas situações não cabem nisso, e são atendidas
pelo **Novo atendimento** (cabeçalho da lista de Conversas, e ação na linha de
Pacientes):

**Ativo.** A clínica escreve primeiro, para um número que nunca escreveu. Cria
paciente, negócio na primeira etapa e conversa, e abre o chat — a mensagem é
escrita e enviada por uma pessoa, nunca pré-preenchida pelo sistema.

**Ligação.** O paciente ligou. Cria os mesmos três registros, grava a ligação
como atividade concluída com o relato e deixa a mesma nota como nota interna na
conversa, **sem enviar nada**. A conversa nasce atribuída a quem registrou, para
não cair na fila de espera. A fase se marca na Jornada do paciente, que abre em
seguida: a jornada é a mesma para todo paciente, porque as fases são da clínica,
não do canal.

**A jornada anda nos dois sentidos.** O check de uma fase vem de uma passagem
registrada por ela (`DealStageEntry`), e o paciente volta atrás: agendou, não
compareceu, vai ser reagendado. Clicar numa fase anterior move o negócio de
volta; **Desfazer esta passagem**, no card da fase, tira o registro — e com ele
o check. Sai só a passagem mais recente: se o paciente já tinha passado por ali
antes, aquela passagem fica e a fase continua marcada, porque aconteceu mesmo,
naquela data. A fase atual não se desfaz (o negócio está parado nela), e
**limpar só a data não desfaz nada** — data vazia quer dizer "a fase aconteceu,
a data eu não sei", que é o caso de quem registra a jornada depois do fato.

**O telefone é a chave.** `Contact` é único por `(workspaceId, phone)`, e todo
telefone é gravado como o WhatsApp endereça — dígitos com o código do país. Uma
ficha criada à mão com máscara e a mesma pessoa escrevendo pelo WhatsApp viravam
dois pacientes; a normalização no POST e no PUT de `contacts` é o que faz a
ligação de hoje e a mensagem de amanhã caírem na mesma ficha.

**Limites.** O número é verificado no WhatsApp antes de gravar (`/user/check` do
Evolution Go); verificação indisponível vira aviso, não impedimento. Texto livre
para quem não escreveu só sai pelo canal QR — no canal oficial da Meta exigiria
template aprovado, que não existe no projeto. Disparo em massa não existe e não
deve existir sem opt-out e intervalo entre envios: é o caminho mais rápido para
o número ser banido.

---

## 9. Follow-up automático

O funil sempre soube dizer quem estava esquecido; lembrar era trabalho de
memória. Cinco camadas resolvem isso, e só a última fala com o paciente.

**A tarefa que nasce sozinha.** Todo dia às 7h, negócio aberto, sem nenhuma
atividade pendente, parado na fase além do prazo dela, vira "Retomar contato" no
nome do responsável. O prazo é por fase (`followUpDays`), vazio significa que a
fase não cobra. Não duplica por construção: o filtro é o mesmo que a faixa "sem
próxima atividade" usa, então a tarefa criada tira o negócio da consulta.

**A IA escreve.** Lê as últimas trinta mensagens, a fase com a sua data e nota,
e devolve o texto e a data do retorno. Custa US$ 0,0003 por uso em gpt-4o-mini,
com `checkCredits` antes e `trackUsage` depois. Nunca envia.

**Avisos que esperam ser vistos.** `Notification` guarda o aviso até alguém ler;
a campainha mostra avisos e lembretes separados, porque um já aconteceu e o
outro ainda vai acontecer.

**O boletim da manhã.** Na hora que a clínica escolher: três números e os nomes
de quem ligar primeiro. Um por dia, mesmo que o worker reinicie.

**O envio que a fase autoriza.** `autoSend` tem três estados: `off` (só tarefa),
`draft` (escreve e deixa para aprovar — o ensaio) e `send`. Seis portões antes
de qualquer mensagem, e a primeira recusa vira tarefa em vez de silêncio: a fase
autoriza; o número tem WhatsApp; ninguém está cuidando da conversa (sem
atendente atribuído e sem resposta do paciente nas últimas 24h); não falamos
demais (no máximo **duas** automáticas por paciente, a **sete dias** de
distância); é horário comercial em dia útil; e a IA tem contexto.

**O descadastro.** "PARAR", "pare", "sair", "descadastrar", "não quero" ou
"stop" no início da mensagem marcam `Contact.autoMessagesPausedAt` — por
palavra, sem IA, porque a saída não pode depender de crédito nem de um modelo
acertar a intenção. A marca é do paciente, não da conversa: fio novo continua
respeitando. A equipe segue podendo escrever.

**O limite de canal.** Isto vale para o canal QR. No canal oficial da Meta,
texto livre para quem não escreveu nas últimas 24h exige template aprovado, que
o projeto não tem — o controle da fase fica desabilitado quando não há canal
capaz.

---

## 10. O que ainda não existe

Registrado para não ser esquecido:

**Não há cobrança.** Não existe Stripe nem equivalente; `stripeId` e
`paymentMethod` são colunas vazias. Hoje "ativar plano" grava `status: 'active'`
sem cobrar nada — ou seja, **"plano ativo" significa "clicou no botão"**, não
"pagou". Todas as regras acima que dependem de plano ativo funcionam como
estrutura, mas são contornáveis em dois cliques até existir um gateway.

É a lacuna mais importante deste documento.
