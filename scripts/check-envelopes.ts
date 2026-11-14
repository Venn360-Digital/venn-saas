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

    console.log(falhas === 0 ? '\nTODOS OS TESTES PASSARAM' : `\n${falhas} FALHA(S)`)
    process.exit(falhas === 0 ? 0 : 1)
}

main()
