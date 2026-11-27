# OdontoBox360 — regras de produto

Decisões de produto que o código precisa cumprir. Quando houver divergência entre
este documento e a implementação, **o documento está certo e o código é o bug**.

O sistema visual mora em [`DESIGN.md`](DESIGN.md). Aqui ficam as regras de
negócio: avaliação, planos, créditos, limites e retenção.

Última revisão: 20 de novembro de 2026.

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

**Troca de plano:** a franquia passa a ser a do plano novo **na hora**, e o
consumo do mês fica. Durante a avaliação, isso é o que substitui os 1.000
créditos de teste pelos do plano — eles não se somam. Fora da avaliação, vale a
mesma regra: subir de plano dá a franquia de hoje, não na renovação.

`creditsUsed` **não** é zerado na troca — é o que impede alternar de plano para
recarregar. O saldo é `credits - creditsUsed` com piso em zero, então descer de
plano depois de gastar muito mostra zero, não número negativo. E o período não
reinicia: a renovação continua contada da assinatura.

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

> **A tabela abaixo está velha nos nomes e nos preços** — ela ficou em Essencial
> / Evolução / Clínica 360 enquanto o produto passou a Digital / Prime /
> Multiclínica. A fonte da verdade é `src/lib/plan-limits.ts`, que o worker e as
> duas telas de plano leem; o que vale aqui é a **regra**, não o número.

| | Essencial | Evolução | Clínica 360 |
|---|---|---|---|
| Preço | R$ 490,00 | R$ 690,00 | R$ 1.290,00 |
| Agentes de IA | 1 | 2 | 3 |
| Números de WhatsApp | 1 | 2 | 3 |
| Usuários | ilimitados | ilimitados | ilimitados |

### Mensal ou anual — decisão do Andre em 2026-11-07

A assinatura de **12 meses desconta 10%** em todos os planos. Um número só, igual
para os três: desconto que varia por plano transforma a escada em tabela, e a
escada é o que faz o cliente subir.

**O ciclo é de cobrança, não de franquia.** O crédito de IA continua renovando de
30 em 30 dias nos dois — quem paga doze meses adiantado não recebe doze franquias
de uma vez para gastar em janeiro. Por isso a assinatura tem **duas datas**:
`currentPeriodEnd`, que é a franquia, e `renewsAt`, que é a cobrança. No mensal
elas andam juntas; no anual, a primeira vira doze vezes e a segunda, uma.

**Trocar de mensal para anual cobra o ano menos o saldo** dos dias já pagos do mês
corrente, e entra na hora — é a mesma regra do upgrade de plano (§13), com o
mesmo mecanismo. **Voltar ao mensal é descida**: vale na renovação, sem devolver
nada do ano comprado com desconto.

### O treinamento de agente

**Serviço, não recurso do sistema**: a nossa equipe levanta o conteúdo com a
clínica, escreve os documentos do agente e afina as respostas. Não se confunde
com a tela **Treinamento**, que é onde o cliente faz isso por conta própria.

**Compra única** — R$ 3.400,00, em promoção por R$ 2.400,00 até 30/11/2026.
Treinar é projeto com começo e fim; cobrar por mês um trabalho que acabou é
assinatura de nada. Por isso ele não entra na mensalidade e a linha que o
registra tem andamento (`pending` → `done`), não validade.

**O plano de topo em 12 meses inclui o treinamento de 1 agente.** As duas
condições juntas, e não uma delas: no mensal o cliente pode sair no mês seguinte
levando um serviço de R$ 2.400, e aí o brinde custa mais do que a assinatura que
ele pagou. É o compromisso de doze meses que o financia.

Canais em todos: WhatsApp QR-Code, WhatsApp API Oficial, Instagram, Facebook.

**Os dois tetos são independentes.** Um agente atende por **N números**, nunca o
contrário: a clínica com duas unidades pode usar um agente só, com uma linha em
cada unidade, ou dois agentes com personalidades diferentes dividindo três
linhas. O que o plano conta é o total de agentes e o total de linhas, cada um
contra o seu teto.

**Cada conversa pertence à linha por onde entrou**, e responde por ela. Duas
unidades não compartilham fio: o mesmo paciente escrevendo para os dois números
tem duas conversas, cada uma respondendo pelo número que ele conhece.

**Uma linha ocupa vaga** quando está no ar, quando está pareando, e quando já
pareou alguma vez e hoje está fora do ar — essa última continua sendo um número
da clínica, à espera de reconectar. A que nunca pareou não ocupa nada, e pode
ser removida da lista; remover é também como se devolve a vaga de uma linha que
não se vai mais usar.

**Downgrade:** os excedentes são **pausados por ordem decrescente de cadastro** —
o mais antigo sobrevive. Um agente pausado por limite **não pode ser reativado**
enquanto o plano não comportá-lo. Vale igual para números de WhatsApp.

**A fila da linha.** Cada linha pode pertencer a um **departamento**, e é isso
que recorta a caixa de entrada: o atendente daquele departamento vê a fila dele,
a gestão (dono, administrador, gestor) vê tudo. Linha sem departamento e conversa
sem linha são a fila geral da clínica, visível a todos — que é o estado de quem
não usa departamentos, para quem nada disso muda.

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

> O WhatsApp é pareado antes disso, no passo 3, porque o QR se liga a um agente
> e esperar o fim obrigaria a pessoa a procurar o caminho depois. O workspace e
> o agente nascem ali, **sem aceite**, e é o passo 5 que fecha o cadastro. Quem
> abandona no meio não entra pela porta dos fundos: a checagem de onboarding
> exige workspace *e* aceite registrado, então um cadastro pela metade volta
> para o onboarding em vez de cair no painel.

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

**A jornada anda nos dois sentidos.** O check de uma fase vem da passagem
registrada por ela (`DealStageEntry`) — nunca da posição no funil, que fazia o
check voltar sozinho e marcava como cumprida a fase que o negócio pulou. O
paciente volta atrás: agendou, não compareceu, vai ser reagendado. **Desfazer
esta fase**, no card da fase, tira a fase da jornada: saem **todas** as
passagens por ela, e o check some. Desfazer a fase atual move o negócio para a
fase anterior do funil por onde ele passou — ordem do funil, não a passagem mais
recente no relógio, senão desfazer manda para frente quem já tinha voltado uma
vez. A volta é registrada como qualquer mudança de fase, de propósito: o
follow-up automático conta os dias da última passagem, e restaurar uma data
antiga faria a régua disparar no mesmo minuto.

