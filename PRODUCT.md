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

## 8. O que ainda não existe

Registrado para não ser esquecido:

**Não há cobrança.** Não existe Stripe nem equivalente; `stripeId` e
`paymentMethod` são colunas vazias. Hoje "ativar plano" grava `status: 'active'`
sem cobrar nada — ou seja, **"plano ativo" significa "clicou no botão"**, não
"pagou". Todas as regras acima que dependem de plano ativo funcionam como
estrutura, mas são contornáveis em dois cliques até existir um gateway.

É a lacuna mais importante deste documento.
