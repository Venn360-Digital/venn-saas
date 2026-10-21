# 09 — Reaproveitamento no portfólio Venn360

O OdontoBox360 é o **piloto**. O desenho deve servir aos outros SaaS de nicho
semelhante (médico, jurídico, intercâmbio/educação), **sem migrar nenhum deles
neste ciclo**.

## O que o inventário mostra sobre compartilhamento

Hoje é **zero**. Os outros dois Workers na conta Cloudflare
(`janainaleiteadv`, `advogadamohs`) são sites Astro — páginas, não aplicações com
a mesma espinha. Não há código compartilhado para extrair, porque não há segundo
inquilino.

Por isso a recomendação de **um repositório por produto**: monorepo resolve
duplicação existente, e criá-lo antes do segundo inquilino é pagar a
complexidade adiantado por um benefício hipotético.

## Candidatos a pacote, quando o segundo produto chegar

Em ordem de maturidade — os dois primeiros já estão prontos e provados:

| Peça | Estado | Por que é reaproveitável |
| --- | --- | --- |
| **Cofre** (`src/lib/secrets`) | ✅ implementado e testado | nada de específico de odontologia; qualquer SaaS com integração OAuth precisa do mesmo |
| **Adaptador de storage** com classificação | a construir | a regra "público no R2, sensível no Brasil" vale para documento jurídico igual |
| **Camada de integrações** | a construir | Google, Meta e Asaas aparecem nos três nichos |
| Autorização por workspace e papel | existe, acoplado ao schema | o padrão viaja; o schema não |
| Tempo real (outbox → Queue → DO) | a construir | o padrão viaja inteiro |
| Adaptador de IA por tarefa | a construir | idem |

Extrair **quando o segundo produto precisar**, não antes. E extrair como pacote
com API declarada, não copiando arquivo.

## O que **nunca** se compartilha

| Isolado por produto | Por quê |
| --- | --- |
| Worker | superfície de deploy e de falha |
| Banco Neon | dado clínico, jurídico e de educação não se misturam |
| Secrets | comprometer um não pode comprometer os outros |
| Domínio | — |
| Buckets | isolamento tem de estar na credencial: `venn-<produto>-<classe>-<amb>` |
| Filas e Durable Objects | fronteira de isolamento de dados |
| Sessões de WhatsApp | **credencial de cliente nunca se mistura** |

## Residência de dados nos outros nichos — **em aberto**

Documento confidencial de SaaS jurídico precisa residir fisicamente no Brasil,
por política? Não está decidido, e não se deve decidir por analogia: o escopo
regulatório de prontuário odontológico não é automaticamente o de processo
judicial.

**Até decidir:** o R2 recebe **somente** arquivo claramente público. Qualquer
arquivo duvidoso fica bloqueado para upload até ser classificado.

## Critérios para replicar

Antes de levar este desenho a um segundo produto:

- [ ] OdontoBox360 em produção na Cloudflare por **≥ 30 dias** sem incidente
- [ ] POC do Evolution Go resolvida, com topologia decidida
- [ ] provedor de storage brasileiro aprovado e em uso
- [ ] custo real medido por um ciclo de cobrança inteiro
- [ ] runbook executado uma vez de verdade, e corrigido com o que se aprendeu
