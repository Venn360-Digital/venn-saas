# Este diretório está congelado

O trabalho de fila foi portado para **`src/trabalhos/`** em 2026-10-21, e é lá
que ele é mantido daqui em diante.

Este diretório continua existindo por um motivo só: **é o que roda na VPS
agora.** O runbook mantém a VPS intacta até depois do corte
(`docs/migration/02-runbook.md`), e desligar a origem antes do destino provar-se
é trocar um risco conhecido por um desconhecido.

## O que isso significa na prática

- **Correção de bug que a produção precisa hoje:** aplicar nos **dois** lugares,
  e dizer no commit que foram dois. São cópias, e vão divergir se alguém
  esquecer.
- **Função nova:** só em `src/trabalhos/`. Não vale engordar o que vai ser
  apagado.
- **Depois do corte:** este diretório sai inteiro, junto com `bullmq`, `ioredis`
  e o serviço do worker no compose.

## O que mudou no porte, e não foi a lógica

Os processadores e serviços são o mesmo código. O que trocou foram quatro
costuras, e cada troca tem uma razão que o destino impôs:

| Antes (`workers/src/`) | Agora (`src/trabalhos/`) | Por quê |
| --- | --- | --- |
| `logger.ts` | `registro.ts` | lê o nível na primeira emissão, não na carga do módulo |
| `env.ts` (26 chaves, `process.exit`) | `ambiente.ts` (9 chaves, lança) | `process.exit` num Worker deixa `env` undefined e leva o site |
| `getQueue(F).add(...)` | `enfileirar(F, ...)` | o Queues não tem painel, nem `jobId`, nem reagendamento |
| `lock.ts` (Redis `SET NX PX`) | `trava.ts` + `TravaDeContato` | não há Redis; um Durable Object atende um pedido por vez |

E duas coisas que o BullMQ dava e tiveram de mudar de lugar:

- **deduplicação por `jobId`** → tabela, aplicada no consumo
  (`lib/queue/idempotencia.ts`). O caso que importa é `whatsapp-outbound`: sem
  isso, um enfileiramento repetido manda a mesma mensagem **duas vezes** ao
  paciente.
- **debounce por `changeDelay`** → Durable Object por conversa
  (`AgendaDaConversa`). E ganhou um teto que a versão do BullMQ não tinha: com
  mensagens a cada 3 s e espera de 4 s, a resposta era empurrada para sempre.
