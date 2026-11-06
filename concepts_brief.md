# Modelos de treinamento a partir de documentos de clientes reais (passo 7)

* **Autor:** André (venn360), com revisão multi-lente EGM
* **Data:** 2026-10-30
* **Estado:** hipótese inicial **reprovada no mecanismo central**; posição revisada abaixo

## Visão geral

Hoje um cliente novo abre a tela de Treinamento e encontra oito campos vazios. O
objetivo é que ele comece de algo parecido com a realidade do setor dele, com uma
estrutura adequada ao treinamento da IA.

O material disponível são dois conjuntos de `.md` escritos com conteúdo de dois
clientes pagantes reais: uma clínica odontológica (Odontobox) e uma agência de
intercâmbio (Stagent). O Conecta não tem cliente nem segmento.

A hipótese inicial era: sanitizar esses dois conjuntos e publicá-los como
`MODELOS` oficiais dos dois apps, convertendo política comercial em "branco
marcado" dentro de comentário de HTML, com o Publicar cobrando as confirmações
pendentes.

## Análise

### O mecanismo central da hipótese não funciona, e isso foi medido

A ideia era substituir uma política por `<!-- confirmar: … -->`, confiando em
`semComentarios` para que ela nunca chegasse ao modelo. Medido no repositório:

| Entrada | Saída de `semComentarios` |
|---|---|
| `A avaliacao e <!-- confirmar: gratuita? -->` | `A avaliacao e ` |
| `1. Informe a taxa de <!-- confirmar: quanto -->` | `1. Informe a taxa de ` |
| `## Pergunta` + comentário como corpo inteiro | `## Pergunta` sem corpo, e a seção desaparece |

O comentário no **meio da frase** não produz ausência, produz **frase
truncada** — e a frase truncada entra no bloco estável do prompt, em toda
mensagem, sob precedência declarada. O modelo lê "A avaliação é" e completa.
Em `Passos:` é pior: a expressão que lê os passos aceita um passo que é só
comentário, então o catálogo promete um procedimento cujo corpo chega como
"3. Informe a taxa de" sob a instrução "execute, não leia para o paciente".
Lacuna em prosa o modelo contorna; ordem truncada ele completa, e completa com
preço e prazo.

O precedente do passo 5 **não transfere**, e agora se sabe por quê: lá o
comentário é o corpo inteiro da seção, e o corte descarta cabeçalho sem corpo.
A seção some de verdade. O que a hipótese propunha é o caso oposto.

Há ainda uma asserção de teste que proíbe a técnica diretamente:
`scripts/test-treinamento.ts` confere que o modelo **não contém** `<!--`.

### O "um texto, dois consumidores" era uma leitura errada do próprio plano

O estudo diz que os modelos servem ao treinador no produto **e** ao Claude no
desenvolvimento, e os descreve como texto **instrucional** — "exemplos bons e
maus, o que nunca entra". O botão "Inserir modelo" não é um desses dois.

E os dois gêneros querem coisas opostas. Gabarito quer cabeçalho fixo e espaço
vazio; prompt de redator quer instrução, proibição e rubrica, com o exemplar
citado e delimitado como forma. Os cabeçalhos naturais de um texto instrucional
reprovam a trava de igualdade de cabeçalhos.

### A trava de cabeçalhos força a seção mais perigosa

O teste exige **igualdade de conjunto** entre os `##` do modelo e as seções do
catálogo, e o catálogo inclui `Exemplos de resposta` como última seção dos oito.
Então todo modelo escrito é obrigado a carregar essa seção.

E `semExemplos` só roda na trilha de acervo. Nos cinco documentos de modo
`prompt`, o conteúdo da seção de exemplos **vai no prompt em toda mensagem** —
verificado: a frase de exemplo chega. É exatamente onde a política de um cliente
se esconde em prosa natural ("A primeira avaliação é sem custo").

Deixar a seção com o cabeçalho e **sem corpo** satisfaz o teste e é seguro. Só
não entrega exemplo nenhum — é perda de valor, não defeito.

### O portão que ia cobrar as confirmações não existe

A rota de publicação só recusa quando nada mudou. Nenhuma função no repositório
conta `<!-- confirmar`, não há diálogo de confirmação, e o botão dispara o POST
direto no clique. Entre "texto de outra clínica" e "o agente responde por ele"
há **um clique**. Isso era pré-requisito, não complemento.

