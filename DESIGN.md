# Design system — OdontoBox360

Especificação da camada visual. Este documento é a fonte: o que ele diz, o
código cumpre, e `npm run lint:colors` defende a parte automatizável.

Houve uma rota viva (`/design-system`) renderizando os componentes reais com os
tokens reais. Ela foi removida por decisão do produto — era alcançável por quem
tivesse a URL e não é para ser pública. Se voltar, volta protegida por papel.

Material de referência (outra marca, consulta histórica): `docs/referencias/`.

---

## 1. Princípios

**Calma clínica.** O app é operado numa clínica, ao lado de prontuário e de
formulário impresso, muitas vezes com paciente na cadeira. Superfície branca,
tipografia legível, cor usada com parcimônia. Nada compete com o conteúdo.

**Densidade é requisito, não defeito.** Uma recepcionista olha 40 conversas e 60
contatos por turno. Linha compacta, coluna alinhada e hierarquia clara valem mais
que respiro generoso. Corpo de texto em 14px é deliberado.

**Claro primeiro.** O modo escuro existe e é resolvido com o mesmo cuidado, mas o
padrão é claro.

**Cor carrega significado.** Teal age, menta confirma, âmbar alerta, vermelho
destrói. Cor que não significa nada é ruído — e um elemento colorido só para
"ficar bonito" rouba atenção de um que precisa dela.

**Um primário por tela.** Se tudo é importante, nada é.

---

## 2. Paleta por papel

Ancorada nos **tokens oficiais da marca** (`docs/brand/.../05_Design_Tokens`):

| Oficial | Valor | Onde aparece |
|---|---|---|
| Deep navy | `#0B1F3B` | texto, painel de marca, `foreground` |
| Teal | `#06B6D4` | **a cor de ação**, sem modificação |
| Mint | `#A7F3D0` | tinta de estado positivo, filete de acento |
| Ice | `#E6F7F5` | fundo tingido de ação, hover da sidebar |
| Light surface | `#F8FBFD` | fundo de página |
| Dark surface | `#07182F` | fundo de página no escuro |

Esses sete valores são uma paleta de **marca**, não um sistema de interface — não
têm erro, aviso, neutros nem estados de hover. Os papéis abaixo derivam deles.

**O teal entra sem alteração.** Branco sobre `#06B6D4` dá 2,43:1 e reprova AA com
folga. Mas o navy da própria marca sobre ele dá **6,79:1** — que é como a logo é
construída: "Odonto" em navy, "Box" em teal. A correção foi o par, não escurecer
a cor.

A regra que importa não é "quais são as cores", é **qual token serve a quê**.
Todos vivem em `src/app/globals.css`.

### Superfície

| Token | Claro | Escuro | Uso |
|---|---|---|---|
| `background` | `#F8FBFD` | `#07182F` | fundo de página — os dois são oficiais |
| `card` | `#FFFFFF` | `#0E2440` | card, painel, linha de tabela |
| `popover` | `#FFFFFF` | `#0E2440` | menu, dropdown, tooltip |

O fundo de página é levemente tingido **para que o card branco leia como
levantado**. Antes os dois eram `#ffffff`, e era por isso que o `<main>` precisava
de um `bg-muted/20` para fingir a separação.

### Ação

| Token | Claro | Escuro |
|---|---|---|
| `primary` | `#06B6D4` | `#06B6D4` |
| `primary-foreground` | `#0B1F3B` ⚠ navy | `#04212B` ⚠ navy |
| `primary-hover` | `#05A1BC` | `#38C9E0` |
| `primary-active` | `#048DA5` | `#5FD5E8` |
| `primary-subtle` / `-foreground` | `#E6F7F5` / `#0A5566` | `#0E3A4A` / `#7FDCEC` |

**O texto do botão primário é navy, nunca branco** — nos dois temas. Branco sobre
o teal reprova (2,43:1 no claro, pior ainda nas variantes claras); navy passa
(6,79:1 no claro, 6,88:1 no escuro).

**A cor de ação é literalmente a mesma nos dois temas.** O teal oficial funciona
contra fundo claro e contra fundo escuro, então não há variante de modo — uma
coisa a menos para divergir.

**Nunca use `bg-primary/90` para hover.** Misturar o preenchimento em direção ao
transparente sobre página clara deixa o hover **mais claro** que o repouso — o
botão lê como desabilitado exatamente enquanto está sendo apontado. Use
`hover:bg-primary-hover`.

### Neutros

| Token | Claro | Escuro | Uso |
|---|---|---|---|
| `muted` / `muted-foreground` | `#EEF4F7` / `#53707F` | `#102B49` / `#8FAFC4` | preenchimento mais quieto; texto secundário, label, placeholder |
| `secondary` | `#E4EDF2` | `#16304F` | superfície de botão secundário |
| `accent` | `#D5E5EC` | `#1E3E60` | **superfície de hover** (menu, ghost, linha) |

