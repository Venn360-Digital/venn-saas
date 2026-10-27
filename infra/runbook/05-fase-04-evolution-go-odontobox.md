# FASE 04 — Padronização no Evolution Go (Odontobox360) — CONDICIONAL

**Decisão do André:** todos os sistemas usarão **Evolution Go**. A Evolution API (Node) deve ser descartada onde ainda estiver em uso.
**Quando executar:** conforme a conclusão da Fase 01 ("Fase 04 necessária: SIM / LIMPEZA / NÃO").
**Onde executar:** repositório da Odontobox, branch `chore/dup-evolution-go`, e VPS via SSH.
**Modo:** Plan mode. Leia `infra/runbook/01-REGRAS-GLOBAIS.md` (atenção a R6 e R7).

---

## Caminho "NÃO"

A Odontobox já usa apenas Evolution Go e não há Evolution API na VPS. Registre isso no relatório e encerre.

## Caminho "LIMPEZA"

A Odontobox já usa Evolution Go, mas há containers da Evolution API ociosos.

1. Prove a ociosidade de cada container: sem referência no código ou nas vars dos Workers, sem tráfego nos logs dos últimos 7 dias e sem instâncias conectadas. Apresente as evidências.
2. Com "confirmo":
   - snapshot Vultr confirmado;
   - `docker compose stop` (NÃO `down -v`);
   - manter parado por 7 dias.
3. Após 7 dias sem impacto, e com novo "confirmo":
   - remover containers e volume;
   - dump final do banco da Evolution API guardado fora da VPS;
   - `DROP DATABASE` correspondente;
   - remover hostname do proxy e DNS.

## Caminho "SIM" (a Odontobox usa Evolution API v2 em produção)

Este caminho é um projeto de migração. Pontos de atenção:

- As sessões de WhatsApp **não são portáveis** entre Evolution API (baseada em Baileys) e Evolution Go (baseada em whatsmeow). Confirme na documentação da versão em uso. Se não forem portáveis, **cada clínica precisará ler o QR-Code novamente**: isso exige comunicação prévia aos clientes.
- O histórico de mensagens no banco da Evolution API não migra. Confirme que o app guarda no próprio banco o que precisa.

### Passos

1. **Mapeamento de API:** pela documentação/README da versão do Evolution Go que será fixada (tag ou digest), monte uma tabela que mapeie cada endpoint usado hoje (inventário A7) para o equivalente no Go. Faça o mesmo para cada evento de webhook: nome, payload e campos usados. Tudo sem equivalente vira item bloqueante a decidir com o André.
2. **Camada de abstração no código:** crie a interface `WhatsAppQrProvider` (criar instância, obter QR, status, enviar texto/mídia, desconectar, normalizar webhook) com duas implementações, `EvolutionApiProvider` (atual) e `EvolutionGoProvider`. A seleção é feita por tenant (coluna/config `whatsapp_qr_provider`, padrão `evolution_api`), para migrar clínica por clínica.
3. **Container Go de staging da Odontobox:** siga o mesmo procedimento da Fase 08, com nomes no padrão da Odontobox. Fixe a mesma tag/digest que os novos apps usarão.
4. **Testes em staging:** instância de teste com o celular do André; enviar e receber texto e mídia; status; reconexão; desconexão; webhook validado.
5. **Produção:** suba o container Go de produção em paralelo ao da Evolution API, sem tocar no existente. Faça deploy do código com o provider por tenant, ainda com padrão `evolution_api`.
6. **Migração gradual:**
   - clínica piloto (interna ou parceira);
   - depois lotes;
   - cada clínica relê o QR;
   - checklist pós-migração por clínica.
7. **Desativação da Evolution API:** depois de 100% dos tenants migrados e 7 dias estáveis, siga o "Caminho LIMPEZA".

### Dependência com a duplicação

A Fase 05 (clonagem) pode começar quando o código com `EvolutionGoProvider` estiver em `main`, mesmo com a migração dos tenants ainda em andamento. Nos novos apps:

- o provider padrão será `evolution_go`;
- o `EvolutionApiProvider` será REMOVIDO do código na Fase 05.

## Saídas

- PR(s) `chore/dup-evolution-go`.
- `infra/inventory/evolution-api-vs-go.md` (mapeamento).
- `infra/reports/odontobox/fase-04.md`: caminho executado, versão fixada do Evolution Go, status por clínica (sem dados pessoais) e cronograma de desativação.

## Critérios de saída

- [ ] Versão do Evolution Go fixada (tag + digest) e registrada no manifesto.
- [ ] `EvolutionGoProvider` em `main`, testado em staging.
- [ ] Nenhum container da Odontobox alterado sem "confirmo".
- [ ] **PARE e aguarde "OK fase 04".**