### A forma do cliente é o ativo, e o lugar dela não é o texto

O argumento de manter a forma (quais seções cresceram, o que a objeção enfatiza)
sobrevive como valor, mas não como prosa embarcada: a trava de cabeçalhos empurra
a forma para `###` ou abaixo, que é a camada mais específica do cliente, e nenhum
verificador a enxerga.

O catálogo já tem os dois campos certos para capturar forma **como dado**:
`secoes` (nomes e ordem) e `explicacao` (ênfase, texto de tela que nunca é
indexado). Uma linha por documento, sem nenhuma prosa de cliente entrando no
produto nem no índice.

### Sanitização nível 1 não tem mecanismo

A auditoria de isolamento procura impressão digital dos **outros** apps, não
conteúdo de negócio de cliente. Nome de clínica, endereço, preço, nome de
profissional e telefone são invisíveis para ela. Um teste de regex (telefone,
CEP, CNPJ/CPF, `R$`, e-mail, URL) é possível e deve rodar no `prebuild`. Lista
negra com nome de cliente **não pode ir ao git**: isso é revisão humana, e tem de
ser dito como revisão humana.

### Amostra de um: o risco é de visibilidade, não de tamanho

Branco custa esforço e é visível. Errado-e-autoritativo chega assinado pelo
fornecedor, entra na precedência ou na base de conhecimento, e falha na frente do
paciente — e nenhum verificador pega "frase plausível de outra clínica".

Uma clínica não é o setor: mix de especialidade, convênio contra particular, uma
contra várias unidades. No Stagent, ou o modelo vem de cliente real **de
intercâmbio** ou fica só estrutura; traduzir vocabulário sobre documento odonto
deve ser proibido explicitamente, porque a forma do negócio está na forma do
documento.

### Os catálogos já divergiram no documento que se queria universal

`privacidade.secoes[0]` é `Limites clínicos` na Odontobox e `Limites de atuação`
nos dois clones. Com igualdade exata de cabeçalhos, **o mesmo texto reprova no
outro repositório**. E não há camada de vocabulário para contornar: a
configuração de app é `server-only` e a marca não tem campo de segmento, enquanto
o componente do documento é de cliente.

### Defeitos abertos hoje, independentes desta feature

1. **O catálogo de Cenários não passa por `semComentarios`.** Os documentos de
   `prompt` são limpos; o de Cenários chega cru e a leitura do `Quando:` captura
   a linha inteira. Um comentário ali entra no bloco estável e cacheado, em toda
   mensagem. Conserto: aplicar `semComentarios` antes de ler os cenários, com
   caso de teste.
2. **A publicação decide "vazio" por texto cru**, então documento reduzido a
   comentários não cai na limpeza do acervo. Duas lentes divergiram no desfecho
   (trechos velhos imortais contra perda do acervo do cliente) e isso precisa de
   um traço definitivo antes de publicar qualquer modelo sobre documento que já
   tem acervo.
3. `check:treinamento` filtra por modo `rag` enquanto a tela usa
   `!== 'prompt'` — divergem em Cenários, e é justamente a ferramenta que
   validaria a pasta de `.md` sanitizados.
4. `cenarios` tem precedência no catálogo e **nunca é dita ao modelo**: a lista
   escrita de precedência só inclui documentos de modo `prompt`. Um `Passos:`
   pré-escrito é hoje a instrução menos subordinada do conjunto.
5. Três comentários que justificam decisões citam comportamento que o código já
   não produz — e são o que o próximo autor vai ler antes de colar o `.md`.

### Reversibilidade é zero

`MODELOS` não é consultado em tempo de execução: o texto é copiado para o
documento do cliente e nada guarda procedência. Corrigir um modelo errado não
alcança ninguém já atendido, e não há como listar os afetados a não ser buscando
texto em produção.

### Exposição comercial e jurídica

Documento sanitizado de cliente pagante passa a ser código-fonte distribuído aos
concorrentes dele. A forma de uma política comercial (combinação de serviços,
garantia, condição de pagamento) pode ser identificável sem o nome.
**Autorização por escrito dos dois clientes, antes da primeira linha.**

## Posição revisada

Três mudanças em relação à hipótese inicial.