**Limpar só a data não desfaz nada** — data vazia quer dizer "a fase aconteceu,
a data eu não sei", que é o caso de quem registra a jornada depois do fato.

**Toda contagem conta o mesmo recorte que a tela mostra.** O número ao lado da
fase no trilho sai da mesma consulta que desenha a coluna: ganho e perdido não
aparecem somados na fase onde fecharam *e* outra vez em Finalizados. A exceção é
a exclusão de uma fase, que pergunta pelo total sem recorte nenhum — o negócio
ganho em março também precisa de um lugar para onde ir.

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

## 10. Canal, Origem e Mídia

Três coisas que o sistema chamava de duas, e que não se substituem.

**Canal** é por onde a mensagem transita: `whatsapp_qr`, `whatsapp_business`,
`instagram`, `site`. É fato técnico — o sistema grava sozinho, ninguém digita, e
**não serve para medir marketing**. Serve para responder ao paciente pela via
certa e para decidir quem vê a conversa.

**Linha** é a conta concreta daquele canal: um número, um perfil, uma chave de
widget. Cada linha tem um agente e, opcionalmente, um departamento — é o átomo
do sistema, e tudo que é visibilidade sobe por ela.

**Origem** é o que fez o paciente escrever: Facebook, indicação, fachada, a
agência que trouxe o lead. **Nenhum canal entrega esse dado** — o WhatsApp não
conta de onde a pessoa veio. Logo, origem só chega de duas formas:

1. **Semeada pela linha.** `AgentIntegration.defaultOriginId` — e, desde
   2026-10-20, também `defaultMediaId`. É o que separa
   duas linhas do mesmo canal: o WhatsApp QR da V4 e o do Nando são os dois
   `whatsapp_qr`, e quem trouxe o paciente é o número para onde o anúncio
   mandou. A ficha nova nasce com a origem da linha, sem ninguém digitar.
2. **Informada por quem atende**, na ficha do paciente ou do negócio.

**Mídia** é o detalhe da origem: qual campanha, qual peça. Era rotulada "Canal"
no Negócio, que é de onde vinha a confusão — a mesma palavra para transporte e
para marketing.

### As regras

- **Uma lista de origem só** (`origins`), usada pela ficha do paciente, pelo
  negócio e pela linha. Eram duas listas com o mesmo nome e nenhuma relação.
- **A origem não se reescreve.** A linha semeia apenas ficha nova: paciente que
  volta por outro anúncio mantém a origem com que entrou. Quem corrige é uma
  pessoa, na ficha.
- **Origem em branco é resposta válida** — significa "não sabemos". Obrigar a
  escolher produz "Manual" em toda ficha, que é o mesmo que não ter o campo.
- **O negócio herda a origem do paciente** quando nasce da primeira mensagem, e
  pode ser corrigido depois sem mexer na ficha.
- **A palavra "Canal" não aparece em tela de marketing.** Em Negócios e no
  painel da conversa, o campo é "Mídia".
- **Como a ficha nasceu é outro campo** (`createdVia`: `manual`, `import`,
  `ligacao`, `inbound`), e não divide espaço com origem. É o que responde "quem
  digitou isto?", não "o que trouxe este paciente?".

### A linha semeia origem **e** mídia, em qualquer canal

Fechado em 2026-10-20, depois de o Andre propor preencher Origem com o canal
("WA 3131918001", "Instagram", "site"). **Não é o caminho**: Origem viraria
cópia do Canal, que o sistema já grava sozinho e com mais precisão, e o
relatório de aquisição passaria a responder "do WhatsApp" para quase 100% das
fichas — por onde elas escrevem, não o que as trouxe. Pior, apagaria a única
distinção que importa: duas linhas do mesmo canal, a da agência e a do
indicador.

O que o pedido tinha de certo era o **preenchimento automático**, e ele já
existia pela metade. Agora está inteiro:

- a linha semeia **origem** e **mídia** — cadastrar o número do anúncio uma vez
  faz toda ficha nascer com "V4" e "Campanha Implante Set/26";
- o par vale para **toda linha**, não só a do WhatsApp QR: a coluna sempre foi
  do `AgentIntegration`, e era a tela que só expunha um canal;
- mídia pende do **negócio**, não da ficha: a mesma pessoa pode voltar por
  outra campanha, e cada negócio guarda a sua.

E o **Canal passa a aparecer nas duas fichas** — paciente e negócio —, como
fato, sem campo editável: ninguém digita canal. Fica ao lado de Origem para a
diferença ficar visível: uma diz por onde, a outra diz por quê.

### Um nível, não três

Origem é uma lista plana. "Facebook › V4 › Campanha Implante Set/26" é
hierarquia, e hierarquia aqui é uma coluna `parentId` nula a mais no dia em que
a clínica precisar comparar canal de aquisição entre unidades — **não antes**.
Enquanto um nível basta, a linha semeia "V4" e o relatório fecha.

---

## 11. Quem vê qual conversa

Dois eixos, e **só** dois.

**O papel** decide entre o próprio trabalho e o de todos. Dono, administrador e
gestor veem tudo; atendente vê a conversa atribuída a ele. Não há ajuste por
pessoa para isso — o papel é o ajuste.

**O departamento da linha** decide de quais filas em espera ele pode puxar
trabalho. A linha pertence a um departamento, a pessoa pertence a N
departamentos, e é isso que define o que ela alcança.

### As regras

- **A lista de departamentos da pessoa é o único botão da visibilidade.** Não
  existe um terceiro ajuste em lugar nenhum. Tirar alguém de um departamento é
  como se tira o acesso àquela fila.
- **Uma pessoa pode ser de vários departamentos.** É o que permite a atendente
  da Recepção cobrir a fila do Comercial hoje sem ser mudada de departamento e
  ter de ser mudada de volta na segunda.
- **Não existe parâmetro de "usar departamentos".** A lista de departamentos da
  clínica é o botão: sem nenhum, a fórmula do recorte casa com todas as
  conversas e não recorta nada; apagar o último derruba o muro. Um interruptor
  à parte criaria um estado em que o dado diz uma coisa e o comportamento diz
  outra.
- **Fecha em vez de abrir.** Atendente sem departamento numa clínica que *tem*
  departamentos vê a fila geral, não tudo. O contrário erra para o lado que não
  dá sintoma: ninguém reclama de ver demais.
- **A fila geral é de todos, sempre**: linha sem departamento e conversa sem
  linha não são de ninguém em particular, e esconder isso faria trabalho
  desaparecer do mapa.
