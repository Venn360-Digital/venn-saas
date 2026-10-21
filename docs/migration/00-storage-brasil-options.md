# 00 — Storage com residência no Brasil para arquivos clínicos

**Pesquisado em** 2026-10-21. **Nenhum recurso foi criado nem contratado.**
Este documento existe para que a escolha seja aprovada antes de qualquer conta.

---

## Por que o R2 não serve para esta classe

A Cloudflare documenta que a localização dos dados no R2 é determinada
automaticamente e que os *Location Hints* são **dica, não garantia**. Para
arquivo clínico identificável, "provavelmente está no Brasil" não é uma
afirmação que se possa fazer a uma clínica. Então o R2 fica para público e não
sensível, e esta classe precisa de outro destino.

Ver [`01-compatibility.md`](01-compatibility.md) §5 para a classificação por
tipo de arquivo.

## O que precisa caber

| Requisito | Por quê |
| --- | --- |
| Datacenter **no Brasil** | residência física, defensável para a clínica |
| Entidade contratante brasileira, ou região brasileira contratada | LGPD art. 33: sem residência, transferência internacional exige cláusula específica |
| API S3 | o adaptador já é S3; portabilidade sem reescrever |
| `put`, `get`, `delete`, `list`, multipart, URL assinada | são as operações que o código usa |
| Bucket privado por padrão | nenhum arquivo clínico acessível por URL |
| Criptografia em repouso | linha de base |
| Baixo esforço operacional | não há equipe de infraestrutura |
| Custo baixo | o volume hoje é 5,7 MB |

---

## Candidatos

### 1. Magalu Cloud — Object Storage (br-se1, São Paulo)

| Item | Valor |
| --- | --- |
| Regiões | **São Paulo `br-se1`**, Fortaleza `br-ne1` |
| Entidade | brasileira (grupo Magazine Luiza) |
| Armazenamento | **R$ 0,10 / GiB / mês** (classe Standard) |
| Saída (egress) | **R$ 0,10 / GiB** |
| Requisições | **grátis** — sem cobrança de PUT/GET/LIST/DELETE |
| Classe fria | R$ 0,06/GiB armazenado, R$ 0,20/GiB de saída |
| Moeda | R$, impostos inclusos — **sem risco de câmbio** |
| API S3 | multipart, URL assinada, versionamento e bucket policy suportados |
| Lacuna conhecida | **sem SSE-C / SSE-KMS** documentado; sem hospedagem de site estático |
| Nota de compatibilidade S3 (s3providers.com) | 36/100 |

### 2. AWS S3 — `sa-east-1` (São Paulo)

| Item | Valor |
| --- | --- |
| Região | São Paulo, residência física garantida pela escolha de região |
| Entidade | AWS, com subsidiária brasileira; DPA e cláusulas padrão |
| Armazenamento | ~US$ 0,025/GB/mês (`sa-east-1` é das regiões mais caras) |
| Saída | ~US$ 0,15/GB — **o mais caro da lista** |
| Requisições | cobradas por 1.000 |
| API S3 | **referência** — tudo funciona, por definição |
| Criptografia | SSE-S3, SSE-KMS, SSE-C |
| Risco | custo em dólar; egress caro se a mídia for muito lida |

### 3. Provedores brasileiros de datacenter Tier III

HostDime Brasil, EVEO, Datasafer, Audaks Cloud, DataBackup. Todos anunciam
object storage S3-compatível em datacenter Tier III no Brasil, com conformidade
LGPD, e vários com Object Lock para imutabilidade.

**Não avaliados a fundo**, e de propósito: nenhum publica preço e limite de
forma consultável como os dois primeiros, o que já é o sinal de que a
contratação é comercial e não autoatendimento. Isso contraria o requisito de
baixo esforço operacional. Ficam como alternativa se os dois primeiros caírem.

---

## Decisão recomendada: **Magalu Cloud `br-se1`**

Três razões, em ordem de peso:

1. **Residência sem asterisco.** Empresa brasileira, datacenter brasileiro,
   contrato em português e em real. Isso remove a pergunta do art. 33 em vez de
   responder a ela — e é a diferença entre dizer a uma clínica "está no Brasil"
   e dizer "está numa região brasileira de um provedor americano".
