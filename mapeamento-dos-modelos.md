# Mapeamento dos conjuntos de cliente para os modelos

* **Data:** 2026-10-31
* **Fonte Odontobox:** `public/treinamento/` — cliente **Implante Já**, agente **Rute**
* **Fonte Stagent:** `public/treinamento/` — cliente **STB Australia**, agente **Matilda**
* **Não comitar este arquivo.** Ele nomeia os dois clientes; serve ao trabalho e
  não ao repositório.

## O que os dois conjuntos são

Não são rascunhos. Cada documento tem versão e data no cabeçalho, marca o que é
**confirmado** e o que está **pendente de validação**, mantém a tabela de preços
fora da base consultável, e trata exemplo como ilustração da regra e não como
política nova.

Isso muda a qualidade da matéria-prima: o que falta não é conteúdo, é **encaixe**.

O `README.md` de cada pasta fica fora de tudo — é controle do trabalho do
cliente, não insumo de treinamento. Não entra no modelo, nos documentos, nem no
Cérebro, e não é citado como fonte neste mapeamento.

## Parte 1 — Os oito documentos do catálogo

Sete dos oito existem nos dois conjuntos. `cenarios` não existe por esse nome nos
dois — mas existe, com outro nome (ver Parte 2).

### Correção: não existe trava de cabeçalho nos documentos do cliente

Eu havia escrito que a conversão era obrigatória porque a conferência exige
igualdade de conjunto com o catálogo. **Está errado, e a razão está no código.**
`conferirEstrutura` não confere nome de seção — e o comentário diz que isso foi
uma correção deliberada:

> A primeira versão comparava os `##` escritos com a lista do catálogo e acusava
> "sem conteúdo em: Follow-up". Ao encontrar documentos reais de cliente, ficou
> claro que a premissa estava errada: as seções são da clínica e do método dela.
> O verificador acusava sete documentos bons.

O que sobra conferido é o que vale em qualquer redação: documento sem `##`
nenhum, e seção maior que um trecho. A igualdade de conjunto existe em **um**
lugar só — `test-treinamento` sobre `MODELOS`, os modelos que nós embarcamos.

Medido: `check:treinamento` contra os documentos reais da Odontobox passa hoje,
como estão, sem renomear nada.

```
ok  instrucoes-centrais    2863/ 10000   6 trechos
ok  empresa                2574/ 10000   7 trechos
ok  servicos               4228/ 50000   8 trechos
ok  processo-comercial     6431/ 10000  15 trechos
ok  faq                    3444/ 50000  13 trechos
ok  privacidade            2191/ 10000   5 trechos
```

E medido também: **um `##` por serviço já gera um trecho por serviço**, com
caminho `["Serviços prestados","Implante dentário"]`. O `###` sob o `##` do
catálogo gera os mesmos 3 trechos, só com o agrupamento no caminho. A
granularidade do cliente já está certa.

Então as duas conversões abaixo **não são exigidas dos documentos do cliente**.
Elas são o que os **modelos** precisam, para passar na igualdade de conjunto ao
mesmo tempo que ensinam a granularidade por item. Para o cliente, são melhoria
opcional; para o modelo, são obrigatórias.

### Natureza A — renomear cabeçalho sinônimo (exigido só do modelo)

O cliente escreveu a mesma seção com outro nome. O modelo embarcado tem de usar
o nome do catálogo, senão `test-treinamento` reprova.

| Documento | Escrito pelo cliente | Catálogo pede |
|---|---|---|
| instrucoes-centrais | `Identidade` | `Identidade do agente` |
| empresa | `Identificação` | `Identificação da empresa` |
| empresa | `Horário` | `Horário de funcionamento` |
| empresa | `Posicionamento e diferenciais informados` | `Posicionamento e diferenciais` |
| empresa | `Como explicar a clínica` | `Sobre a empresa` |
| processo-comercial | `Objetivo` | `Objetivo comercial` |
| privacidade | `Queixas pós-operatórias e urgências` | `Pós-venda` |
| privacidade | `Privacidade e dados pessoais` | `Privacidade e proteção dos dados` |
| privacidade | `Incerteza e conflito de informações` | `Conflitos` |
| todos | `Exemplo ou sugestão de resposta — …` | `Exemplos de resposta` |

### Natureza B — rebaixar de `##` para `###` (exigido só do modelo)

O cliente escreveu **um `##` por item** onde o catálogo declara um `##` de
agrupamento. Parecia contradição do catálogo e não é: `### Implante dentário` sob
`## Serviços` gera **um trecho por serviço**, com o caminho
`Serviços prestados › Serviços › Implante dentário`. O `explicacao` do catálogo
pede "um subtítulo por serviço" e o nível certo desse subtítulo é `###`.