- **Agente é filtro, não parede.** Um agente pode atender linhas de
  departamentos diferentes; quem precisa de "esta atendente só vê o bot da
  Ortodontia" dá um departamento próprio à linha daquele bot. Um conceito, um
  muro.
- **Onde a clínica não usa departamentos, nada de departamento aparece**: o
  campo na ficha do usuário, a coluna na lista e a opção na regra do agente
  somem. O **menu** Departamentos fica — é onde a função se descobre, como
  Especialistas e Etiquetas.
- **O que o atendente sem departamento perde é invisível**, então a tela de
  Usuários diz quantos estão assim.

### Negócios e Pacientes

**Todo negócio tem dono.** No cadastro pelo menu o responsável é **obrigatório**
— se é um negócio, alguém cuida dele. No negócio que nasce da primeira mensagem
o dono é quem assume a conversa. A coluna continua aceitando nulo por causa de
uma janela só: entre a mensagem chegar e alguém assumir.

Nessa janela, **negócio sem dono é lead não assumido** e aparece para quem pode
assumi-lo — o recorte passa pela conversa do paciente, com a mesma regra de
fila. Fora dela, atendente vê o negócio que é dele.

**Paciente não tem dono, e não vai ter.** Um quarto campo de responsável seria
um quarto lugar para dessincronizar. O recorte é derivado: é dele o paciente de
quem ele cuida o negócio, com quem está conversando, ou que escreveu para uma
fila dele. Consequência aceita: paciente cadastrado pela gestão que nunca
escreveu e não tem negócio de ninguém é invisível para o atendente — a mesma
regra da atividade sem responsável.

**O recorte vale na ficha e na exportação**, não só na lista: esconder da lista
não é autorização, e um CSV que devolve o que a tela esconde é a mesma falha com
outro nome.

---

## 12. Unidades e quem paga

**A assinatura é da conta, não da unidade.** A conta é o cliente; as unidades
(workspaces) são as clínicas dele. Uma assinatura cobre todas, com uma data de
renovação, um cartão e uma fatura. O proprietário é o **MASTER** da conta:
contrata, paga e governa todas as unidades.

A alternativa — assinatura por unidade — foi descartada em 2026-10-18 por
quatro razões: três datas de renovação para o mesmo dono, créditos que não se
somam entre unidades, avaliação recomeçando a cada unidade criada, e cancelar
uma sem cancelar as outras, com o cliente achando que cancelou tudo.

### O que o plano dá

| Plano | Unidades inclusas |
|---|---|
| Digital | 1 |
| Prime | 1 |
| Multiclínica | 3 |

**Os limites do plano não se multiplicam por unidade.** Multiclínica são 3
agentes, 6 números e 30.000 créditos **no total**, divididos como a clínica
quiser entre as unidades. É de propósito: crédito somado deixa a unidade
movimentada consumir a folga da que está parada, o que nenhuma assinatura
separada permitiria.

**O que soma é o adicional, não a unidade.** Desde 2026-10-19 cada unidade
adicional traz consigo 1 agente, 1 número e 10.000 créditos — ver abaixo. As
duas regras convivem: o plano é um pacote fixo; o adicional é um pacote a mais.

### Como a franquia é contada

A contagem atravessa as unidades: `getWorkspaceLimits` conta agentes e números
em **todas as unidades da conta**, e não na unidade aberta. Antes contava por
unidade enquanto a assinatura já era da conta, e a segunda unidade ganharia a
franquia inteira outra vez — um Multiclínica com três unidades chegaria a nove
agentes e dezoito números.

A recusa diz onde estão: "você já tem 3 agentes **nas suas 2 unidades**". Sem
essa metade da frase, a mensagem fica incompreensível justamente para quem tem
multiunidade — a tela afirma três numa clínica onde há um.

O ajuste do downgrade (`applyPlanLimits`) também atravessa: pausar só na unidade
onde o plano foi trocado deixaria a conta acima do plano pelo caminho mais
simples que existe — descer de plano numa unidade e manter os agentes da outra.
O agente que sobrevive é o mais antigo **da conta**.

### Trocar de plano no meio de um ciclo pago

Decidido em 2026-10-19, depois que três trocas em duas horas geraram três
cobranças de mês cheio. Toda troca criava um checkout novo com vencimento no
dia, e o período já pago simplesmente não era considerado.

| Situação | O que acontece |
|---|---|
| Primeira contratação | checkout recorrente, cobra o mês, cria a assinatura |
| **Subir** | cobra **só a diferença** dos dias que faltam, e entrega na hora |
| **Descer** | **não cobra nada**; o plano muda no registro e o preço na renovação |

**Descer não tira o que foi pago.** Todos os recursos do plano superior
continuam valendo até a renovação: `plan` muda na hora, e os tetos pagos — que a
assinatura guarda em cópia — ficam de pé até a virada. Não há "plano agendado"
para ninguém manter; a leitura usa o maior entre a cópia e a tabela do plano.

**Na virada, o cron aplica o plano novo para valer**, inclusive para baixo: é
ali que um Multiclínica (6 números) virando Digital com dois adicionais (3)
desconecta três linhas. Fazer isso na hora da troca tiraria do cliente dias que
ele pagou.

**Subir entrega na hora porque foi pago na hora.** A diferença é proporcional
aos dias restantes, cobrada como avulsa — que aceita Pix, ao contrário da
recorrência. Abaixo do mínimo do Asaas (R$ 5) o plano entra sem cobrança: com os
preços de hoje isso só acontece na virada exata.

E o ganho estrutural: **sem assinatura nova, não há assinatura órfã.** A
cobrança dobrada de 2026-10-19 deixa de ser possível por construção em toda
troca, em vez de depender de cancelar a anterior.

### Descer de plano com unidades demais é recusado

Multiclínica com três unidades não vira Digital. A saída não é apagar unidade —
unidade tem pacientes, agenda e conversas, e nenhuma troca de plano tem
autoridade para levar isso embora. Então a troca é recusada (409), dizendo o
número e as duas saídas reais: comprar adicionais ou escolher outro plano. As
adicionais já compradas contam a favor, então um Digital com dois adicionais
cabe três unidades.

### A unidade adicional

**Qualquer plano, a qualquer momento, pode adquirir uma unidade por R$ 290,00.**
Não é privilégio do Multiclínica.