Três degraus distintos, de propósito: antes eram três nomes para quase o mesmo
cinza, e o hover de um botão secundário não lia como mudança.

> **`accent` não é o acento da marca.** No shadcn é a superfície de hover
> (`hover:bg-accent` em button, table, dropdown-menu). As cores da marca vivem em
> `brand-teal`, `brand-mint`, `brand-navy` e `brand-ice`. Pôr o teal em `accent`
> deixa **todo** hover de dropdown ciano.

### Estado

| Papel | Claro | Escuro | Significa |
|---|---|---|---|
| `success` | `#13B57E` | `#34D399` | confirmado, pago, ativo, enviado |
| `warning` | `#B45309` | `#E0A33C` | atrasado, pendente, expira em breve |
| `info` | `#0E7490` | `#22A5C4` | informativo — é o teal escurecido até carregar branco |
| `destructive` | `#C62828` | `#C62828` | apagar, falhar, perder |

Cada um tem `-foreground` (para preenchimento sólido) e um par
`-subtle` / `-subtle-foreground` (tinta pálida + texto escuro).

**Qual dos dois usar:**

- **Tinta** (`bg-success-subtle text-success-subtle-foreground`) — para *estado*
  passivo: badge, chip, banner. É o padrão.
- **Sólido** (`bg-destructive text-destructive-foreground`) — para *controle*:
  botão, checkbox, toggle.

O nome do token já diz o par. `bg-*` anda com `text-*-subtle-foreground`;
`bg-{papel}` sólido anda com `{papel}-foreground`.

**Texto ou ícone colorido sem preenchimento também usa `-subtle-foreground`.**
Esse token é a **tinta legível daquele matiz**, definida por modo — escura no
claro, clara no escuro. `text-success` puro é o valor de *preenchimento*: sobre
branco dá **2,65:1** e reprova AA; `text-destructive` puro sobre card escuro dá
**3,04:1** e também reprova. Medido, não estimado. Com a tinta, os oito pares
ficam entre 6,5:1 e 12,2:1 nos dois modos.

| Quero | Classe |
|---|---|
| texto ou ícone colorido | `text-{papel}-subtle-foreground` |
| chip, banner, linha destacada | `bg-{papel}-subtle text-{papel}-subtle-foreground` |
| botão, ponto, barra, preenchimento sólido | `bg-{papel} text-{papel}-foreground` |
| borda de realce | `border-{papel}/30` |

**A menta oficial `#A7F3D0` nunca é preenchimento com texto.** Branco sobre ela
dá 1,28:1. Ela é a **tinta** do estado positivo no claro (com texto `#065F46`,
5,99:1) e o **texto** no escuro (sobre tinta verde profunda, 9,74:1). Quem
preenche é um verde mais fundo.

**O anel de foco é o único controle que veste o teal oficial a plena força** —
`#06B6D4`. Anel não carrega texto, então aqui o brilho é vantagem.

### Linhas e foco

| Token | Claro | Escuro | Uso |
|---|---|---|---|
| `border` | `#DCE7EC` | `#1D3A5C` | divisor, borda de card |
| `border-strong` | `#C0D4DE` | `#2A4E76` | divisor enfatizado |
| `input` | `#C0D4DE` | `#2A4E76` | borda de campo |
| `ring` | `#06B6D4` | `#06B6D4` | anel de foco — o teal oficial a plena força |

Borda de campo é mais pesada que borda de card de propósito: `border` é fraca
demais para ler como limite de input sobre a página tingida.

No escuro a borda é **cor real**, não `rgba(255,255,255,.1)` — alfa compõe
diferente sobre `card` e sobre `popover`, então um token desenhava duas linhas
distintas.

### Gráficos

`chart-1..5` no claro: `#06B6D4` `#13B57E` `#0B1F3B` `#7DD3E8` `#065F46`.

Entradas vizinhas trocam de família cromática, para que séries adjacentes não
colem. Não é uma rampa decorativa — é para que duas linhas num gráfico se
distingam.

### Sidebar

Sete tokens próprios (`sidebar`, `-foreground`, `-primary`, `-primary-foreground`,
`-accent`, `-accent-foreground`, `-border`, `-ring`). Hoje o rail é **branco** no
claro e um passo **abaixo** da página no escuro, para recuar em vez de avançar.

Inverter para rail navy depois é mudança nesses sete valores e em nada mais — o
primitivo só lê daqui.

### Cores que vêm do banco

Etiqueta, etapa de funil e cor de agente são **dados do usuário**, hex gravado no
Postgres. Renderizam por `style={{}}` e **não** são tokens.

Regra: existe **um** lugar que renderiza hex do banco — o componente `TagChip`.
Nunca inline numa tela. O motivo é concreto: o alfa antigo (`color + '25'`, 14%)
foi calibrado contra card navy; sobre branco o chip fica quase invisível. Isso se
conserta uma vez, no componente, sem jamais alterar o valor gravado.