É isto que dissolve a contradição aparente do catálogo — e é o que torna um
modelo possível: `##` do catálogo para a igualdade de conjunto, `###` por item
para ensinar a granularidade. Para o documento do cliente não muda nada
funcional (3 trechos de um jeito, 3 do outro); só acrescenta o agrupamento ao
caminho do trecho.

| Documento | Itens escritos como `##` | Vão para `###` sob |
|---|---|---|
| servicos | Implante dentário, Prótese protocolo, Prótese overdenture, Diferença protocolo/overdenture, Outros procedimentos, Sedação, Tempo de tratamento | `## Serviços` |
| faq | 12 perguntas, uma por `##` | `## Perguntas e respostas` |
| tecnicas-de-venda | 5 objeções + "Explicar benefícios" + "Serviço não disponível" | `## Objeções` |
| processo-comercial | Etapa 1 a 4, Orçamento, Encerramento, Horários × disponibilidade, Preços, Política comercial | `## Etapas do atendimento`, `## Qualificação`, `## Agendamento`, `## Limites comerciais` |

O `processo-comercial` é o único que exige **julgamento** na distribuição: 13
cabeçalhos escritos contra 7 do catálogo, e decidir qual etapa é "Qualificação" e
qual é "Agendamento" é leitura, não regex.

### Seções que o catálogo pede e o cliente não escreveu

| Documento | Falta | O que fazer |
|---|---|---|
| instrucoes-centrais | `Limites técnicos` | o cliente escreveu `Limites clínicos`, que é de Privacidade. O conteúdo de limite técnico está em `Fluxo de atendimento` e `Encerramento` — redistribuir |
| servicos | `Diferenciais` | existe em `empresa` como "Posicionamento e diferenciais informados". Decidir onde fica |
| faq | — | só o nome da seção de exemplos |
| todos | `Exemplos de resposta` | é renomeação, não falta |

## Parte 2 — Cenários existe, com outro nome

`07_TRANSFERENCIA_HUMANA.md` (Odontobox) e `08_TRANSFERENCIA_HUMANA.md`
(Stagent) **são documentos de Cenários**. A estrutura já é a do modo
`procedimento`:

| Escrito | É |
|---|---|
| `## Encaminhar à central de agendamento quando` | o `Quando:` de um cenário |
| `## Encaminhar à equipe clínica quando` | o `Quando:` de outro |
| `## Como comunicar` | os `Passos:` |
| `## Restrições` | o que não fazer — parte dos `Passos:` |
| `### Pedido genérico de agendamento` e outros dois | um cenário cada |

A conversão é escrever cada situação como `### <título>` sob `## Cenários`, com
uma linha `Quando:` e uma lista `Passos:`. **Não é mover texto**: os exemplos
mostram a fala, e o cenário precisa dos passos. Leitura e reescrita.

No Stagent, `10_VISTOS_E_LIMITES_DE_ORIENTACAO.md` traz mais três cenários em
`## Casos que exigem encaminhamento`.

## Parte 3 — Os arquivos extras, e onde eu discordo

A intenção declarada é mandá-los ao Cérebro, que é o acervo genérico. Para a
maioria isso está certo. Para dois, não — e a razão é o **modo**, não o conteúdo.

| Arquivo | Intenção | Recomendação | Por quê |
|---|---|---|---|
| `07_`/`08_TRANSFERENCIA_HUMANA` | Cérebro | **`cenarios`** | No Cérebro ele é recuperado como **fato**, sob "use os trechos como fonte de verdade". É procedimento: o agente leria as regras de encaminhamento *para o paciente* em vez de executá-las. É exatamente a distinção que o passo 6 construiu |
| `10_VISTOS_E_LIMITES` (Stagent) | Cérebro | **dividir em três** | `## O que não pode fazer` são **limites** → `privacidade`, que vai em toda mensagem. Limite que depende de a busca achar é limite que falha quando a busca erra. `## Casos que exigem encaminhamento` → `cenarios`. O resto (fontes oficiais, custos de comprovação) → Cérebro |
| `09_MATRICULAS_E_DOCUMENTOS` (Stagent) | Cérebro | **Cérebro** ✓ | é fato consultável: documentos pedidos, prazos, bolsas |
| `11_GUIA_DO_ESTUDANTE` (Stagent) | Cérebro | **Cérebro** ✓ | fato: antes da viagem, chegada, custo de vida, OSHC |
| `nota de abertura` (Stagent) | — | **campo `initialMessage`** | é a saudação literal. Ela é coluna do agente, enviada como está — não é documento |
| `VALORES_INTERNOS_RESTRITO` | — | **lugar nenhum** | o próprio arquivo diz "USO EXCLUSIVO INTERNO, NÃO DISPONIBILIZAR". Nem Cérebro, nem documento, nem modelo |