**A unidade é recorrente; o crédito é uma vez.** Decidido em 2026-10-18. A
unidade soma R$ 290 à mensalidade enquanto existir — é o que mantém a escada
honesta, porque cobrança única faria um Digital a R$ 390/mês com dois adicionais
pagos uma vez ficar com três unidades para sempre, contra R$ 890/mês do
Multiclínica. Crédito avulso continua compra única com 90 dias de validade:
recarga que se repete todo mês é upgrade de plano com outro nome.

Por isso a tela de compra mostra **dois subtotais e nunca uma soma**: "R$ 184
agora" e "R$ 290 por mês" não são parcelas da mesma coisa, e somá-las dá
exatamente a conta que o cliente contesta na fatura.

**O adicional é um Plano Digital dentro da conta.** Por R$ 290 vêm: a unidade,
**1 agente, 1 número de WhatsApp e 10.000 créditos** somados à franquia (mais
400 respostas faladas, que acompanham o crédito para o teto de áudio continuar
fechando o custo de IA dentro dos 10% da mensalidade).

Mudou em 2026-10-19, e a regra anterior — adicional sem capacidade nenhuma —
resolvia o problema pela metade: unidade sem agente e sem número é clínica que
não atende, e quem comprasse ficava com uma segunda unidade viva e muda.

**A objeção que sustentava a regra antiga não sobrevive à conta.** O argumento
era que capacidade no adicional inverteria a escada de planos; não inverte,
porque os planos dão **números** desproporcionalmente e o adicional dá um só:

| para ter | pelo plano | por Digital + adicionais |
|---|---|---|
| 2 agentes, 20.000 créditos | Prime **R$ 590**, com 4 números | R$ 680, com 2 números |
| 3 agentes, 30.000 créditos | Multiclínica **R$ 890**, com 6 números | R$ 970, com 3 números |

O plano ganha em dinheiro **e** em capacidade nos dois casos. Quem compra
adicional está comprando uma clínica a mais, não um atalho de preço.

### Quem cria unidade

O **MASTER da conta** (`Account.ownerUserId`), não o OWNER da unidade aberta.
Criar unidade gasta o teto que a conta comprou, e a conta tem um responsável
explícito — foi para isto que a coluna existe. Com três unidades, "o OWNER de
qual delas?" não tem resposta boa, e a pergunta aparece justamente quando a
resposta importa.

A unidade nasce **vazia e com quem a criou dentro**, como OWNER dela — sem isso
ninguém poderia abri-la, porque o seletor lista participações, não contas. E
nada é copiado da unidade de origem: funil, departamentos e tags herdados
pareciam gentileza e eram armadilha, porque a clínica nova descobriria o funil
que não é dela depois de cadastrar negócio nele.

Comprar e criar são **dois atos**: comprar sobe o teto, criar dá nome à clínica.
Juntá-los inventaria uma clínica chamada "Nova unidade" que alguém teria de ir
renomear.

O preço não é arbitrário: Multiclínica são R$ 890 por três unidades, ou seja
R$ 297 cada. O adicional só torna explícito o preço marginal que o plano já
embute — e fica abaixo dos R$ 390 de um Digital avulso, que é a alternativa que
o cliente tem hoje. Com o adicional ele mantém uma fatura, uma renovação e a
troca de unidade pela própria tela.

### Onde isso aparece na tela

As guias "Clínica" e "Unidades" viraram **Conta da Clínica** em 2026-10-18, por
decisão do Andre: a conta é a clínica, e as unidades pertencem a ela. Os campos
não mudaram, mudaram de dono.

| Campo | Dono | Por quê |
|---|---|---|
| Nome da conta | conta | fechado na tela; nasce do cadastro, que pergunta um nome só |
| CNPJ de cobrança | conta | um por fatura |
| Logomarca | conta | o cabeçalho é um por sessão, e não pode piscar ao trocar de clínica |
| Nome, endereço, telefone | unidade | é o que distingue uma clínica da outra |
| CNPJ da unidade | unidade | existe na coluna, fora da tela: é da franquia com CNPJ próprio, e vazio na filial |

O segundo cartão é um **acordeão** com uma clínica aberta por vez, a primeira já
aberta — "na grande maioria será apenas unidade". Com uma clínica só, a guia é o
formulário da Clínica de sempre. Abrir a segunda fecha a primeira, e é por isso
que o Salvar grava **uma** unidade: com todos os blocos abertos, um Salvar sobre
três clínicas exigiria transação para não deixar meia gravação.

Editar a clínica em que não se está passou a ser possível de propósito — um dono
de três clínicas arruma o telefone da segunda sem trocar de unidade. Quem pode:
o MASTER da conta, ou quem administra aquela unidade.

### Mover agente entre unidades

Existe porque a franquia não se multiplica: num Prime são dois agentes **no
total**, e a segunda clínica só tem agente se um dos dois for para lá. Sem isso a
saída era apagar de um lado e criar do outro — perder prompt, regras, documentos
e webhooks por causa de uma limitação de tela, não por decisão de ninguém.

**Vai:** o agente e tudo o que pende só dele — regras, campos, webhooks, base de
conhecimento — e as **linhas** (números). As linhas vão porque linha sem agente é
número que ninguém atende, e porque é a linha que leva o atendimento para o outro
lado: o worker resolve o workspace pela linha, então a próxima mensagem naquele
número já nasce na clínica de destino.

**Fica:** as conversas e a medição de consumo. Conversa pertence ao paciente, e
paciente é da unidade — arrastá-las as deixaria apontando para pacientes de outra
clínica, ou obrigaria a arrastar a base inteira junto. Histórico fica onde
aconteceu, que também é a resposta certa para quem for auditar quem atendeu quem.

**É limpado:** o departamento e a origem padrão de cada linha. Apontam para
linhas de tabela da clínica velha, e "Recepção" de outra clínica não quer dizer
nada aqui — ficaria um id órfão decidindo quem vê a conversa. Efeito colateral
conhecido: as conversas antigas daquela linha caem na fila geral da clínica de
origem, porque é o que o escopo faz com linha sem departamento.

**É convertido:** regra cuja ação aponta para etapa de funil por `stageId` passa a
apontar por `stageName`. O id é validado contra o workspace, então falharia no
destino; por nome a regra fica portável, que é como o executor já sabe resolver.

**Mover não abre vaga.** Agente pausado por exceder o plano chega pausado do
outro lado — a vaga é da conta. A tela avisa antes de mover.

Quem pode: o **MASTER**. As duas pontas têm de ser da mesma conta — mover para
fora dela faria a franquia da origem liberar uma vaga que a assinatura de destino
não comprou.