**O modelo contém estrutura e instrução, nunca afirmação de negócio.** Política
não vira branco marcado no meio da frase — ela simplesmente não entra. Onde a
política do cliente estava, fica o cabeçalho e nada embaixo, ou um exemplo
delimitado como forma.

**A forma do cliente é extraída como dado, não como prosa.** `secoes` e
`explicacao` do catálogo recebem a ordem, os nomes e a ênfase que os documentos
reais mostraram. Nenhuma frase de cliente entra no produto para isso.

**O empacotamento é por documento, com razão escrita por documento** — não "um
cliente, oito documentos".

| Documento | Decisão | Razão |
|---|---|---|
| `privacidade` | preenchido | maior precedência; os limites são universais |
| `instrucoes-centrais` | preenchido | identidade e tom; sem política comercial |
| `tecnicas-de-venda` | preenchido | padrões de objeção existem fora do nicho |
| `processo-comercial` | parcial | etapas sim, política não |
| `empresa`, `servicos`, `faq` | só estrutura | é onde o fato específico é máximo e **nenhuma verificação vê erro** — um `## Endereço` com o endereço de outro cliente é estruturalmente impecável |
| `cenarios` | bloqueado | até os defeitos 1 e 4 fecharem |

## Metas e não-metas

**No escopo**

* `MODELOS` em código, com `.md` legíveis gerando o arquivo e CI conferindo sincronia.
* Primeira fatia: `privacidade` na Odontobox. É a de maior precedência, força a divergência de catálogo já na primeira entrega, e **não toca** as asserções de teste amarradas a `servicos`.
* Três testes novos: teto por modelo, orçamento do prompt em faixa confortável, e regex de entidade vazada no `prebuild`.
* Os cinco consertos de defeito aberto listados acima.
* Rótulo honesto no botão: "Inserir modelo" quando há modelo escrito, "Inserir estrutura" quando é só esqueleto.

**Fora do escopo**

* Branco marcado no meio de frase, em qualquer documento. Reprovado por medição.
* Caixa de consentimento como mecanismo de segurança. Pode existir como peça jurídica.
* Traduzir vocabulário de um documento odonto para gerar o modelo de intercâmbio.
* Modelo preenchido para o Conecta nos seis documentos de negócio.
* `redator.ts` e a entrevista guiada: dependem do texto instrucional, que é outro artefato.

## Alternativas avaliadas

**Modelos em tabela de banco, editáveis sem deploy.** Recusada. O modelo também
alimenta o redator, e prompt que muda sem revisão é prompt que ninguém revisou. A
trava de cabeçalhos só funciona em código, não há tela para editar a tabela, e o
deploy hoje leva minutos.

**Branco marcado para política.** Recusada por medição: produz frase truncada no
prompt estável e ordem truncada em `Passos:`.

**Caixa de "estou ciente".** Recusada como mecanismo: é um clique que as pessoas
dão sem ler, transfere responsabilidade no papel e não muda comportamento.

**Exemplo preenchido somente leitura, lado a lado, nunca inserível.** Recusada
pelo André em 2026-10-31. Mataria todos os blockers de uma vez, porque nada entra
no documento do cliente — mas perde exatamente o que motiva o passo: o cliente
começar de algo quase pronto em vez de oito campos vazios. Fica registrada como
o recuo disponível se o risco de cópia por remoção (abaixo) se mostrar real.

**Esqueleto com exemplo real por seção dentro de comentário.** **Escolhida.**
Custo zero de token, um artefato só, e as duas razões pelas quais comentário no
modelo foi recusado antes já foram consertadas. Consequências em "Decisões
tomadas".

**Terminar o rascunho determinístico para os oito.** Impossível: quatro
documentos não têm origem nos campos antigos, e o código já diz que devolver
nulo é mais honesto que um modelo vazio disfarçado de conteúdo gerado.

**`MODELOS` como pasta importada pelo bundler.** Recusada no código por exigir
configuração em dois alvos. O meio-termo que resolve a legibilidade é gerar o
arquivo a partir dos `.md`.

**Distribuir os `.md` por importar/exportar, sem `MODELOS`.** O canal já existe
na tela e está pronto. Cobre onboarding assistido sem embarcar nada no produto.

## Decisões tomadas

### O exemplo mora num comentário por seção (2026-10-31)

O modelo é o esqueleto do catálogo, e sob cada `##` vai um exemplo real de
**forma**, inteiro dentro de um comentário de HTML. Nada afirmado em texto nu.