## Parte 4 — Os defeitos que o mapeamento revelou

### A seção de exemplos não era reconhecida — **CONSERTADO**

`ehSecaoDeExemplos` comparava por **prefixo** contra `"exemplos de resposta"`.
Medido com os títulos reais: nenhum casava.

| Título escrito | Onde | Antes | Agora |
|---|---|---|---|
| `Exemplos de resposta` | (declarado) | retira | retira |
| `Exemplo ou sugestão de resposta — convênio` | `faq`, **acervo** | **indexa** | retira |
| `Exemplos ou sugestões de resposta` | `servicos`, **acervo** | **indexa** | retira |
| `Exemplo de resposta` | `faq` do Stagent | **indexa** | retira |
| `8. Exemplo completo` | `tecnicas-de-venda` (prompt) | indexa | indexa |

**O alcance era menor do que eu disse, e vale registrar o erro.** Eu escrevi
"todas as seções de exemplo dos dois conjuntos cairiam no acervo". Não: o prompt
usa só `semComentarios`, então exemplo em documento de modo `prompt` vai ao
prompt por desenho. O acervo recebe apenas `servicos`, `faq` e `cenarios` — o que
nos conjuntos reais dá **duas seções**, as duas na Odontobox.

Dessas duas, uma tinha corpo próprio e virava trecho de verdade:

```
["FAQ e sinônimos — Rute", "Exemplo ou sugestão de resposta — convênio"]
Paciente: Vocês atendem pelo meu convênio?  Rute: "Não tenho essa info…"
```

Um diálogo roteirizado, vetorizado, entregue ao modelo sob "use os trechos como
fonte de verdade". Um trecho, não vinte — e ainda assim é o defeito.

Consertado com duas condições (`exemplo` na abertura **e** a palavra `resposta`),
porque `exemplo` sozinho comeria "Exemplos de cursos oferecidos" — e seção de
fato retirada cala o agente em silêncio, que é o erro pior dos dois. Oito casos
novos em `test-treinamento`, incluindo os quatro falsos positivos.

### O catálogo de `privacidade` divergiu entre os apps

`Limites clínicos` na Odontobox, `Limites de atuação` nos dois clones. Isso **não**
afeta documento de cliente (não há conferência de nome), mas afeta o **modelo**:
o mesmo texto reprovaria no outro repositório. É decisão de produto — ou o nome
genérico vale nos três, ou cada app tem o seu modelo mesmo onde o conteúdo é
igual.

### Duas seções do Stagent são longas demais para um trecho

`check:treinamento` contra o conjunto do Stagent acusa:

```
XX  servicos   longo demais para um trecho: 1. ELICOS — cursos de inglês,
                                            2. Higher Education — universidades e colleges
XX  faq        longo demais para um trecho: Sinônimos e termos equivalentes
```

Seção maior que 1.500 caracteres é cortada **por dentro**, por caractere — o
trecho começa e termina no meio de uma frase. Aqui o rebaixamento para `###`
deixa de ser opcional: é o que conserta o aviso, dividindo ELICOS e Higher
Education em subseções que caibam. Não é preferência de estilo, é o corte.

### Nome de arquivo fora do slug

`tecnicas-de-vendas.md` na Odontobox (plural) contra o slug `tecnicas-de-venda`.
`check:treinamento` reporta "arquivo ausente" e passa por cima do documento sem
conferir nada. No Stagent o nome está certo. É renomeação de um arquivo, e
importa porque o aviso é silencioso: parece que o documento foi conferido.

## Parte 5 — O que vai para o modelo, e o que não vai

A regra aprovada: estrutura e instrução, nunca afirmação de negócio. Aplicada aos
dois conjuntos, documento por documento.

| Documento | Vai ao modelo | Fica só no cliente |
|---|---|---|
| privacidade | limites clínicos, LGPD, regra de urgência, "não prometa resultado", como agir em conflito de informação | contatos, telefone do plantão |
| instrucoes-centrais | forma da identidade, estrutura do tom, objetivo, limites técnicos | nome do agente, nome da empresa |
| tecnicas-de-venda | princípios, descoberta, as objeções **como títulos** com exemplo em comentário | o texto das respostas, que carrega preço e política |
| processo-comercial | as etapas como estrutura, "não agendar sem ferramenta", "não divulgar preço sem autorização" | o que qualifica, a tabela, a campanha |
| servicos | só a estrutura: `## Serviços` com um `###` de exemplo em comentário | todo o conteúdo |
| empresa | só a estrutura | todo o conteúdo |
| faq | estrutura, as regras de sinônimo, e as perguntas **universais** como títulos (horário, localização, formas de pagamento, falar com humano) | as respostas |
| cenarios | os cenários universais: pede humano, urgência, quer cancelar, pergunta preço sem avaliação, serviço não disponível | os específicos de nicho |

