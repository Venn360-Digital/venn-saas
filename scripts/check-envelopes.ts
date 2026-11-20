/**
 * Prova da tradução de envelope para o evento canônico.
 *
 * Os tradutores em `src/lib/whatsapp/envelopes.ts` são a borda onde cada
 * provedor vira o evento único da casa — e eram, até 2026-10-22, a única parte
 * de risco do WhatsApp sem prova de CI. Entraram aqui quando o `meta-whatsapp`
 * (Cloud API direto) substituiu o Evolution v2: tradução é lógica pura, roda
 * sem banco, e um erro aqui some em silêncio (mensagem do paciente que não vira
 * conversa, sem exceção e sem log).
 *
 * Puro de propósito: nenhuma IO, conferido contra corpos gravados da forma que
 * a Meta documenta.
 */
// PRIMEIRO de todos: registra uma marca fictícia, porque este script roda
// código do core e o core PEDE a marca. Ver `./lib/marca-de-teste.ts`.
import './lib/marca-de-teste.ts'

import { readEvolutionGoEvent, readWhatsAppCloudEvent } from '@venn/core/lib/whatsapp/envelopes'
import { LIMITE_DO_JOB_BYTES, semBase64, tamanhoDoJob } from '@venn/core/lib/queue/tamanho'
import { segredoDoWebhookValido } from '@venn/core/lib/whatsapp/webhook-evolution-go'
import { decodeMessage } from '@venn/core/lib/whatsapp/payload'
import type { NormalizedAck, NormalizedInbound } from '@venn/core/lib/whatsapp/envelopes'

