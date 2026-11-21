# Backlog de features em aberto

Lista de entrada. Cada item sai daqui quando estiver entregue e verificado.
Decisão aprovada vira regra em [`PRODUCT.md`](PRODUCT.md) — este arquivo é fila,
não documentação.

Aberto em 17 de outubro de 2026.

---

## 1. Visibilidade de conversas por departamento

**Onde:** Conversas, ficha do usuário, lista de usuários, regra do agente.

**Estado: entregue em 17/10/2026.** Regra em [`PRODUCT.md` §11](PRODUCT.md),
migração em `prisma/migrations/20261017160000_departamentos_por_usuario`.

N departamentos por usuário (tabela de junção, `departmentId` apagado); recorte
fecha em vez de abrir; sem parâmetro de ligar/desligar — a lista de
departamentos da clínica é o botão; os campos de departamento somem onde a
clínica não usa. A tela de Usuários conta quantos atendentes estão sem
departamento. O recorte está provado em `npm run check:period`.

**Decidido e não implementado:** nenhum parâmetro de sistema para departamento.
Se algum dia a clínica quiser o muro baixo *mantendo* o agrupamento,
`Workspace.settings` está no schema e nunca foi escrito.

## 2. Visibilidade e filtro de conversas por agente

**Onde:** Conversas.

**Estado: entregue em 17/10/2026.** Seletor "Agente:" na barra, ao lado de
"Linha:", aparecendo só com mais de um agente. As opções saem das linhas que a
pessoa pode ver, para o filtro não oferecer fila que a lista não mostra.

Agente é filtro, **não** parede — a parede continua sendo o departamento da
linha. Quem precisar de parede por bot dá um departamento próprio à linha dele.

## 3-bis. Recorte de Negócios e Pacientes

**Onde:** Vendas → Negócios, Vendas → Pacientes, exportação de pacientes.

**Estado: entregue em 17/10/2026.** Regra em [`PRODUCT.md` §11](PRODUCT.md).

Destravado pela decisão de que **todo negócio tem dono**: obrigatório no
cadastro pelo menu, herdado de quem assume a conversa no de entrada. Sobrou uma
janela só — entre a mensagem chegar e alguém assumir — e nela o negócio sem dono
é lead não assumido, visível a quem pode assumir (recorte via conversa do
paciente, mesma regra de fila).

Paciente **não** ganhou campo de responsável: o recorte é derivado (negócio
dele, conversa dele, ou conversa numa fila dele).

As rotas de ficha e a exportação aplicam o mesmo recorte — esconder da lista não
é autorização.

## 3. Vocabulário de Agente, Origem, Canal, Responsável e Especialista

**Onde:** Pacientes, Negócios, Conversas, Linhas.

**Estado: entregue em 17/10/2026.** A regra está em
[`PRODUCT.md` §10](PRODUCT.md), o desenho dos três cenários no artefato
"Canal, Origem e Linha", e a migração em
`prisma/migrations/20261017120000_origem_unica`.

O que mudou: lista única de origem (`origins`, ex-`agencies`) usada pela ficha,
pelo negócio e pela linha; `Contact.source` virou `createdVia` + `originId`;
`AgentIntegration.defaultOriginId` faz a linha semear a origem; "Canal" em
Negócios virou "Mídia"; `Deal.source` apagado.

**Responsável ficou como está** — conversa e negócio têm dono, paciente não
ganhou um quarto campo. Deriva do negócio aberto ou da última conversa
atribuída. Reabrir só quando a clínica pedir carteira de pacientes.

**Em aberto:** a origem é de um nível. Hierarquia (Facebook › V4 › campanha) é
uma coluna `parentId` nula no dia em que for preciso comparar aquisição entre
unidades.

---

## 4. Módulo de documentos: propostas, orçamentos e contratos

**Onde:** Vendas → Propostas, ficha do negócio, catálogo, página pública `/p/`.

**Estado: entregue em 21/11/2026.** Regra em [`PRODUCT.md` §19](PRODUCT.md),
migração em `packages/db/prisma/migrations/20261121100000_modulo_de_documentos`.

Desenho saído da engenharia reversa do Ploomes (`docs/ploomes/`, não commitada).
Seis tabelas novas, duas de apoio, quatro colunas em `products_services`.
Revisão em vez de edição; total calculado no servidor com `Decimal(18,4)` e
`CHECK`; link público com validade obrigatória, revogação, rate limit nos dois
eixos e trilha de aceite com hash do conteúdo; envio por e-mail e por WhatsApp
na conversa aberta; aceite move o negócio no funil. A IA sugere itens do
catálogo e **não** escreve preço nem desconto.

Provado por `pnpm check:propostas` (77 asserções) e
`pnpm check:proposta-publica` (os sete requisitos da rota pública, incluindo a
projeção mínima por varredura do fonte). **Fila, e-mail e cron só se provam em
staging** — o workerd não roda nesta máquina.

**Decidido e não implementado:** PDF arquivado (Browser Rendering, partindo do
mesmo HTML), assinatura com certificadora, alçada de desconto (os três estados
existem no domínio, sem tela), preço por cliente e composição de item com piso
de preço, e follow-up automático de proposta não respondida.

## 5. Relatórios

**Onde:** a definir — provavelmente `/relatorios`.

**Estado: a receber.** O estudo do Ploomes **não tem** módulo de relatórios para
copiar: a feature F-038 é literalmente "endpoints: nenhum", com evidência só de
marketing. O que ele tem é a matéria-prima, e o item 4 acima já deixou os
ganchos no banco: aberturas de proposta com carimbo, time-to-accept, taxa de
aprovação, revisões até o aceite e `ProposalItem.productServiceId` (o primeiro
relatório por produto que o produto pode ter).

Duas armadilhas documentadas antes de começar: listagem **sem `COUNT(*)` por
padrão**, porque numa tabela multi-inquilino grande ele é caro; e **multimoeda
não soma** — todo total agregado quebra por moeda.

E o aviso do próprio estudo: dashboard construído antes de o histórico acumular
mostra zeros.

---

Itens 6 a 10: a receber.