### A troca de unidade

Quem participa de mais de uma vê o seletor na marca, no topo da barra lateral —
que é onde a tela já diz em qual clínica se está. A escolha mora num cookie, e
**é conferida contra as participações a cada requisição**: cookie é campo de
texto, e aceitar o que ele diz seria entregar a clínica do vizinho a quem
souber editá-lo. Trocar recarrega a tela inteira, porque trocar de clínica troca
tudo — conversas, pacientes, agenda, agentes.

---

## 13. Cobrança: as decisões do gateway

Decidido com o Andre em 2026-10-18, antes de escrever a fase 1. O gateway é o
**Asaas**, porque o ERP financeiro dele é o Asaas — recebimento, conciliação e
inadimplência de verdade são de lá. **Nosso banco guarda ponteiros e um
espelho, não o livro-caixa:** dois livros divergem no primeiro estorno, e aí
ninguém sabe qual está certo.

| Decisão | O que vale |
|---|---|
| Carência depois do vencimento | **3 dias** no cartão, **2 dias** no Pix |
| Boleto | **fora**, por enquanto |
| Documento de cobrança | **CPF ou CNPJ**, e vem da **conta** (`accounts.cpfCnpj`) |
| Unidade adicional | **recorrente**: soma R$ 290 à mensalidade enquanto existir |
| Crédito avulso | **compra única**, 90 dias de validade |
| Unidade comprada no meio do mês | **proporcional até a renovação**, depois ciclos cheios (implantado na fase 3) |
| O que o adicional inclui | 1 unidade, 1 agente, 1 número — **crédito não** |
| Cancelar adicional | direito do cliente; vale até a renovação |
| Venn360 | **vitalícia** (`billingExempt`): é a conta de teste do produto |
| Implante Ja | cobrada **a partir de 27/10/2026** (`billingStartsAt`) |

### O adicional é contrato à parte, e só o cliente o encerra

Decidido em 2026-10-19, ao ver o Multiclínica cobrar R$ 1.470 — R$ 890 do plano
mais 2 × R$ 290 de adicionais — numa conta que usa 2 das 3 unidades que o plano
já inclui.

**A soma continua.** Subir de plano **não** absorve adicional já contratado,
mesmo quando o plano novo cobriria aquelas unidades: às vezes a clínica precisa
dos dois, e cancelar o que ela pagou sem ela pedir é decidir pelo bolso dos
outros. O teto, afinal, é "o que o plano inclui **mais** os adicionais" — a soma
é a regra, não um efeito colateral dela.

A consequência é que o cliente precisa de um jeito de **cancelar adicional**,
assim como já pode cancelar o plano. Isso é da fase 4 (ciclo de vida), junto do
cancelamento da assinatura — e é a primeira vez que a fase 4 ganha escopo que
não veio de inadimplência.

### Como o adicional é cobrado (fase 3, 2026-10-19)

**Uma cobrança avulsa agora, e a renovação somada ao plano.**

O que se cobra no ato é o **proporcional aos dias que faltam** do ciclo já pago
— a unidade passa a valer no pagamento, e cobrar R$ 290 cheios no dia 28 seria
cobrar duas vezes os mesmos dois dias. Para os ciclos seguintes, o valor da
assinatura que já existe é atualizado (`PUT /subscriptions/{id}`), e por isso a
clínica continua recebendo **uma fatura por mês**. Criar uma segunda assinatura
para o adicional é o que produziria duas cobranças — foi a dúvida certa do
Andre, e é a razão de a sincronia de valor existir.

Crédito e unidade vão no **mesmo checkout**, porque a tela vende os dois no
mesmo diálogo e o cliente clica uma vez. Por ser avulsa, a cobrança aceita
**Pix e cartão**; a recorrência continua sendo cartão e só cartão, que é limite
do Asaas, não escolha nossa.

**O adicional não traz crédito** (decisão de 2026-10-19): 10.000 avulsos custam
R$ 49, então expandir sai por R$ 290 + R$ 49 = R$ 339, abaixo dos R$ 390 de uma
assinatura Digital nova. Embutir franquia no adicional daria de graça o que já
se compra — e abriria uma terceira origem de crédito para a clínica entender. O
adicional traz **capacidade**: a unidade, 1 agente e 1 número.

Duas situações não passam pelo gateway: **conta isenta** (vitalícia ou antes da
data de início) e **cesta abaixo de R$ 5**, que é o mínimo que o Asaas aceita
por cobrança. Nas duas a entrega é imediata e não há o que cobrar.

### O ciclo de vida (fase 4, 2026-10-19)

**Atraso não corta na hora.** A cobrança vencida abre a carência — 3 dias no
cartão, 2 no Pix, contados do dia do vencimento, e o dia inteiro vale. Quem
corta é uma tarefa diária, no dia em que ela termina.

**O corte é somente-leitura**, o mesmo da avaliação vencida (§3): mensagem
continua chegando, histórico continua inteiro e exportável, a guia de plano
continua aberta para que pagar seja sempre possível. **O WhatsApp não é
desconectado** — derrubar a linha por três dias de atraso custa à clínica o
relacionamento com os pacientes dela. Pagar restaura na hora, inclusive para
quem já foi cortado.

**Cancelar o plano cancela no gateway**, e nessa ordem: primeiro o `DELETE` da
recorrência, depois o registro aqui. Se o gateway recusar, nada muda — ficar
cancelado aqui e cobrado lá é o pior dos dois mundos. O acesso vale até o fim
do ciclo pago.

**Cancelar adicional é ação do cliente**, nunca efeito colateral de um upgrade.
Não é retroativo: a unidade vale até a renovação e o valor da recorrência desce
para os ciclos seguintes. E é **recusado** quando deixaria a conta acima do
teto: pausar agente e desconectar número são reversíveis, "pausar uma clínica"
não é — a tela diz quantas sobram e a decisão de excluir fica com quem é dono.

### Por que checkout hospedado, e não tokenização

O Asaas oferece os dois. `POST /v3/creditCard/tokenizeCreditCard` recebe o
número do cartão **no nosso servidor**; o Asaas Checkout é uma página deles onde
o pagador digita. Vamos de Checkout: a diferença não é de conveniência, é de
responsabilidade — no primeiro caminho o cartão passa pela nossa aplicação e
pelos nossos logs, e o escopo de PCI deixa de ser SAQ A.