let falhas = 0
const ok = (nome: string, cond: boolean, extra = '') => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${nome}${extra ? '  — ' + extra : ''}`)
    if (!cond) falhas++
}

function main() {
    // ---------------------------------------------------------------- texto
    const texto = {
        object: 'whatsapp_business_account',
        entry: [
            {
                id: 'WABA1',
                changes: [
                    {
                        field: 'messages',
                        value: {
                            metadata: { phone_number_id: 'PN123' },
                            contacts: [{ wa_id: '5531988501161', profile: { name: 'Maria' } }],
                            messages: [
                                {
                                    from: '5531988501161',
                                    id: 'wamid.A',
                                    type: 'text',
                                    text: { body: 'Olá, quero marcar' },
                                },
                            ],
                        },
                    },
                ],
            },
        ],
    }
    const e1 = readWhatsAppCloudEvent(texto)
    ok('texto: um evento', e1.length === 1)
    const inb = e1[0] as NormalizedInbound
    ok('texto: roteia por phone_number_id', inb.instance.phoneNumberId === 'PN123')
    ok('texto: provider meta-whatsapp', inb.provider === 'meta-whatsapp')
    ok('texto: chatJid é o número cru', inb.chatJid === '5531988501161')
    ok('texto: pushName casado por wa_id', inb.pushName === 'Maria')
    ok('texto: externalId', inb.externalId === 'wamid.A')
    ok('texto: decodeMessage lê o corpo', decodeMessage(inb.message, {}).content === 'Olá, quero marcar')

    // --------------------------------------------------------------- imagem
    // Mídia do Cloud API vem SEM url, só com id — a busca de bytes é a 2ª etapa.
    const img = {
        object: 'whatsapp_business_account',
        entry: [
            {
                id: 'W',
                changes: [
                    {
                        value: {
                            metadata: { phone_number_id: 'PN123' },
                            messages: [
                                {
                                    from: '553188',
                                    id: 'wamid.B',
                                    type: 'image',
                                    image: { id: 'MID9', mime_type: 'image/jpeg', caption: 'raio-x' },
                                },
                            ],
                        },
                    },
                ],
            },
        ],
    }
    const i2 = readWhatsAppCloudEvent(img)[0] as NormalizedInbound
    const dec = decodeMessage(i2.message, {})
    ok('imagem: caption vira conteúdo', dec.content === 'raio-x')
    ok('imagem: contentType image', dec.contentType === 'image')
    ok('imagem: sem mediaUrl (Cloud API só dá id)', dec.mediaUrl === null)
    ok('imagem: downloadPayload tem mediaId', i2.downloadPayload?.mediaId === 'MID9')
    ok('imagem: downloadPayload tem mimetype', i2.downloadPayload?.mimetype === 'image/jpeg')

    // --------------------------------------------------------------- recibo
    const st = {
        object: 'whatsapp_business_account',
        entry: [
            {
                id: 'W',
                changes: [
                    {
                        value: {
                            metadata: { phone_number_id: 'PN123' },
                            statuses: [{ id: 'wamid.A', status: 'read', recipient_id: '553188' }],
                        },
                    },
                ],
            },
        ],
    }
    const ack = readWhatsAppCloudEvent(st)[0] as NormalizedAck
    ok('recibo: kind message.ack', ack.kind === 'message.ack')
    ok('recibo: status read', ack.status === 'read')
    ok('recibo: cobre o externalId', ack.messageIds[0] === 'wamid.A')

    // --------------------------------------------- casos que não enfileiram
    const failed = {
        entry: [
            {
                id: 'W',
                changes: [
                    {
                        value: {
                            metadata: { phone_number_id: 'PN123' },
                            statuses: [{ id: 'wamid.X', status: 'failed' }],
                        },
                    },
                ],
            },
        ],
    }
    ok('failed: não vira ack', readWhatsAppCloudEvent(failed).length === 0)

    // Sem o número não há como achar o workspace: descartar é melhor que
    // enfileirar algo que nunca casa.
    const semPn = {
        entry: [
            {
                id: 'W',
                changes: [
                    { value: { messages: [{ from: '1', id: 'm', type: 'text', text: { body: 'x' } }] } },
                ],
            },
        ],
    }
    ok('sem phone_number_id: nada enfileirado', readWhatsAppCloudEvent(semPn).length === 0)

    // --------------------------------------------------------------- reação
    const reac = {
        entry: [
            {
                id: 'W',
                changes: [
                    {
                        value: {
                            metadata: { phone_number_id: 'PN123' },
                            messages: [
                                {
                                    from: '553188',
                                    id: 'wamid.C',
                                    type: 'reaction',
                                    reaction: { message_id: 'wamid.A', emoji: '👍' },
                                },
                            ],
                        },
                    },
                ],
            },
        ],
    }
    const r6 = readWhatsAppCloudEvent(reac)[0] as NormalizedInbound
    ok('reação: contentType reaction', decodeMessage(r6.message, {}).contentType === 'reaction')

    // -------------------------------------------------- lixo não pode estourar
    // Webhook que estoura é webhook que a Meta reenvia por sete dias.
    ok('corpo vazio: lista vazia', readWhatsAppCloudEvent({}).length === 0)
    ok('nulo: lista vazia', readWhatsAppCloudEvent(null).length === 0)
    ok('sem entry: lista vazia', readWhatsAppCloudEvent({ object: 'x' }).length === 0)

    // ------------------------------------------ foto grande cabe na fila
    // Medido em 2026-10-23: foto de 776 KB em base64 estourava os 128 KB do
    // Cloudflare Queues, o webhook respondia 500 e a imagem sumia. O corte
    // tem de alcançar as TRÊS cópias do base64 (mediaBase64, message.*.base64
    // e downloadPayload.Message) — apagar só a primeira não encolhe nada.
    const base64Grande = 'A'.repeat(776_000)
    const foto = readEvolutionGoEvent({
        event: 'Message',
        instanceId: 'inst',
        data: {
            Info: { ID: 'F1', Chat: '5531999999999@s.whatsapp.net', IsFromMe: false, PushName: 'Paciente' },
            Message: {
                imageMessage: { mimetype: 'image/jpeg', url: 'https://mmg.whatsapp.net/x', mediaKey: 'k', base64: base64Grande },
            },
        },
    }) as NormalizedInbound
    const jobCheio = { provider: 'evolution-go', inbound: foto, receivedAt: 'agora' }
    ok('foto grande: o job cheio NÃO cabe', tamanhoDoJob(jobCheio) > LIMITE_DO_JOB_BYTES, `${tamanhoDoJob(jobCheio)} bytes`)
    const jobCortado = { ...jobCheio, inbound: semBase64(foto) }
    ok('foto grande: sem base64 cabe', tamanhoDoJob(jobCortado) < LIMITE_DO_JOB_BYTES, `${tamanhoDoJob(jobCortado)} bytes`)
    ok('foto grande: o corte alcança as três cópias', !JSON.stringify(jobCortado).includes(base64Grande.slice(0, 64)))
    ok('foto grande: as chaves de download ficam', JSON.stringify(jobCortado.inbound.downloadPayload).includes('mediaKey'))
    ok('foto grande: mimetype sobrevive', jobCortado.inbound.mediaMimetype === 'image/jpeg')
    ok('foto grande: o original não é mutado', foto.mediaBase64 === base64Grande)

    // ------------------------------------------- segredo do webhook do VPS
    // O Evolution Go no VPS posta num caminho com segredo; a porta confere em
    // tempo constante. Sem isso, qualquer POST forjaria mensagem de paciente.
    ok('webhook: segredo certo passa', segredoDoWebhookValido('s3gr3do-abc', 's3gr3do-abc'))
    ok('webhook: segredo errado falha', !segredoDoWebhookValido('errado', 's3gr3do-abc'))
    ok('webhook: comprimento diferente falha', !segredoDoWebhookValido('abc', 's3gr3do-abc'))
    ok('webhook: esperado vazio nunca passa', !segredoDoWebhookValido('', ''))
    ok('webhook: esperado indefinido nunca passa', !segredoDoWebhookValido('qualquer', undefined))

    // ------------------------------------------------- LID não é telefone
    //
    // O defeito que estas provas prendem, medido na base da Implante Já em
    // 19/11/2026: catorze fichas com um LID gravado em `phone` (14 ou 15
    // dígitos) e DEZOITO mensagens de saída para elas, todas `failed`. O envio
    // monta `<numero>@s.whatsapp.net`, e um LID ali não é conta de ninguém —
    // então eram leads de anúncio recebidos e nunca respondidos.
    const comLid = (info: Record<string, unknown>) =>
        readEvolutionGoEvent({
            event: 'Message',
            instanceId: 'i1',
            data: { Info: info, Message: { conversation: 'Quero informação' } },
        }) as NormalizedInbound

    // O caso bom: o whatsmeow manda o par, e o telefone ganha.
    const par = comLid({
        ID: 'L1',
        Chat: '109315692208342@lid',
        Sender: '109315692208342@lid',
        SenderAlt: '5531988702912@s.whatsapp.net',
        PushName: 'Marcia',
    })
    ok('lid com par: o chatJid é o TELEFONE', par.chatJid === '5531988702912@s.whatsapp.net', par.chatJid)
    ok('lid com par: o lid vai junto, para casar a ficha', par.lid === '109315692208342', par.lid ?? '—')

    // O nome do campo alternativo mudou entre versões do whatsmeow; o que vale
    // é a FORMA do valor. Esta prova é o que impede alguém de voltar a ler um
    // nome fixo e descobrir em produção que aquela versão usa outro.
    const outroNome = comLid({
        ID: 'L2',
        Chat: '169410773970980@lid',
        RecipientAlt: '553191420149@s.whatsapp.net',
    })
    ok(
        'lid com par sob OUTRO nome de campo: ainda acha o telefone',
        outroNome.chatJid === '553191420149@s.whatsapp.net',
        outroNome.chatJid
    )

    // O caso ruim: não veio telefone. O LID continua sendo a identidade do fio,
    // mas quem resolve o contato tem de saber que ali NÃO há telefone.
    const semPar = comLid({ ID: 'L3', Chat: '255318776897696@lid', Sender: '255318776897696@lid' })
    ok('lid sem par: o chatJid continua o LID', semPar.chatJid === '255318776897696@lid', semPar.chatJid)
    ok('lid sem par: e o lid está marcado', semPar.lid === '255318776897696')

    // O caminho comum não muda em nada.
    const normal = comLid({ ID: 'L4', Chat: '5531988501161@s.whatsapp.net', PushName: 'Maria' })
    ok('telefone comum: intocado', normal.chatJid === '5531988501161@s.whatsapp.net')
    ok('telefone comum: sem lid', normal.lid === undefined)

    // Grupo fica de fora: lá o `Chat` é `@g.us` e não há "o telefone" do fio.
    const grupo = readEvolutionGoEvent({
        event: 'Message',
        instanceId: 'i1',
        data: {
            Info: { ID: 'G1', Chat: '123@g.us', IsGroup: true, Sender: '5531988501161@s.whatsapp.net' },
            Message: { conversation: 'oi' },
        },
    }) as NormalizedInbound
    ok('grupo: não vira caso de lid', grupo.lid === undefined && grupo.chatJid === '123@g.us')

    // ------------------------------------------------- mensagem apagada
    //
    // Apagar no WhatsApp chega como mensagem — um `protocolMessage` de tipo
    // REVOKE. `decodeMessage` não o conhecia, caía no "[Tipo de mensagem não
    // suportado]" e o sistema GRAVAVA um balão de erro novo ao lado da
    // original, que seguia visível. Foi assim que a clínica reportou.
    const apagou = readEvolutionGoEvent({
        event: 'Message',
        instanceId: 'i1',
        data: {
            Info: { ID: 'R1', Chat: '5531988501161@s.whatsapp.net' },
            Message: { protocolMessage: { key: { ID: 'ORIGINAL-1' }, type: 'REVOKE' } },
        },
    })
    ok('apagada: não é mensagem nova', apagou.kind === 'message.revoked', apagou.kind)
    ok(
        'apagada: aponta a original',
        apagou.kind === 'message.revoked' && apagou.targetExternalId === 'ORIGINAL-1'
    )

    // Os outros `protocolMessage` NÃO são apagamento e não devem marcar nada.
    const outroProtocolo = readEvolutionGoEvent({
        event: 'Message',
        instanceId: 'i1',
        data: {
            Info: { ID: 'R2', Chat: '5531988501161@s.whatsapp.net' },
            Message: { protocolMessage: { key: { ID: 'X' }, type: 'EPHEMERAL_SETTING' } },
        },
    })
    ok('protocolo que não é apagamento: não vira revogação', outroProtocolo.kind !== 'message.revoked')

    // ------------------------------------------------- invólucros
    //
    // Temporária, ver-uma-vez e documento-com-legenda guardam a mensagem um
    // nível abaixo. Sem desembrulhar, cada uma delas aparecia para a atendente
    // como "[Tipo de mensagem não suportado]" — erro onde havia uma foto.
    const NAO_SUPORTADO = '[Tipo de mensagem não suportado]'
    ok(
        'ver-uma-vez: a imagem é reconhecida',
        decodeMessage({ viewOnceMessageV2: { message: { imageMessage: { caption: 'meu dente' } } } }, {})
            .contentType === 'image'
    )
    ok(
        'temporária: o texto é reconhecido',
        decodeMessage({ ephemeralMessage: { message: { conversation: 'oi' } } }, {}).content === 'oi'
    )
    ok(
        'temporária com ver-uma-vez dentro: desembrulha os dois',
        decodeMessage(
            { ephemeralMessage: { message: { viewOnceMessage: { message: { audioMessage: {} } } } } },
            {}
        ).contentType === 'audio'
    )
    ok(
        'editada: mostra o texto novo',
        decodeMessage({ editedMessage: { message: { conversation: 'corrigido' } } }, {}).content ===
            'corrigido'
    )
    ok(
        'tipo de verdade desconhecido: continua avisando',
        decodeMessage({ algoQueNaoExiste: {} }, {}).content === NAO_SUPORTADO
    )
    ok(
        'tipo desconhecido: a chave vai para o log',
        decodeMessage({ algoQueNaoExiste: {} }, {}).tipoDesconhecido === 'algoQueNaoExiste'
    )

    // ------------------------------------------------- os tipos que caíam no "não suportado"
    //
    // Levantados em 20/11/2026 a partir do que a atendente via no fio do
    // CONECTA: figurinha sem imagem, nota de vídeo, enquete, resposta de botão,
    // vários contatos, localização ao vivo, convite de grupo, pedido, produto,
    // evento — e mensagens que são só protocolo (fixar, guardar, voto cifrado),
    // que viravam balão de erro sem haver mensagem nenhuma.
    ok(
        'figurinha: imagem COM mídia, para a bolha desenhá-la',
        (() => {
            const d = decodeMessage({ stickerMessage: { url: 'https://x/sticker.webp' } }, {})
            return d.contentType === 'image' && d.mediaUrl === 'https://x/sticker.webp' && d.content === '🏷️ Sticker'
        })()
    )
    ok(
        'nota de vídeo (ptv): é vídeo',
        decodeMessage({ ptvMessage: { url: 'https://x/v.mp4' } }, {}).contentType === 'video'
    )
    ok(
        'enquete: pergunta e opções',
        decodeMessage(
            { pollCreationMessageV3: { name: 'Qual horário?', options: [{ optionName: 'Manhã' }, { optionName: 'Tarde' }] } },
            {}
        ).content === '📊 Enquete: Qual horário?\n• Manhã\n• Tarde'
    )
    ok(
        'voto de enquete (cifrado): descartado como reação',
        decodeMessage({ pollUpdateMessage: { vote: {} }, messageContextInfo: {} }, {}).contentType === 'reaction'
    )
    ok(
        'resposta de botão: o texto do botão é a fala',
        decodeMessage({ buttonsResponseMessage: { selectedDisplayText: 'Quero agendar' } }, {}).content === 'Quero agendar'
    )
    ok(
        'resposta de lista: o título da linha',
        decodeMessage({ listResponseMessage: { title: 'Implante' } }, {}).content === 'Implante'
    )
    ok(
        'fluxo interativo: o texto do corpo',
        decodeMessage({ interactiveResponseMessage: { body: { text: 'Sim, confirmo' } } }, {}).content === 'Sim, confirmo'
    )
    ok(
        'vários contatos: um por linha, com telefone do vCard',
        decodeMessage(
            {
                contactsArrayMessage: {
                    contacts: [
                        { displayName: 'Ana', vcard: 'BEGIN:VCARD\nTEL;type=CELL:+55 31 98850-1161\nEND:VCARD' },
                        { displayName: 'Bia' },
                    ],
                },
            },
            {}
        ).content === '👤 Contatos:\n• Ana · +5531988501161\n• Bia'
    )
    ok(
        'contato único: nome e telefone',
        decodeMessage(
            { contactMessage: { displayName: 'Ana', vcard: 'TEL;waid=5531988501161:+55 31 98850-1161' } },
            {}
        ).content === '👤 Contato: Ana · +5531988501161'
    )
    ok(
        'localização ao vivo: reconhecida',
        decodeMessage({ liveLocationMessage: { degreesLatitude: -19.9, degreesLongitude: -43.9 } }, {}).content.startsWith(
            '📍 Localização em tempo real:'
        )
    )
    ok(
        'localização com nome: o nome vem antes das coordenadas',
        decodeMessage(
            { locationMessage: { degreesLatitude: -19.9, degreesLongitude: -43.9, name: 'Clínica', address: 'Rua A' } },
            {}
        ).content === '📍 Localização: Clínica — Rua A · -19.9, -43.9'
    )
    ok(
        'convite de grupo: o nome do grupo',
        decodeMessage({ groupInviteMessage: { groupName: 'Família' } }, {}).content === '🔗 Convite para o grupo "Família"'
    )
    ok(
        'pedido do catálogo: contagem de itens',
        decodeMessage({ orderMessage: { itemCount: 2, orderTitle: 'Kit' } }, {}).content === '🛒 Pedido (2 item(ns)) — Kit'
    )
    ok(
        'produto do catálogo: o título',
        decodeMessage({ productMessage: { product: { title: 'Clareamento' } } }, {}).content === '🛍️ Produto: Clareamento'
    )
    ok(
        'evento: o nome',
        decodeMessage({ eventMessage: { name: 'Mutirão' } }, {}).content.startsWith('📅 Evento: Mutirão')
    )
    ok(
        'só protocolo (fixar mensagem): nada a gravar',
        decodeMessage({ pinInChatMessage: { key: {} }, messageContextInfo: {} }, {}).contentType === 'reaction'
    )
    ok(
        'protocolo que não é apagamento, sozinho: nada a gravar',
        decodeMessage({ protocolMessage: { type: 'EPHEMERAL_SETTING' } }, {}).contentType === 'reaction'
    )
    ok(
        'texto com messageContextInfo ao lado: continua texto',
        decodeMessage({ conversation: 'oi', messageContextInfo: {} }, {}).content === 'oi'
    )

    console.log(falhas === 0 ? '\nTODOS OS TESTES PASSARAM' : `\n${falhas} FALHA(S)`)
    process.exit(falhas === 0 ? 0 : 1)
}

main()