2. **Requisição grátis, e isso importa aqui.** A carga é mídia de conversa:
   muitos objetos pequenos, lidos com frequência. É exatamente o perfil que faz
   a cobrança por requisição doer, e é o único item em que a Magalu bate a AWS
   de forma estrutural, não marginal.
3. **Custo em real, sem câmbio.** Com 5,7 MB hoje, o custo é arredondamento. O
   que se está escolhendo é a curva, não a fatura do primeiro mês.

### A lacuna do SSE, e por que ela deixou de pesar

A Magalu não documenta SSE-C nem SSE-KMS. Isso seria sério se a cifra do
provedor fosse o único controle — e não é mais.

O cofre construído nesta migração (`src/lib/secrets/envelope.ts`) já faz
AES-256-GCM pelo WebCrypto com a chave em Cloudflare Secrets. **A mesma primitiva
serve ao arquivo clínico**: cifrar o conteúdo antes do `put`, com a chave fora do
provedor de storage. Isso é mais forte do que SSE-KMS, não mais fraco — na cifra
do provedor, quem administra o bucket administra também a chave; aqui a chave
está em outra empresa.

Efeito colateral honesto: conteúdo cifrado pela aplicação **não pode ser servido
por URL assinada direto ao navegador** — o navegador receberia bytes cifrados.
A mídia passa a ser servida por uma rota do Worker que decifra em trânsito. Para
objetos pequenos (foto, áudio de conversa) isso é aceitável; para arquivo grande
exigiria streaming com decifra incremental, que não é necessário hoje e fica
registrado como limite.

### O que fica pendente de aprovação

- criar a conta Magalu Cloud e o bucket (**custo contínuo** — exige o aval);
- confirmar na documentação oficial da Magalu as operações exatas do adaptador
  antes de escrever contra elas;
- decidir se a cifra pela aplicação entra no primeiro corte ou depois (ver
  [`02-runbook.md`](02-runbook.md)).

### Enquanto não houver aprovação

A cópia na VPS **permanece intacta e é a fonte** dos arquivos sensíveis. Nada de
clínico se move. O corte pode acontecer com o app em Workers lendo mídia do
destino antigo por um período de transição, e isso está no runbook — é o que
permite desacoplar esta decisão do cutover.

## Convenção de nomes dos buckets

A conta é **compartilhada entre os SaaS da Venn360**, então o isolamento tem de
estar na credencial e no nome, não só no prefixo da chave:

```
venn-<produto>-<classe>-<ambiente>
```

| Bucket | Provedor | Conteúdo |
| --- | --- | --- |
| `venn-odontobox360-publico-prod` | R2 | avatar de agente, prévia de voz, ativo de marca |
| `venn-odontobox360-publico-stg` | R2 | idem, homologação |
| `venn-odontobox360-clinico-prod` | Magalu `br-se1` | mídia de conversa, nota de voz, documento de paciente |
| `venn-odontobox360-clinico-stg` | Magalu `br-se1` | idem, com dado sintético **apenas** |

Nunca um bucket compartilhado entre produtos, e **nunca dado real de paciente em
bucket de homologação**.

---

## Fontes

- [Magalu Cloud — forma de cobrança](https://docs.magalu.cloud/docs/storage/object-storage/additional-explanations/price)
- [Magalu Cloud — visão geral do Object Storage](https://docs.magalu.cloud/docs/storage/object-storage/overview/)
- [s3providers.com — Magalu Object Storage](https://s3providers.com/providers/magalu-object-storage)
- [Cloudflare R2 — data location](https://developers.cloudflare.com/r2/reference/data-location/)
- [HostDime — object storages S3 no Brasil](https://www.hostdime.com.br/blog/4-melhores-object-storages-s3-no-brasil-2026)
- [Audaks — object storage S3-compatível no Brasil](https://audaks.com.br/blog/object-storage-brasil-s3-compativel-guia)
- [Datasafer — object storage](https://datasafer.com.br/object-storage/)
