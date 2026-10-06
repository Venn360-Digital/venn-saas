# Design system — OdontoBox360

Especificação da camada visual. A face visível dela é a rota **`/design-system`**
dentro do app, que renderiza os componentes reais com os tokens reais — ela não
pode divergir do código porque é o código. Este documento explica as decisões; a
rota mostra o resultado.

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

**Cor carrega significado.** Azul age, menta confirma, âmbar alerta, vermelho
destrói. Cor que não significa nada é ruído — e um elemento colorido só para
"ficar bonito" rouba atenção de um que precisa dela.

**Um primário por tela.** Se tudo é importante, nada é.

---

## 2. Paleta por papel

A regra que importa não é "quais são as cores", é **qual token serve a quê**.
Todos vivem em `src/app/globals.css`.

### Superfície

| Token | Claro | Escuro | Uso |
|---|---|---|---|
| `background` | `#F7F9FA` | `#0F1C28` | fundo de página |
| `card` | `#FFFFFF` | `#16293A` | card, painel, linha de tabela |
| `popover` | `#FFFFFF` | `#16293A` | menu, dropdown, tooltip |

O fundo de página é levemente tingido **para que o card branco leia como
levantado**. Antes os dois eram `#ffffff`, e era por isso que o `<main>` precisava
de um `bg-muted/20` para fingir a separação.

### Ação

| Token | Claro | Escuro |
|---|---|---|
| `primary` | `#3678AE` | `#5A9ED0` |
| `primary-foreground` | `#FFFFFF` | `#0B1620` ⚠ navy |
| `primary-hover` | `#2E6693` | `#74AFDA` |
| `primary-active` | `#27567D` | `#8CBFE2` |
| `primary-subtle` / `-foreground` | `#EAF2F9` / `#184F7C` | `#1D3A52` / `#9AC6E6` |

**A ação é o azul médio, não o navy.** Um preenchimento navy seria o elemento
mais alto da tela, e essas telas são densas.

**Nunca use `bg-primary/90` para hover.** Misturar o preenchimento em direção ao
transparente sobre página branca deixa o hover **mais claro** que o repouso — o
botão lê como desabilitado exatamente enquanto está sendo apontado. Use
`hover:bg-primary-hover`.

**No escuro o texto do botão é navy, não branco.** Branco sobre `#5A9ED0` dá
2,90:1 e reprova AA.

### Neutros

| Token | Claro | Escuro | Uso |
|---|---|---|---|
| `muted` / `muted-foreground` | `#F1F4F6` / `#5B7183` | `#1C3042` / `#93A7B8` | preenchimento mais quieto; texto secundário, label, placeholder |
| `secondary` | `#E8EDF1` | `#223A50` | superfície de botão secundário |
| `accent` | `#DFE7ED` | `#2B4760` | **superfície de hover** (menu, ghost, linha) |

Três degraus distintos, de propósito: antes eram três nomes para quase o mesmo
cinza, e o hover de um botão secundário não lia como mudança.

> **`accent` não é o acento da marca.** No shadcn é a superfície de hover
> (`hover:bg-accent` em button, table, dropdown-menu). A menta vive em
> `brand-accent` e `success`. Pôr a menta em `accent` deixa **todo** hover de
> dropdown verde.

### Estado

| Papel | Claro | Escuro | Significa |
|---|---|---|---|
| `success` | `#21B896` | `#2FCCA8` | confirmado, pago, ativo, enviado |
| `warning` | `#C77700` | `#E39A28` | atrasado, pendente, expira em breve |
| `info` | `#184F7C` | `#749EC0` | informativo, neutro-positivo |
| `destructive` | `#D32F2F` | `#E53935` | apagar, falhar, perder |

Cada um tem `-foreground` (para preenchimento sólido) e um par
`-subtle` / `-subtle-foreground` (tinta pálida + texto escuro).

**Qual dos dois usar:**

- **Tinta** (`bg-success-subtle text-success-subtle-foreground`) — para *estado*
  passivo: badge, chip, banner. É o padrão.
- **Sólido** (`bg-destructive text-destructive-foreground`) — para *controle*:
  botão, checkbox, toggle.

O nome do token já diz o par. `bg-*` anda com `text-*-subtle-foreground`;
`bg-{papel}` sólido anda com `{papel}-foreground`.

**Branco não vai sobre a menta** — 2,51:1. O foreground dela é verde profundo.

**O vermelho claro é `#D32F2F`, não `#E53935`.** Branco sobre `#E53935` dá
4,23:1 e reprova AA para rótulo de botão. `#E53935` fica só no escuro, onde
assenta sobre fundo escuro.

### Linhas e foco

| Token | Claro | Escuro | Uso |
|---|---|---|---|
| `border` | `#E9EBEC` | `#243B50` | divisor, borda de card |
| `border-strong` | `#D5DBE0` | `#30506B` | divisor enfatizado |
| `input` | `#D5DBE0` | `#30506B` | borda de campo |
| `ring` | `#3678AE` | `#5A9ED0` | anel de foco |

Borda de campo é mais pesada que borda de card de propósito: `border` é fraca
demais para ler como limite de input sobre a página tingida.

No escuro a borda é **cor real**, não `rgba(255,255,255,.1)` — alfa compõe
diferente sobre `card` e sobre `popover`, então um token desenhava duas linhas
distintas.

### Gráficos

`chart-1..5`: `#3678AE` `#21B896` `#184F7C` `#749EC0` `#0E6B56`.

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

**Ícone.** Lucide, 16px inline, 20px no máximo decorativo. Botão só de ícone
precisa de `Tooltip` e `aria-label` — `title=` não basta.

---

## 6. Voz da interface (pt-BR)

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
salvo com sucesso!".

**Estado vazio é convite, não desculpa.** Título nomeia o espaço ("Nenhum contato
ainda"), uma linha explica, o botão é um verbo. Evite "Nada aqui".

**Placeholder é exemplo real.** "nome@clinica.com.br", não "Digite o e-mail".

---

## 7. Os dois modos

Claro é o padrão. Escuro é alternativa completa, não degradada.

Toda cor sai de token. Uma cor cuja única definição vive dentro de `.dark` não
existe no claro — é o bug clássico de artefato ilegível.

**Ao testar:** o `next-themes` grava a escolha em `localStorage`. Uma sessão que
já escolheu escuro **continua** escura; mudar o padrão só afeta quem não tem nada
gravado. Para conferir o claro, perfil novo ou limpar a chave `theme`.

---

## 8. O que não fazer

- **Nenhum roxo.** Era a identidade Kaly. `npm run lint:colors` falha o build se
  voltar.
- **Nenhum hex direto em `.tsx`** fora de `TagChip` e dos pickers de cor. Nenhum
  `bg-[#...]`, nenhum `text-gray-400`. Use token.
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

## 9. Onde as coisas moram

| Caminho | O quê |
|---|---|
| `src/app/globals.css` | **os tokens** — a fonte da verdade |
| `src/components/ui/` | primitivos shadcn. Não edite para resolver um caso de tela |
| `src/components/shared/` | abstrações do produto (`PageHeader`, `DataTable`, `EmptyState`, `KpiCard`, `StatusBadge`, `TagChip`…). Fora de `ui/` de propósito, para que um `shadcn add` futuro não as sobrescreva |
| `src/components/brand/` | `Logo` — ponto único dos assets de marca |
| `src/lib/nav.ts` | árvore de rotas e mapa de rótulos pt-BR |
| `src/app/design-system/` | a rota viva |