**Corrigido em 27/11/2026, lendo a página de PCI-DSS deles.** Esta seção dizia
"sai de SAQ A para SAQ A-EP", e isso é otimista. O que a documentação do Asaas
afirma é que, na tokenização pelo back-end, "os dados passam pelo servidor antes
da tokenização" e "sua infraestrutura permanece no escopo" — sem fixar um nível,
porque "a definição depende de todo o fluxo de dados". Mas pelos critérios de
elegibilidade que a própria página enumera: **SAQ A** exige que nossos sistemas
não armazenem, processem **nem transmitam** dado de cartão, e **SAQ A-EP** é
para quem terceiriza o processamento tendo sistemas que afetam a segurança da
página. Tokenizar no servidor é **transmitir**, o que desqualifica os dois e
deixa **SAQ D** — o questionário cheio.

É leitura dos critérios, não citação: antes de bancar essa troca, confirmar com
o Asaas ou com a adquirente.

**E não existe meio-termo client-side.** O Asaas não oferece tokenização pelo
front-end — não há equivalente de campo hospedado em iframe que mantivesse o PAN
fora do nosso servidor com formulário nosso. Ou a página deles, ou o cartão no
nosso Worker.

**O que já é embutido, e por isso a troca renderia menos do que parece.**
`lib/asaas/cobranca-no-cartao.ts` cobra o cartão salvo por `creditCardToken`,
sem redirecionar, e a troca de cartão da assinatura também é feita na nossa
tela. O token nasce do primeiro pagamento na página deles. Então o único
pagamento que sai do domínio é **o primeiro** de cada cliente — e é ele que
custaria a saída do SAQ A.

### Pix embutido não tem esse custo

Decidido com o Andre em 27/11/2026. QR Code e copia-e-cola não têm PAN, então
exibir cobrança Pix dentro do app não move escopo de PCI nenhum:
`GET /v3/payments/{id}/pixQrCode` devolve `encodedImage`, `payload` e
`expirationDate`. É o caminho para "sem sair do app" que não cobra o preço
acima, e vale para adicional, upgrade e diferença.

**Plano mensal em Pix é outra coisa.** Assinatura com `billingType: PIX` **não**
é débito recorrente — a documentação deles é explícita que isso não equivale ao
**Pix Automático**, que é produto separado (`POST /v3/pix/automatic/authorizations`),
exige autorização do pagador confirmada **pela instituição dele** e só então fica
`ACTIVE`. Recorrência por cartão segue sendo o caminho sem etapa extra.

### Por que o webhook grava antes de pensar

Três frases da documentação deles desenharam a rota. A entrega é **at least
once**, então o mesmo evento chega mais de uma vez — `asaas_events.asaasEventId`
é único, e a colisão é resposta de sucesso. Eles pedem **200 imediato** e
processamento assíncrono. E **depois de 15 falhas consecutivas a fila deles
para**: os eventos continuam a ser gerados sem serem enviados até alguém
reativar. Um `500` nosso repetido não atrasa um evento — fecha a torneira, em
silêncio, com cliente pagando e nada acontecendo.

### O que a fase 1 **não** faz

Não ativa plano, não credita compra, não corta inadimplente. Ela cria o cliente,
recebe o evento e espelha a cobrança. Mexer em dinheiro antes de o espelho ter
sido provado contra o sandbox é a ordem errada de fazer as coisas.

---

## 14. Disponibilidade e presença

Decidido com o Andre em 2026-11-20. Vale para os três produtos.

**Status é presença, não fila.** Os quatro estados — Disponível (verde),
Ocupado (vermelho), Ausente (amarelo), Desconectado (cinza) — dizem à equipe
se a pessoa está na mesa, se vale chamar no particular, se saiu. Isso é
independente de a pessoa **receber conversas**: o dono que não atende fila
também está ou não está na mesa. Por isso o seletor na barra lateral, a
bolinha sobre o retrato e a coluna Disponibilidade da lista de Usuários
aparecem para **todo mundo**. Antes só quem entrava na distribuição os via, e o
dono da conta aparecia como ausente ou offline para a própria equipe.

**O que "Recebe conversas" decide é só a distribuição automática.** É a única
coisa que o flag decide, e continua sendo: rodízio e balanceado só escolhem
entre quem o tem ligado. O status de quem não o tem não faz a pessoa receber
nada — e, ao contrário, importa onde já importava: quem é responsável por uma
conversa (assumiu, recebeu por transferência) e se marca Ocupado ou cai em
Ausente deixa a entrega ir para a fila geral, que é a regra do handoff para
qualquer responsável. Ninguém espera atendimento parado com quem saiu.

**Entrar devolve ao verde.** Toda sessão nova — login ou cadastro — marca a
pessoa Disponível em todas as unidades de que participa. Vale para quem saiu
pelo menu e para quem a sessão expirou sozinha: ontem Ocupado, hoje Disponível.

**Ausente é quem parou de mexer no computador.** O relógio da presença é o
**gesto** — teclado, mouse, roda, toque —, contado pelo navegador e gravado a
cada dois minutos só quando houve gesto. Depois de `Ausência` minutos sem gesto
(campo da ficha da pessoa; o padrão do sistema é 60), o verde vira amarelo; ao
mexer de novo volta ao verde na hora, sem clique. Depois de oito horas sem
gesto, cinza. Até 2026-11-20 o relógio era a requisição ao servidor, e isso
media a aba e não a pessoa: a tela de conversas relê a lista a cada minuto, e
uma aba aberta sobre uma mesa vazia mantinha a pessoa verde para sempre.

**A escolha manual é pegajosa.** A escada só mexe em quem está verde. Quem se
marca Ocupado para uma reunião, ou Ausente para o almoço, fica onde se pôs até
mudar no menu ou até o próximo login — um gesto não desfaz uma escolha. É o que
impede alguém voltar a receber lead por ter aberto o sistema para conferir um
horário.

**O que a pessoa vê é o que o sistema usa.** A bolinha, a lista de Usuários, o
painel de equipe e a distribuição aplicam a mesma função sobre os mesmos dados.
Tela dizendo uma coisa e distribuição fazendo outra foi o defeito da primeira
versão, e não volta.

---

## 15. Funis de venda

Decidido com o Andre em 2026-11-20. Até então o funil era implícito — "a lista
ordenada de fases da unidade" — e por isso só podia haver um.