**E existe um lugar que define os hex que o produto grava** — `src/lib/palette.ts`.
São três situações, só três: valor que vai para o banco (cor de etapa, de
etiqueta, do agente), opções de um seletor de cor, e e-mail, onde variável CSS
não existe. Tudo o mais é token. O arquivo é allowlisted no `lint:colors`, junto
de `brand-colors.ts` (cores de terceiros) e `lib/email/`.

A rampa do seletor (`PICKER_RAMP`) é a mesma para etapa e etiqueta — oito matizes
da marca, distantes o bastante para distinguir oito à primeira vista. Ela
substituiu a rampa indigo → violeta → roxo → fúcsia, que era a identidade Kaly e
seguia sendo semeada no funil de cada workspace novo muito depois de o produto
deixar de ser Kaly. **Troca de rampa vale só para frente:** cor que a clínica já
escolheu continua renderizando como escolhida.

---

## 3. Tipografia

**Open Sans** para título e corpo. **Inter** carregada só para números, onde o
numeral tabular mantém coluna alinhada. **Mono é stack de sistema** — `font-mono`
aqui só rotula ID, chave de API e URL de webhook, nunca corpo de texto, então uma
terceira família web seria custo de build sem retorno.

### Escala

| Classe | px / entrelinha | Papel |
|---|---|---|
| `text-display` | 40 / 1.2 · 700 | só o painel de marca do login |
| `text-h1` | 28 / 1.2 · 700 | título de página (`PageHeader`) |
| `text-h2` | 24 / 1.25 · 600 | seção dentro da página |
| `text-h3` | 20 / 1.3 · 600 | `CardTitle`, título de dialog |
| `text-h4` | 16 / 1.4 · 600 | sub-seção, legenda de grupo de campos |
| `text-sm` | 14 / 1.5 | **corpo** — o padrão do app |
| `text-xs` | 12 | label, metadado, badge |
| `text-eyebrow` | 22 / 1.2 · 400 | sobrelinha editorial (raro) |

A referência documentava H1 40 → H2 22 → H3 28 → H4 24, que **não é monotônica**.
Aquele "H2" de 22px era uma sobrelinha de marketing, não um segundo nível. Os
pixels foram preservados; os papéis, remapeados — tomada ao pé da letra, a
hierarquia do app se invertia.

### Números

Use a utilidade **`num`** em qualquer dígito que apareça em coluna ou como
métrica. Ela troca a família para Inter e liga `tabular-nums`.

Na prática ninguém precisa lembrar: a coluna do `DataTable` marcada
`numeric: true` e o valor do `KpiCard` aplicam sozinhos. Número solto no meio de
uma frase não precisa.

---

## 4. Espaçamento, raio, elevação

**Raio:** `--radius` é `0.625rem`. Use `rounded-md` em controle, `rounded-lg` em
card, `rounded-full` em badge e avatar.

**Espaçamento:** a escala do Tailwind. Ritmo vertical dentro de card em `gap-4`;
entre seções de página, `gap-6`. Padding de página é do `PageHeader`
(`px-4 py-5 md:px-6`), não do layout — telas full-bleed como a inbox e o kanban
simplesmente não usam.

**Elevação:** quase nenhuma. Card se separa por **borda e superfície**, não por
sombra. `shadow-sm` no máximo, e só onde algo flutua de verdade (popover, sheet).
Sombra empilhada em página densa suja.

**Não é tudo card.** Borda, preenchimento, raio e sombra cada um diz "objeto
separado". Gastá-los em todo bloco achata a hierarquia. Lista densa quer **linha
com borda**, não retângulo arredondado repetido.

---

## 5. Regras de componente

**Botão.** Um `variant="default"` por tela. O resto é `outline`, `secondary` ou
`ghost`. Ação destrutiva é `destructive` e pede confirmação (`ConfirmDialog` —
nunca `confirm()` nativo).

**Campo.** Use o primitivo pelado. `Input`, `SelectTrigger` e `Textarea` já
resolvem superfície, borda, placeholder e foco nos dois modos. Toda classe de cor
que você sentir vontade de adicionar num campo é, quase sempre, uma que o
primitivo já aplica melhor.

**Estados são obrigatórios.** Toda tela que busca dados precisa dos quatro:
carregando (`Skeleton`, nunca "Carregando..."), vazio (`EmptyState` com ícone,
frase e ação), erro (`ErrorState`) e sucesso. Faltar um é bug, não polimento.

**Tabela.** Cabeçalho em `text-muted-foreground`; **dado de célula em
`text-foreground`**, não em muted — o dado é o conteúdo. Coluna numérica à direita
e com `num`. Em telas estreitas, coluna que não cabe some (`hideBelow`) ou a
tabela vira cartão.

