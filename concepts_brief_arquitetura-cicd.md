# Arquitetura definitiva de CI/CD — GitHub × Workers Builds

* **Autor:** André (venn360) · **Data:** 2026-11-01

Este brief virou documento versionado — o conteúdo completo (veredito, os dois
quadros, comparativo por eixo, segurança por ativo, o modelo, roteiros,
glossário e apêndices medidos) vive em:

**`infra/runbook/15-arquitetura-cicd-github-workers-builds.md`**

e a página de emergência em `infra/runbook/16-emergencia-deploy.md`.

Motivo de não morar aqui: o estudo cita os outros apps pelo nome em todo
parágrafo, e a raiz do repositório é varrida pela auditoria de isolamento;
`infra/runbook/` é o prefixo que ela ignora de propósito. Um só lugar, zero
deriva.

Decisões fechadas (01/11): GitHub = código/PR/verificação barata/gitleaks;
Workers Builds = único build/preview/deploy, portão no deploy command;
aprovação de produção = merge em `main`; GitHub Pro recusado (risco de push
direto documentado com dono); Workers de produção dos clones = `stagent` /
`conecta` (nomes limpos); zero compra de créditos de Actions — permanente.