**Uma unidade pode ter vários funis, e exatamente um é o padrão.** Cada funil
tem as suas fases, a sua ordem e os seus prazos de follow-up. Em Vendas →
Negócios a pessoa escolhe qual trabalha (o escolhido vive na URL, `?funil=`), e
o padrão é o que abre sem escolha — para quem só tem um, nada muda.

**O padrão é o funil do atendimento.** É o único que o módulo de atendimento
conhece: o negócio que nasce da primeira mensagem (e o do Novo atendimento)
entra na primeira fase dele; o cartão da caixa de entrada e o filtro por etapa
leem a fase dele; o agente de IA só lista e só move fases dele; as regras do
agente agem sobre o negócio aberto dele; o painel da conversa mostra a jornada
dele; o painel de indicadores desenha as fases dele. Os outros funis são de
trabalho manual em Negócios. A pessoa que tem negócio aberto **só** noutro
funil aparece no atendimento como "sem negócio aberto", e criar um ali o cria
no padrão.

**Trocar o padrão é ato explícito** (a estrela em Gerenciar funis), com a
consequência escrita ao lado: a próxima mensagem já cria negócio no novo
padrão, e os negócios que estavam no antigo ficam onde estão. O padrão não se
exclui — marca-se outro antes.

**Um negócio pertence a um funil pela fase em que está.** Não há coluna
duplicada no negócio para divergir. Mover um negócio para a fase de outro funil
é como ele troca de funil.

**A regra 1:1 virou 1:1 por funil.** Um contato tem no máximo um negócio
aberto **em cada funil** — a mesma pessoa pode ter uma avaliação andando num e
um plano em negociação noutro. Dentro de um funil continua valendo um só, que é
o que faz o cartão da caixa de entrada e o agente saberem de qual negócio estão
falando. A criação e a mudança de fase ou de contato recusam o segundo (409).

**Com uma exceção: o formulário de captura.** Ele cria o negócio mesmo que a
pessoa já tenha um aberto no funil padrão (§17, decisão do Andre em
2026-11-20). Quando isso acontece, "o negócio aberto" do contato passa a ser o
**mais recente** para o cartão da conversa e para o agente — é o preço aceito
de não descartar um lead que chegou.

**Excluir funil com negócios pede destino**, como excluir fase: eles vão para a
primeira fase do funil escolhido, com a passagem registrada na jornada. As
fases do funil excluído saem com ele, e as passagens por elas também.

**Funil novo nasce com as fases padrão**, para ser usável no mesmo clique; o
primeiro funil da unidade é o padrão, os seguintes não.

**O funil de marketing é outra coisa.** Marketing → Funis são sequências
automáticas (gatilho e passos); o gatilho "entrou na etapa" e o passo "mover
etapa" podem apontar para a fase de qualquer funil de venda, e o combo escreve
o nome do funil ao lado da fase quando há mais de um. O passo só move o negócio
aberto **do mesmo funil** da fase de destino.

**O título do negócio é o nome da pessoa.** Era "Novo <pessoa> - Fulano"; o
prefixo saiu em 2026-11-20 e os títulos já gravados perderam o prefixo na
migração.

---

## 16. Colaboração: marcar um colega

Decidido com o Andre em 2026-11-20. A menção `@colega` já existia, escondida
em Notas internas; passa a ter três portas e uma regra só.

**Toda indicação de colaboração fica registrada em Notas internas.** Não há
botão de "seguir" nem tabela à parte: marcar alguém é escrever uma nota
interna com `@colega`, e é a nota que faz a pessoa passar a colaborar (ver a
conversa, mesmo fora da fila dela) e receber o recado. As três portas produzem
a mesma nota:

1. **Notas internas**, com `@` — como sempre foi.
2. **O compositor**, com `@`. A mesma lista de colegas abre no campo de
   resposta; e uma mensagem com `@colega` **vai como nota interna**, nunca
   para a pessoa atendida. A faixa acima do campo diz isso antes do Enter, com
   o texto que o Andre escreveu em 2026-11-20: "Com @colega no texto, esta
   mensagem vai como nota interna, o colega marcado passa a colaborar e é
   avisado.".
3. **Botão direito na mensagem → Marcar colega.** Vira uma nota interna com a
   menção e um trecho da mensagem («…»), apontando a hora dela.

**O colega marcado é avisado na hora**: o recado nasce com a nota e o sino
dele acende pelo tempo real, como no recado manual. A menção aparece como chip
(`@Nome`) no fio e no painel de notas — nunca a sintaxe interna com o id.

**E o id também não aparece enquanto se digita.** Escolher na lista deixa
`@Nome ` no campo; o id viaja à parte e só volta ao texto no envio (pedido do
Andre em 2026-11-20, que via `@[Roberto Alves](cmwe…)` no compositor). Vale nos
dois campos, o do chat e o da nota. Três regras fazem isso ser exato: o nome
mais longo casa primeiro (com "Ana" e "Ana Paula" na equipe), duas pessoas de
mesmo nome são consumidas na ordem em que foram escolhidas, e quem apagou o
nome depois de escolher não marcou ninguém.

**Filtro por atendente** na caixa de entrada, para qualquer papel: é filtro,
não parede — o teto do atendente continua em cima dele.

**Os textos da régua de inatividade são da clínica.** "Perguntar se ainda está
na conversa" e "Despedir-se e encerrar" ganham campo de texto por agente: até
três linhas, `*negrito*` do WhatsApp e emoji. Vazio usa o texto do sistema.

**A saudação não se repete.** Em conversa nova a saudação configurada sai
literal, e o modelo responde em seguida à mesma mensagem — e se apresentava de
novo, porque as instruções centrais pedem apresentação e nada dizia que ela já
tinha acontecido. Confirmado em 2026-11-20 (era isso, não duas saudações
configuradas). O prompt passa a dizer que a saudação já saiu enquanto ela for
a única fala nossa no fio.

---

## 17. Formulários de captura

Decidido com o Andre em 2026-11-20 (Marketing → Formulários).

**O formulário é uma página nossa, que o site embute.** Cada formulário tem
uma chave pública e vive em `/f/<chave>`: abre por link, ou entra no site da
organização num `iframe` (o código de incorporação ajusta a altura sozinho). A
chave identifica o formulário e **não autoriza nada** além de enviar — a mesma
regra da chave do widget.

**Campos são do cliente; o lead é do produto.** O cliente monta os campos
(texto, e-mail, telefone, texto longo, número, data, escolha única, múltipla,
caixa de marcar), com rótulo, obrigatório, opções, validação (mínimo, máximo,
formato) e aparência (cor, cantos, tema). O que faz uma resposta virar lead é o
**mapeamento**: cada campo diz se vai para Nome, Telefone, E-mail, Observações
ou fica só no envio. **Não se publica formulário sem telefone nem e-mail
mapeado** — captura resposta, não captura lead.