**Quadro: cabeçalho e rodapé param, o quadro corre.** No kanban a região da
página não rola — ela se divide em quadro e rodapé. O quadro rola por dentro,
nos dois eixos, e a faixa de Ganho e Perdido fica no rodapé **mesmo sem cartão
nenhum**: ela é alvo de arrasto, e um alvo que só existe depois de rolar até o
fim não é alvo. Medido: com seis colunas de doze cartões, a região externa rola
zero, o quadro rola 193px na vertical e o rodapé não sai do lugar.

**Cabeçalho em ícone precisa continuar tendo nome.** Coluna estreita pode
trocar o rótulo por um ícone — é o caso de WhatsApp e do medidor de dias sem
movimento, onde a palavra era mais larga que o dado. O ícone vai acompanhado de
um `sr-only` com o nome e de um `Tooltip`: sem o primeiro, o botão de ordenar
fica sem nome acessível; sem o segundo, o cabeçalho vira adivinhação para quem
enxerga. Ícone mudo em cabeçalho é bug, não economia.

**Ordenação é padrão de tabela, não recurso de uma tela.** Toda coluna que
carrega **um valor comparável** — texto, número, data, estado de duas vias —
nasce com `sortable: true`. Não recebem ordenação apenas as colunas que não têm
um valor a comparar: coluna de ação (ícone de abrir, de excluir, de WhatsApp),
coluna de múltiplos valores (etiquetas de um paciente) e amostra de cor. Quando a
célula renderiza componente em vez de texto — `StatusBadge`, avatar com duas
linhas, preço formatado — a coluna declara também `sortValue`, que devolve o
valor cru: é por ele que a tabela ordena, nunca pelo que o `cell` desenhou.

O comportamento vem inteiro do `DataTable` e é o mesmo em todas as telas: o
cabeçalho é um `<button>` com `aria-sort`, e o clique cicla em três passos —
crescente, decrescente, **ordem original do servidor**. O terceiro clique
importa: sem ele a pessoa não tem como voltar à ordem que a consulta entregou
(mais recente primeiro, na maioria das telas), e a ordenação passa a ser uma
porta de mão única. A ordenação é local à página carregada — ela reorganiza o que
está na tela, não repagina no banco.

**Ícone.** Lucide, 16px inline, 20px no máximo decorativo. Botão só de ícone
precisa de `Tooltip` e `aria-label` — `title=` não basta. **Ícone em botão tem
regra:** ação primária de página sempre com ícone à esquerda do rótulo; ação de
linha de tabela é só ícone com `Tooltip`; ação secundária em texto vai sem ícone.

**Mídia nativa não entra.** `<audio controls>` e `<video controls>` são
superfícies do navegador: mudam de forma em cada browser, ignoram o tema e têm
altura que não respeita nenhuma grade. Áudio usa `AudioMessage` — controle
desenhado, barra de posição clicável em `bg-current/20`, duração em `num`. A
transcrição que o worker gera é **conteúdo**, não legenda: peso normal, sob um
filete com o rótulo "Transcrição".

**Telefone.** Um só componente, `PhoneInput`: dígitos, no máximo 11, sem
parênteses e sem hífen, e o `55` colado na frente é descartado. A pontuação saiu
porque não existe no banco (que guarda dígitos com o país), não sobrevive a
copiar e colar, e sugere ser parte do dado. Na leitura, `formatPhone` mostra o
número nacional, também sem pontuação — o que se lê é o que se digita. Cada
formulário tinha a sua máscara, e uma delas deixava gravar o país duas vezes.

**Busca não distingue acento.** "André", "Andre" e "andre" localizam a mesma
pessoa. `mode: 'insensitive'` do Prisma resolve só a caixa, então cada tabela
pesquisável tem uma coluna **gerada pelo banco** (`searchText`) com o conteúdo
em minúsculas e sem acento, e a rota compara contra ela usando
`normalizeSearch()` no termo. Nunca escreva nessa coluna — o Postgres recusa, e
é essa recusa que garante que ela não saia de sincronia.

**Busca que cadastra.** Campo que escolhe de uma lista grande — paciente,
produto — usa `Popover` + `Command`, e oferece **cadastrar o que não existe no
próprio menu**, com o que foi digitado já no formulário. O momento em que alguém
descobre que a ficha não existe é sempre no meio de outra tarefa; mandá-la para
a tela de cadastro custa o que estava preenchido. Dois campos bastam no atalho
(nome e telefone); o resto se completa na tela própria. Telefone já cadastrado
responde 409 com o id, e a tela usa a ficha existente em vez de mostrar erro.

**Menu de comando.** Lista disparada por `/` no compositor. Quando o campo de
digitação é externo ao menu (o caso do chat), use `Popover` com
`role="listbox"`/`role="option"`, `aria-selected` e navegação por ↑↓/Enter/Esc
tratada no campo — `cmdk` espera ser dono do próprio input e brigaria com o
compositor. Com campo próprio, use o primitivo `command`. **Nunca um `div`
`z-50` solto:** foi o que havia em quatro lugares do chat, sem Esc, sem clique
fora e sem foco.