Duas observações sobre política de cliente que **são seguras** de generalizar,
porque restringem em vez de afirmar: "a Rute não divulga preço nesta fase" e "a
Rute não tem acesso à agenda". Um agente que não cota preço e não promete horário
é mais seguro que o contrário, em qualquer nicho. Elas podem ir ao modelo como
**instrução**, não como fato do negócio.

## Parte 6 — O que o banco de produção mostrou (2026-10-31)

Conferido em leitura, no branch `production` da Odontobox.

**A conta de teste não estava vazia.** O workspace *Unidade 1* (slug `venn`,
agente **Lia**) já roda com os **sete documentos da Implante Já**, carregados em
29/10 — os tamanhos batem com a pasta. Toda medição do estudo foi feita sobre
conteúdo de cliente real.

**A conta do cliente, sim, está vazia**: a Rute tem zero documentos. O material
só existe na pasta.

**E três dos 24 trechos do acervo são exemplo servido como fato** — a prova em
dado real do defeito do reconhecedor:

```
faq       › Exemplo ou sugestão de resposta — convênio           14 indexados, devia ser 13
servicos  › Exemplos ou sugestões de resposta › Diferença …      10 indexados, devia ser 8
servicos  › Exemplos ou sugestões de resposta › Dúvida sedação
```

**O `cenarios` da Lia está encenado como rascunho** (8.448 bytes, md5 conferido
contra o arquivo), `content` vazio e nada indexado. **Publicar espera a PR #113
ir ao ar**: com o reconhecedor antigo, publicar não tira os três e acrescenta um
quarto, da seção de exemplos do próprio `cenarios`.

## Ordem de trabalho proposta

1. ~~Conserto do reconhecedor da seção de exemplos.~~ **Feito** — na PR #113,
   com oito casos de teste e a prova no conteúdo real.
2. Renomear `tecnicas-de-vendas.md` → `tecnicas-de-venda.md` na Odontobox, para
   o documento parar de ser pulado em silêncio.
3. **Os dois conjuntos podem ir para as contas como estão.** Passam no
   `check:treinamento`, a granularidade já está certa, e a seção de exemplos
   agora é reconhecida. Renomear sinônimos e rebaixar para `###` é melhoria
   opcional aqui — não requisito. O que **falta de verdade** é o `cenarios`
   (item 5) e a divisão do `10_VISTOS_E_LIMITES` no Stagent.
4. Decisão sobre o nome da seção de `privacidade` nos três apps — é pré-requisito
   do modelo, não do cliente.
5. ~~Escrever `cenarios` dos dois a partir dos arquivos de transferência.~~
   **Feito.** Odontobox: 14 cenários, 0 problemas, 8.185/50.000 caracteres.
   Stagent: 13 cenários, 0 problemas, 8.758/50.000. Os dois saem do
   `TRANSFERENCIA_HUMANA` mais as urgências do `privacidade` (Odontobox) e os
   casos de visto do `10_VISTOS` (Stagent). Nenhum promete prazo nem nomeia
   contato: o que o material do cliente não resolve ficou em
   `<!-- confirmar: … -->` — três no Stagent, dois na Odontobox.

   Escrever esses dois documentos revelou o **oitavo defeito**: exemplo na seção
   reservada virava cenário executável no prompt estável. Consertado nos três.

   Prompt estável medido com os oito documentos reais: Odontobox **6.349
   tokens** (638 do catálogo de Cenários, 10%); Stagent **7.741** (642, 8%). O
   catálogo saiu a ~46 tokens por cenário, contra os ~30 que o estudo previu.
6. ~~Destilar os modelos, documento por documento, pela tabela da Parte 5.~~
   **Os oito da Odontobox: feitos** — na PR #113. Forma: todo o conteúdo em
   comentário de HTML, então o modelo inserido produz zero trecho e zero token.
   Medido nos três caminhos. **E os dois clones também**, cada um com o seu
   recorte: Stagent com o vocabulário de intercâmbio (curso, instituição,
   visto) e o limite migratório em `privacidade`; Conecta só com estrutura e
   marcadores, sem nicho nenhum, por decisão sua.
7. **Depois de tudo** (pedido em 2026-10-31): o **roteiro de preenchimento para
   o cliente** dos três apps, derivado do catálogo, contendo um **prompt de IA**
   que organiza material fora do padrão em `.md` separados e divididos entre
   PROMPT e RAG. É o que dá caminho a quem chega com conteúdo próprio em vez de
   oito blocos vazios.