**O envio sempre fica registrado.** O resto são **três interruptores**, e eles
pendem um do outro (decisão do Andre em 2026-11-20):

1. **Criar o contato** — a ficha nova, ou a existente completada no que faltava
   (**o telefone é a chave**, como em todo o produto; o e-mail decide quando
   não há telefone), mais as etiquetas do formulário. Desligado, o envio é só
   uma linha na lista de envios: negócio e conversa pendem da ficha, e sem ela
   não acontecem.
2. **Abrir um negócio no funil padrão** — com as respostas nas observações.
3. **Começar o atendimento no WhatsApp** — ver abaixo, porque o que sai depende
   do canal.

A ficha nasce com `createdVia: formulario` e a origem comercial que o
formulário escolheu (§10: nula é resposta válida).

**O lead entra em funil de marketing pela etiqueta.** Decisão do Andre em
2026-11-20, escolhida entre quatro caminhos possíveis. A etiqueta que o
formulário aplica dispara o gatilho "quando uma etiqueta for aplicada", então
quem decide se o lead vai para nutrição é o cliente, marcando a etiqueta no
formulário — e um funil por etiqueta serve a vários formulários, ou um
formulário a vários funis, sem campo novo em lugar nenhum. **Só a etiqueta nova
para a ficha dispara**: quem já a tinha e preencheu de novo não recebeu
etiqueta, e tratar isso como aplicação faria a nutrição recomeçar a cada visita.
Ficha nova ainda liga o funil de boas-vindas (`contato_criado`), que é o outro
fato e pode ser outro funil.

É o caminho que também alcança **quem já era contato** — a ficha só é nova uma
vez —, e isso importa justamente para quem deixou só o e-mail: o funil é o único
canal que chega nele, porque o WhatsApp não. O passo de e-mail do funil exige
remetente verificado na unidade; sem isso a passagem roda e o passo falha em
definitivo.

**A origem da ficha vale para o contato e para o negócio.** É a mesma coluna
nas duas escritas, como em todo caminho do produto (§10). A **mídia** não: ela
pende do negócio, e o formulário não a semeia — o site não sabe de qual anúncio
a pessoa veio.

**O responsável sai da regra de distribuição, não do formulário.** Era um nome
fixo escolhido no editor; passou a ser a **Regra de distribuição de conversas e
e-mails** da conta (Conta → Automações), decisão do Andre em 2026-11-20: a
mesma estratégia das conversas (rodízio ou balanceado), respeitando "Atribuir
conversas para status disponível", `recebeConversas` por pessoa e o
departamento da linha. Com todo mundo indisponível o registro **nasce sem dono,
na fila** — e é a varredura que lhe dá um quando alguém ficar disponível.
Quando a chegada abre conversa, o negócio herda o dono dela; quem deixou só o
e-mail passa pela mesma escolha, feita sem conversa nenhuma.

**O negócio sem dono acompanha a conversa quando ela ganha um.** A varredura da
fila distribuía só a conversa, e o negócio da madrugada ficava órfão para
sempre — nada mais olhava para ele. Agora a distribuição preenche também o
negócio **aberto e sem responsável** do mesmo contato; negócio que já tem dono
nunca é sobrescrito.

**A regra "um negócio por funil" não vale para o formulário.** Decisão do Andre
em 2026-11-20: quem preencheu de novo pediu outra coisa, e perder o lead porque
a pessoa já tinha negócio aberto era o oposto de captar. A implicação está
aceita: um contato pode acabar com mais de um negócio aberto no funil padrão, e
aí o cartão da conversa e o agente leem o **mais recente** (§15 descreve a
regra 1:1 para os outros caminhos, que seguem recusando o segundo).

**A conversa com IA, e por que QR e oficial não fazem o mesmo.** Com WhatsApp
válido e linha conectada, a chegada abre o fio no atendimento com as respostas
em nota interna. O que muda é o envio: no **QR** dá para falar com quem nunca
escreveu, então a conversa nasce com a IA, a saudação do agente sai na hora e a
partir da resposta da pessoa o fluxo é o de qualquer conversa. No **oficial da
Meta** não dá — fora da janela de 24h ele exige template aprovado, que o
projeto não tem (§8) —, então a conversa abre **para a equipe**, sem enviar
nada; quando a pessoa escrever, a IA assume. Número sem WhatsApp não abre fio; a
verificação indisponível não impede, igual ao resto do produto. Nada disso pode
custar o lead: falhar ao abrir a conversa não impede a ficha nem o negócio.

**Defesas da porta pública:** só o publicado responde; teto por IP e por
formulário por hora, em banco; campo-armadilha que finge sucesso para robô; a
validação roda na página e **de novo** no servidor, com a mesma função.

**Depois do envio:** uma mensagem, ou um redirecionamento para a página que o
cliente indicar. A validação devolve o erro embaixo do campo que o causou.

**A aparência tem seletor de cor de verdade.** Cor livre (a roda do sistema e o
código hexadecimal digitável, com a rampa da marca como atalho), cantos, tema
claro ou escuro — e **fundo sólido ou transparente**, pedido do Andre em
2026-11-20. Transparente o formulário herda a cor de fundo da página onde for
embutido; o texto continua vindo do tema, então num site escuro escolhe-se o
tema escuro junto. No **link direto** o fundo continua sólido: ali nós somos a
página, e um formulário transparente sobre o branco do navegador com tema
escuro seria ilegível.

**O painel do editor não tem barra de abas.** As cinco seções (campos,
aparência, depois do envio, incorporar, envios) são cartões empilhados, como no
editor de funil — pedido do Andre em 2026-11-20, e a guia em pílula do shadcn
era a única do painel, contra o padrão da casa (DESIGN.md: guia é sublinhada).

---

## 18. O que ainda não existe

Registrado para não ser esquecido:

**Não há cobrança.** Não existe Stripe nem equivalente; `stripeId` e
`paymentMethod` são colunas vazias. Hoje "ativar plano" grava `status: 'active'`
sem cobrar nada — ou seja, **"plano ativo" significa "clicou no botão"**, não
"pagou". Todas as regras acima que dependem de plano ativo funcionam como
estrutura, mas são contornáveis em dois cliques até existir um gateway.

É a lacuna mais importante deste documento.