**Barra proporcional.** Para estado de fila ou de etapa, a largura de cada
trecho é o valor — e então ela é dado, não enfeite. Três tons no máximo
(`warning`, `primary`, `success`), altura 6px, `role="img"` com `aria-label`
dizendo os números. Quem lê o número exato lê a linha de texto ao lado, não a
barra.

**Linha do tempo.** Marcos em ordem com o trilho desenhado **entre** as marcas,
nunca atrás delas — 1px atravessando um ponto cheio aparece. Marco cumprido é
`bg-success` com `Check`; pendente é `bg-card` com borda e o ícone do marco.
Data em `num`. Só o marco em edição abre; os outros ficam em uma linha.

**Painel que lê e age; nada de modo de edição.** Campo de painel nasce aberto e
grava ao sair — `InlineField` só escreve quando o valor mudou, Enter grava, Esc
devolve o anterior, e um selo "salvo" pisca por dois segundos. Não há botão
Salvar nem botão Editar, porque não há modo: um diálogo de edição que cobre a
tela para mudar um campo é o que esta regra existe para eliminar. Registro
finalizado trava os campos (borda tracejada, fundo `muted`) e a ação primária
passa a ser reabrir.

**Campo que escolhe e cadastra: o `+` mora dentro da borda.** Um botão solto ao
lado lê como "mais um campo" e custa 36px de largura em cada linha — num painel
de 300px, um décimo da tela por campo. `PickField` põe o `+` como segmento
dentro da própria caixa, separado por um filete, e o que foi digitado na busca
vai pré-preenchido no cadastro. Busca dentro do menu só quando a lista é grande;
para meia dúzia de itens, um campo de busca é cerimônia.

**Telas de trabalho não usam o `PageHeader`.** Conversas e Negócios tratam a
altura como recurso escasso: título em `text-h3` dentro de uma barra de duas
linhas, sem descrição, filtros **abertos** na segunda linha (filtrar ali é
rotina, não exceção — o `FilterPanel` recolhível continua certo nas telas de
cadastro), e o conteúdo em `h-[calc(100svh-3.5rem)]` com rolagem por dentro de
cada faixa. Números de resumo vão como tipografia na barra, não como cartões: um
número que só se olha não merece 104px de altura.

**Funil no eixo vertical, não no horizontal.** Coluna de etapa com largura
fixa multiplica a largura necessária por etapa, e aí qualquer painel à direita
disputa espaço com o funil — o problema não é o painel, é o eixo. O trilho
resolve pela raiz: as etapas crescem para baixo (nome, contagem, valor, medidor
e "N parados" por item, mais do que um cabeçalho de 288px jamais mostrou), o
centro exibe uma etapa por vez em linhas densas, e o painel fica. Cada item do
trilho é zona de soltar, então o arrasto sobrevive com alvo maior. O quadro
continua disponível para quem quer a comparação lado a lado.

**Contagem tem de concordar com a imagem ao lado dela.** Um `_count` do banco
ignora o filtro de um `include`: mostrar "9" ao lado de um medidor desenhado com
dois é o número do funil inteiro ao lado da imagem do recorte. Com filtro ligado,
conte o que está carregado.

**Painel ao lado de um quadro: sobrepõe; ao lado de uma tabela: divide.** As
duas superfícies reagem de forma oposta a perder largura. Um kanban de seis
etapas perde duas colunas inteiras e não há como recuperá-las sem fechar o
painel, então ali ele é `absolute inset-y-0 right-0` com sombra — o quadro nem
reflui. Uma tabela encolhe sozinha (as colunas somem por `hideBelow`), então ali
ele é coluna de verdade em `xl:grid-cols-[1fr_320px]`, e volta a sobrepor abaixo
de 1280, onde a tabela já está apertada.

**Tela 01 — a tela de índice.** O padrão fechado em 2026-10-12, depois de
Pacientes, Etiquetas, Produtos, Departamentos, Respostas rápidas e Usuários.
Todo índice que vier (Negócios em lista, Agentes, Campanhas…) nasce nela, com as
cinco partes abaixo e nenhuma a menos. Os componentes: `IndexFrame`,
`FilterPill`, `DataTable frame` + `Pagination` + `BulkBar`, `RecordPanel` +
`PanelActions` + `InlineField`, `RecordDialog` + `FormField` + `MaskedInput`,
`ConfirmDialog`.

1. **Cabeçalho e rodapé, presos.** Linha 1 (50px): nome da tela, ações
   secundárias à vista (Importar, Exportar) e o botão de criar no canto
   direito. Linha 2 (46px, conteúdo 3px acima do centro): busca (só "Buscar" no
   placeholder, fundo `card`), filtros como `FilterPill` que mostram o próprio
   valor, abrem a lista no primeiro clique e somem com ×, Limpar, modo de
   visualização. Nada atrás de um menu `⋯`; sem contador — ele vive no rodapé.
   A tabela vai sangrada, sem margem nem cartão próprio: cabeçalho de 36px em
   maiúsculas pequenas preso; só as linhas rolam; rodapé preso com "1–7 de 7 ·
   Por página · ‹ › " que vira a `BulkBar` ("N selecionados · ações · Excluir ·
   ×") quando há linha marcada. Lista sem paginação no servidor pagina no
   cliente — o rodapé existe sempre.