Isso é diferente do branco marcado reprovado: aqui o comentário é o **corpo
inteiro** da seção, que é o caso medido como seguro — o corte descarta cabeçalho
sem corpo e a seção desaparece do acervo e do prompt. O que foi reprovado era
comentário no meio de frase, que trunca.

**O que essa escolha simplifica.** O portão de confirmações pendentes deixa de
ser pré-requisito. Um modelo inserido e publicado sem edição nenhuma entrega
**estrutura e nada mais** — não entrega política de outro cliente. O pior caso
passa a ser um agente sem conteúdo, que é visível e corrigível, em vez de um
agente afirmando o preço de outra clínica.

**O que essa escolha cria, e é o risco novo: cópia por remoção.** O exemplo fica
no campo editável, e transformá-lo em conteúdo afirmado é apagar `<!--` e `-->`.
Dois gestos, mais fácil que digitar. Quem tem pressa vai fazer isso — e aí o
texto de outro negócio vira fonte de verdade do dele, exatamente o desfecho que
a escolha pretendia evitar.

Três mitigações, em ordem de força:

1. **Impressão digital no Publicar.** O modelo embarcado leva o conjunto de
   linhas do exemplo; a publicação avisa quando alguma delas aparece **fora de
   comentário** no documento. Usa o portão que o André queria, aparece no
   instante em que o texto iria ao paciente, nomeia a linha, e é uma comparação
   de texto — sem modelo, sem custo.
2. **O aviso mora dentro do comentário**, na primeira linha: "exemplo de forma,
   não de conteúdo — substitua pelos seus dados". Quem apaga os marcadores lê
   isso antes.
3. O exemplo é escolhido pela **forma** e não pelo apelo: estrutura de seção,
   granularidade, ordem. Número e política ficam fora dele desde a origem, então
   copiar rende pouco.

### As consequências técnicas que essa escolha torna obrigatórias

1. **O conserto do catálogo de Cenários passa a ser bloqueante**, não só
   recomendado: com comentário dentro dos modelos, um comentário num documento de
   Cenários entra no bloco estável e cacheado em toda mensagem.
2. **A asserção que proíbe `<!--` no modelo tem de ser relaxada** — e só depois
   do conserto 1, com a razão reescrita no lugar da atual, que cita um sintoma
   que o código não produz mais.
3. **O prefixo do marcador tem de ser discriminado** do `<!-- confirmar:` da
   mineração de lacunas, que cai no mesmo campo de rascunho. Proposta:
   `<!-- exemplo: … -->` para o modelo, deixando `confirmar:` só para a lacuna.
   Assim nenhum contador confunde os dois e a mineração segue valendo.

## Decisões em aberto

1. **Autorização escrita dos dois clientes**, anterior ao código e anterior à
   leitura dos arquivos.
2. **O traço definitivo do defeito 2**, antes de publicar modelo sobre documento
   que já tem acervo.

## Para a próxima etapa

Ordem, com o que bloqueia o quê:

1. **Autorização escrita dos dois clientes.** Bloqueia a leitura dos arquivos.
2. **Conserto do catálogo de Cenários** (`semComentarios` antes de ler os
   cenários, com caso de teste). Bloqueia qualquer modelo com comentário.
3. **Traço do defeito 2** e conserto da decisão de "vazio" na publicação.
   Bloqueia publicar modelo sobre documento que já tem acervo.
4. Os outros três consertos de comentário e filtro, que não bloqueiam ninguém.
5. **Impressão digital no Publicar** e o prefixo `<!-- exemplo:`. Bloqueiam o
   primeiro modelo embarcado.
6. **Primeira fatia: `privacidade` na Odontobox.** Pronta quando abre com o
   título do catálogo, tem exatamente as seções declaradas, nenhuma política
   afirmada em texto nu, `check:treinamento` verde, e os três testes novos no CI
   (teto por modelo, orçamento do prompt em faixa confortável, regex de entidade
   vazada no `prebuild`).

Os passos 2 a 4 são consertos de defeito que existem hoje e valem por si. Dá para
começar por eles sem ter os arquivos em mão e sem a autorização — é o trabalho
útil disponível enquanto a autorização não chega.

Os documentos do cliente **não devem ser lidos** antes da autorização: ler é o
que cria o risco de herdar a forma.