2. **Linha e seleção.** Checkbox por linha e "Selecionar todos" no cabeçalho;
   clicar na linha abre a ficha; o menu ⋮ tem "Abrir ficha" e "Excluir", nunca
   "Editar". Etiquetas: até três lado a lado, da quarta em diante quebra.
3. **A ficha (`RecordPanel`, 380px).** Terceira coluna à direita da tabela
   (tela inteira no celular); faixa de 40px com "Ficha", ‹ › × ; ↑↓ trocam de
   registro e Esc fecha. Os campos nascem abertos (`InlineField`) e gravam ao
   sair, com o selo "salvo" por dois segundos ao lado do rótulo; o item
   recarregado da lista sempre vence o remendo local. No rodapé, só dois
   ícones com dica (`PanelActions`): o **lápis** abre o diálogo em modo de
   edição e a **lixeira** exclui com confirmação. Sem botão com texto ali, sem
   "formulário completo".
4. **O diálogo (`RecordDialog`, 840 × 700 sempre).** Serve o Novo e a edição
   completa. Branco como a ficha; cabeçalho e rodapé presos, só o formulário
   rola; resumo vivo à direita ("Como vai aparecer", com o aviso "parece já
   existir" quando dá para saber antes). Rótulo em cima, asterisco vermelho no
   obrigatório e a legenda "* Campo obrigatório" no rodapé ao lado de Esc ·
   ⌘↵; erro **abaixo do campo**, em vermelho — nunca toast, nunca resumo no
   topo; o erro do servidor volta para o campo que o causou. Criar: Cancelar ·
   **Criar e novo** · **Criar X**. Editar: Cancelar · **Salvar X** (verbo e
   objeto, nunca "Salvar" nem "OK"). Primeiro campo com foco ao abrir.
   Formulário curto deixa espaço vazio: é o preço de o Criar estar sempre no
   mesmo lugar. Máscara aparece ao digitar e grava limpo (`lib/masks`,
   `MaskedInput`, `PhoneInput`): o molde que falta fica em cinza por cima do
   campo; validação forte ao sair do campo, não a cada tecla.
5. **O alerta de exclusão (`ConfirmDialog`, `destructive`).** Pela lixeira da
   ficha, pelo ⋮ da linha e pelo lote. Título "Excluir X" (no lote, "Excluir
   N X"), descrição que diz **o que se perde** ("será removida de todos os
   pacientes e conversas que a usam"), botão "Excluir". O lote apaga um a um,
   conta os que deram certo e avisa quantos não puderam; o que a API protege
   (primeiro administrador) fica de fora antes de chamar.

**Tela 02 — a tela de trabalho.** Agenda e Negócios (Conversas ainda não):
a mesma Tela 01 com um miolo próprio — lista · quadro · calendário; trilho de
fases · quadro · lista. O que muda é o miolo; o que entra nele é a gramática:

- **Linha 1 vira o lugar dos números.** Os cartões de indicador saem da frente
  do conteúdo e viram a faixa de números clicáveis (`StatPill`, 30px) ao lado
  do título — número em negrito, rótulo em cinza, `aria-pressed`, zero
  desabilitado. Em Negócios os R$ ficam ao lado como `Figure` compacta.
- **Linha 2 é só filtro.** Selects soltos, abas e "chips" viram `FilterPill`
  (Período, Tipo, Responsável, Situação, Fase, Alertas); o modo de visualização
  é o `ViewSeg` (ícones com dica) no fim da linha.
- **O corpo é sangrado.** Sem cartão em volta da lista, do trilho ou do
  calendário; a lista é `DataTable frame` com cabeçalho de 36px e rodapé de
  paginação (no cliente, se a API não pagina).
- **A ficha é a `RecordPanel`**, com os modos como ícones ao lado de "Ficha"
  (agendar, atividades, notas) e um gesto extra no rodapé quando a tela pede
  (a bandeira de desfecho do negócio). Clicar em linha, cartão ou item do
  calendário abre a ficha; o diálogo fica para o Novo e para o lápis.

**Faixa de números clicáveis, não painel de indicadores.** Número que só se olha
pertence a um relatório. Se ele vai ficar no topo de uma tela de trabalho, cada
faixa é um `button` com `aria-pressed` que filtra a lista — e **o filtro do
clique é o mesmo predicado que produziu o número** (um módulo só, consumido pela
contagem e pela consulta), senão os dois divergem no primeiro caso de borda.
Faixa com zero fica desabilitada: filtrar para nada é um beco.

**Painel lateral com modos.** Quando uma tela de viewport inteiro oferece vários
conteúdos auxiliares — resumo, arquivos, agendamento, jornada, notas —, eles
dividem **um** painel e **um modo por vez**: clicar em outro ícone troca o
conteúdo, clicar no mesmo fecha. Dois painéis de 300px não cabem num notebook de
1280, e a alternativa (cada ícone fazendo uma coisa diferente — um abre barra,
outro abre diálogo, outro abre painel) torna a faixa imprevisível. Regras:

- O painel tem **cabeçalho com o título do modo e um botão de fechar**. Com
  cinco conteúdos possíveis no mesmo retângulo, o painel precisa dizer qual
  está aberto; sem o título, o conteúdo é a única pista.
- Os gatilhos são `Toggle` com `pressed`, nunca `Button` com `variant` trocado:
  é `aria-pressed` que anuncia "aberto" para o leitor de tela.
- Cada modo é **um componente com `key` da entidade**, para que trocar de
  paciente remonte o painel em vez de mostrar o rascunho do anterior.
- Abaixo de `xl`, o painel **sobrepõe** (`absolute inset-y-0 right-0` +
  `shadow-lg`, `xl:static`) em vez de encolher a coluna de mensagens. Ícone que
  não faz nada numa janela de 1280 é defeito, não responsividade.
- A ordem dos ícones é a ordem de uso, não a de implementação: achar, entender,
  agir, classificar, acompanhar, registrar.

**Formulário em painel.** Um formulário que depende do que está ao lado — marcar
consulta exige reler o que o paciente escreveu — vive em painel, não em diálogo:
o diálogo tampa justamente o contexto que a pessoa precisa consultar. Diálogo
continua certo para o que é decisão fechada e curta (confirmar, escolher
motivo). Por isso `ActivityForm` não traz chrome: o mesmo formulário serve
painel e caixa.

**O que a IA gera é conteúdo pago.** Abrir um painel nunca dispara geração:
`GET` lê o que está guardado, `POST` gera e debita. O painel mostra **quando** o
texto foi gerado e **quantas mensagens chegaram depois**, porque sem isso o
botão "Atualizar" é um palpite sobre gastar crédito do cliente.

**Fato vem do banco, nunca do texto gerado.** Num painel de IA, o que é dado —
uma data de consulta, um valor, um status — é lido do banco a cada abertura e
renderizado como seção própria, acima da prosa. Texto de modelo é uma fotografia
do dia em que foi gerado: "tem consulta marcada" continuaria afirmando isso uma
semana depois da consulta. O dado entra no prompt como contexto, para o modelo
não contradizê-lo, e não para ele repeti-lo.

---

## 6. O shell

**A trilha mora no Topbar.** Uma tela diz onde está (trilha, `text-sm
text-muted-foreground`, no Topbar) e como se chama (`h1` em `text-h1`, no
`PageHeader`). São papéis diferentes, então não é duplicação — o que era
duplicação é o Topbar repetir o nome que o cabeçalho já mostra, e isso saiu.
Vantagem de estar no shell: as telas de viewport inteiro (chat, kanban), que não
renderizam `PageHeader`, continuam orientadas.

**Um `h1` por tela.** Sempre no `PageHeader`, sempre `text-h1`. Título dentro de
coluna — o "Conversas" da lista do chat, o "Novo agente" do assistente — é
`text-h3`, porque não é o título da página.

**Toda tela tem descrição.** Uma linha sob o título, `text-sm
text-muted-foreground`, dizendo para que a tela serve. Exceção única: o chat, que
é ferramenta de viewport inteiro e não tem onde pôr.

**Ação primária no topo à direita**, no slot `actions` do `PageHeader` — nunca no
rodapé do formulário. Formulário dentro de aba usa `<form id>` e o botão do
cabeçalho envia por `form=`.

**Padding é do `PageHeader`**, não do layout: `px-4 md:px-6`. Tela que quer o
viewport inteiro simplesmente não renderiza um.

**A aba do navegador diz o nome da página.** `DocumentTitle`, no layout, aplica
`pageTitleFor(pathname) · OdontoBox360`. Quinze janelas abertas eram quinze abas
idênticas, e um favorito não dizia para onde apontava.

**O primeiro Tab é "Pular para o conteúdo".** Mora no layout, porque só ele
garante a posição na ordem de foco, e aponta para `#conteudo` — a região que
rola. Fica `sr-only` até receber foco.

---

## 7. Voz da interface (pt-BR)

**Sentence case em tudo.** "Novo contato", não "Novo Contato". Caixa alta só em
nome próprio.

**Verbo primeiro em ação.** "Criar contato", não "Criação de contato". Nunca "OK"
ou "Enviar" sozinho quando um verbo específico serve.

**Sem ponto final em rótulo e título.** Texto de apoio e corpo de estado vazio
levam ponto.

**Sem "por favor".** A interface não pede favor. "Informe um nome", não "Por favor
informe um nome".

**Erro diz o que aconteceu e o que fazer.** "Esse e-mail já está em uso. Tente
outro." Sem prefixo "Erro:", sem primeira pessoa, sem exceção crua na tela.

**Sem "com sucesso".** O toast verde *é* o sucesso. "Contato salvo", não "Contato
salvo com sucesso!". E sem "!" — a confirmação não comemora.

**Título de confirmação é afirmação, não pergunta.** "Excluir contato", não
"Excluir contato?" — é a mesma regra do ponto final em título. A pergunta já
está no fato de existir um diálogo com Cancelar e Excluir. A descrição nomeia o
objeto entre aspas e diz o que se perde: "«Overdenture» será removido do
catálogo. Negócios que já o referenciam não mudam." Nunca "esta ação não pode
ser desfeita" sozinha.

**Estado vazio é convite, não desculpa.** Título nomeia o espaço ("Nenhum contato
ainda"), uma linha explica, o botão é um verbo. Evite "Nada aqui".

**Placeholder é exemplo real.** "nome@clinica.com.br", não "Digite o e-mail".

---

## 8. Os dois modos

Claro é o padrão. Escuro é alternativa completa, não degradada.

Toda cor sai de token. Uma cor cuja única definição vive dentro de `.dark` não
existe no claro — é o bug clássico de artefato ilegível.

**Ao testar:** o `next-themes` grava a escolha em `localStorage`. Uma sessão que
já escolheu escuro **continua** escura; mudar o padrão só afeta quem não tem nada
gravado. Para conferir o claro, perfil novo ou limpar a chave `theme`.

**O destrutivo é o único token de estado que inverte rótulo entre os modos.** No
claro é `#C62828` com rótulo branco (5,62:1). No escuro clareia para `#EA5F57`
com rótulo navy `#2B0A08` (5,46:1), porque o valor do claro dava **2,78:1**
contra `--card`: o rótulo passava e a silhueta do botão sumia. Branco sobre o
tom claro reprovaria (3,49:1) — é a mesma armadilha do `--primary-foreground`.

---

## 9. O que não fazer

- **Nenhum passo cru da escala do Tailwind.** Nem `text-gray-400`, nem
  `bg-green-500`, nem `text-red-400` — inclusive os matizes que "significam
  algo": vermelho é `destructive`, âmbar é `warning`, verde é `success`, azul é
  `info`. Como passo cru eles eram 155 usos escolhendo o próprio `-400` (valor de
  modo escuro) sobre superfície branca, e verde queria dizer "ativo" numa tela e
  "pago" em outra. `npm run lint:colors` falha o build se voltar — e cobre
  roxo, cinza, ciano e os quatro de estado.
- **Nenhum hex em `.tsx` ou `.ts`**, entre colchetes ou entre aspas, fora de
  `TagChip` (renderiza hex do banco), `lib/palette.ts` (define os hex que o
  produto grava), `brand-colors.ts` (cores de terceiros), `lib/email/` e
  `global-error.tsx`. O hex entre aspas era o ponto cego do linter: foi por ali
  que a rampa roxa sobreviveu dentro de `STAGE_COLORS`.
- **Nenhuma aurora em blur.** `blur-[128px]` atrás de um card é o clichê de "dark
  SaaS" e não tem nada a ver com odontologia.
- **Nenhum card de vidro.** Translucidez sobre página branca lê como bug de
  renderização.
- **Nenhum gradiente em CTA.** Preenchimento chapado.
- **Nenhum emoji como marcador de seção.**
- **Nenhum `confirm()` / `alert()` nativo.**
- **Nenhuma transição global em `*`.** Componente que deve animar declara.
- **Nenhum `opacity` em texto** para fazê-lo secundário — use
  `text-muted-foreground`. Opacidade multiplica contra o fundo e deriva por
  superfície.

---

## 10. Onde as coisas moram

| Caminho | O quê |
|---|---|
| `src/app/globals.css` | **os tokens** — a fonte da verdade |
| `src/components/ui/` | primitivos shadcn. Não edite para resolver um caso de tela |
| `src/components/shared/` | abstrações do produto (`PageHeader`, `DataTable`, `EmptyState`, `KpiCard`, `StatusBadge`, `TagChip`, `AudioMessage`, `QueueMeter`, `DealJourney`…). Fora de `ui/` de propósito, para que um `shadcn add` futuro não as sobrescreva |
| `src/components/shared/DealJourney.tsx` | **a jornada do negócio** — marcos, rótulos, ordem e `currentMilestone()`. Chat e pipeline leem daqui; eram duas listas e os rótulos já tinham divergido |
| `src/components/layout/BreadcrumbTrail.tsx` | a trilha do Topbar |
| `src/app/api/scheduling/targets/` | onde um agendamento deve cair (Google Calendar, Clinicorp). O compositor pergunta em vez de supor |
| `src/components/brand/` | `Logo` — ponto único dos assets de marca |
| `src/lib/nav.ts` | árvore de rotas e mapa de rótulos pt-BR |
