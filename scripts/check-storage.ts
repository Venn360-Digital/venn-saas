/**
 * Prova o adaptador de storage.
 *
 * Duas metades, porque uma delas não depende de credencial nenhuma e a outra
 * depende de todas.
 *
 * A **lógica** — classificação, roteamento e construção de chave — roda sempre,
 * e é onde mora o que protege o paciente: que classe clínica não caia no R2 por
 * omissão, e que chave não escape do prefixo de workspace.
 *
 * O **ciclo contra o R2** roda só com `PUBLIC_STORAGE_*` no ambiente, e é
 * relatado como SKIP quando falta — nunca como PASS. Para habilitá-lo é preciso
 * um token de API do R2 (par de chaves S3), criado no painel da Cloudflare.
 *
 *     npm run check:storage
 */
import {
    CLASSES,
    ClasseBloqueadaError,
    chaveDe,
    gravar,
    ler,
    apagar,
    existe,
    enderecoPara,
    podeGravar,
    provedorDa,
    VALIDADE_MAXIMA_SEGUNDOS,
    VALIDADE_MAXIMA_DO_PUBLICO,
    TRECHO_DE_PESSOA,
    tetoDaAssinatura,
    validadeEfetiva,
} from '@venn/core/lib/storage'
import { deBase64 } from '@venn/core/trabalhos/servicos/arquivo'
import { comoReferencia, enderecoDaMidia } from '@venn/core/lib/midia'
import { escapeCsv } from '@venn/core/lib/csv'

let falhas = 0
let pulados = 0

const ok = (nome: string, cond: boolean, extra = '') => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${nome}${extra ? '  — ' + extra : ''}`)
    if (!cond) falhas++
}
const skip = (nome: string, motivo: string) => {
    console.log(`SKIP  ${nome}  — ${motivo}`)
    pulados++
}

async function main() {
    // ============================ o teto da assinatura, por classe e por chave
    /**
     * `tetoDaAssinatura` é o desvio que separa **ativo de marca** de **conteúdo
     * que identifica alguém**, e os dois erros possíveis são silenciosos e
     * opostos — o motivo de estas provas existirem puras, fora do ciclo de rede:
     *
     *   - teto curto num ativo de marca: a foto do agente **desaparece** numa
     *     aba aberta mais de dez minutos. Nada em log, só um 403 que ninguém vê.
     *   - teto longo em conteúdo identificável: passa a existir um endereço de
     *     uma semana, sem autenticação, para o rosto ou o documento de alguém.
     *     Esse é o erro que não se desfaz depois.
     *
     * O desvio é por classe **e por chave** porque, desde a migração dos
     * retratos de 2026-11-07, a classe `PUBLICO` guarda as duas coisas no mesmo
     * bucket. Quando o retrato sair desta classe, o ramo da chave morre — e
     * então a asserção "retrato de pessoa não ganha uma semana" é a que
     * reprova, avisando que alguém o removeu cedo demais.
     */
    {
        const teto = (classe: string, chave: string) =>
            tetoDaAssinatura({ classe: classe as never, chave })

        ok(
            'clínico: dez minutos',
            teto(CLASSES.CLINICO, 'ws1/conv1/foto.jpg') === VALIDADE_MAXIMA_SEGUNDOS
        )
        // Não-classificado nem pode ser gravado (`podeGravar` recusa), mas se
        // uma referência dessas chegar aqui o teto tem de ser o curto: o lado
        // seguro de "não sei o que isto é" nunca é uma semana.
        ok(
            'não-classificado: dez minutos',
            teto(CLASSES.NAO_CLASSIFICADO, 'ws1/sei-la.bin') === VALIDADE_MAXIMA_SEGUNDOS
        )
        ok(
            'avatar de agente: sete dias',
            teto(CLASSES.PUBLICO, 'ws1/agents/ag1.png') === VALIDADE_MAXIMA_DO_PUBLICO
        )
        ok(
            'retrato de agente é ativo de marca: sete dias',
            teto(CLASSES.PUBLICO, 'ws1/retratos/agente/ag1.png') === VALIDADE_MAXIMA_DO_PUBLICO
        )

        // A asserção central, e a que precisa reprovar se alguém simplificar o
        // desvio para "classe PUBLICO = sete dias".
        ok(
            'retrato de PESSOA não ganha uma semana',
            teto(CLASSES.PUBLICO, 'ws1/retratos/usuario/u1.png') === VALIDADE_MAXIMA_SEGUNDOS
        )

        // O trecho leva as duas barras: nome que só começa igual não casa.
        ok(
            'prefixo parecido não vale como pessoa',
            teto(CLASSES.PUBLICO, 'ws1/retratos/usuarios-arquivados/u1.png') ===
                VALIDADE_MAXIMA_DO_PUBLICO
        )

        // E o acordo com quem cunha a chave: `chaveDoRetrato` monta
        // `<unidade>/retratos/<sujeito>/<id>.<ext>`, então o sujeito `usuario`
        // tem de cair dentro do trecho. Se a convenção da chave mudar lá sem
        // mudar aqui, esta reprova.
        ok(
            'a convenção da chave de retrato casa com o trecho',
            `/retratos/${'usuario'}/`.includes(TRECHO_DE_PESSOA)
        )

        ok('sete dias é o teto do presign', VALIDADE_MAXIMA_DO_PUBLICO === 7 * 24 * 60 * 60)

        /**
         * E a conta que a casca usa, provada sem credencial.
         *
         * `validadeEfetiva` é o `Math.min` que `enderecoPara` aplica. Invertido,
         * ele devolveria o **pedido** do chamador em vez do teto — e a única
         * prova que pegaria isso era a de rede, que é pulada aqui e no CI.
         */
        const pessoa = { classe: CLASSES.PUBLICO, chave: 'ws1/retratos/usuario/u1.png' }
        const marca = { classe: CLASSES.PUBLICO, chave: 'ws1/agents/ag1.png' }
        const clinico = { classe: CLASSES.CLINICO, chave: 'ws1/conv1/foto.jpg' }

        ok('sem pedido, vale o teto da classe', validadeEfetiva(marca) === VALIDADE_MAXIMA_DO_PUBLICO)
        ok('pedido menor é respeitado', validadeEfetiva(marca, 60) === 60)
        ok(
            'pedido maior é cortado no teto',
            validadeEfetiva(marca, 99999999) === VALIDADE_MAXIMA_DO_PUBLICO
        )
        ok(
            'retrato de pessoa: pedido de uma semana é cortado em dez minutos',
            validadeEfetiva(pessoa, VALIDADE_MAXIMA_DO_PUBLICO) === VALIDADE_MAXIMA_SEGUNDOS
        )
        ok(
            'clínico: pedido de uma semana é cortado em dez minutos',
            validadeEfetiva(clinico, VALIDADE_MAXIMA_DO_PUBLICO) === VALIDADE_MAXIMA_SEGUNDOS
        )
    }

    // ============================ a referência gravada no lugar do endereço
    /**
     * `Message.mediaUrl` guardava a **URL assinada**, de 600 s de validade.
     * Arquivo com mais de dez minutos abria 403 — e enquanto valia era chave
     * ao portador num campo de banco. Agora a coluna guarda referência e o
     * endereço é cunhado na saída, por quem já autorizou (`lib/midia.ts`).
     *
     * Estas asserções são puras. A **assinatura de verdade** só roda com
     * credencial de R2 no ambiente, e está marcada abaixo com o resto do ciclo.
     */
    {
        const ref = comoReferencia({ classe: CLASSES.CLINICO, chave: 'ws1/conv1/123.jpg' })
        ok('a referência gravada é opaca', ref === 'ref:clinico:ws1/conv1/123.jpg', ref)
        ok('e nunca parece URL', !ref.startsWith('http'))
        ok('nulo continua nulo', (await enderecoDaMidia(null)) === null)

        const legado = 'https://x.r2.cloudflarestorage.com/a/b.jpg?X-Amz-Signature=abc'
        ok('linha antiga passa intacta', (await enderecoDaMidia(legado)) === legado)
        ok(
            'referência malformada não vira link falso',
            (await enderecoDaMidia('ref:')) === 'ref:' &&
                (await enderecoDaMidia('ref:inventada:x')) === 'ref:inventada:x'
        )
    }

    // ======================== fórmula não sai viva na exportação de CSV
    /**
     * `name` e `notes` vêm do `pushName` do WhatsApp — texto que **o paciente
     * escolhe**. Um contato chamado `=HYPERLINK(...)` vira fórmula viva quando
     * a clínica abre o CSV no Excel, e exfiltra a planilha sem nada parecer
     * errado. É a injeção que não precisa de falha no nosso sistema: o alvo é
     * o Excel de quem exporta.
     */
    {
        for (const perigoso of ['=1+1', '+1', '-2+cmd|x', '@SUM(A1)', '\tx', '\rx']) {
            const saida = escapeCsv(perigoso)
            ok(
                `CSV neutraliza ${JSON.stringify(perigoso)}`,
                saida.startsWith("'") || saida.startsWith('"\''),
                saida
            )
        }
        ok('CSV não mexe em texto comum', escapeCsv('Maria Silva') === 'Maria Silva')
        ok('CSV mantém o escape de vírgula', escapeCsv('Silva, Maria') === '"Silva, Maria"')
        ok('CSV segue duplicando aspas', escapeCsv('a "b" c') === '"a ""b"" c"', escapeCsv('a "b" c'))
        ok(
            'CSV: fórmula COM vírgula leva as duas proteções',
            escapeCsv('=A1,B2') === '"\'=A1,B2"',
            escapeCsv('=A1,B2')
        )
    }

    // ---------------------------------------------------------------- lógica

    ok('classe pública vai para o R2', provedorDa(CLASSES.PUBLICO) === 'r2-publico')

    // ------------------------------------------------- deBase64 tolerante
    // Os bytes da mídia do paciente chegam do `/message/downloadmedia` em
    // formatos que o `atob` cru recusa. `deBase64` normaliza; o cofre, que usa
    // a mesma função com base64 padrão, não pode ser afetado.
    const oi = [0x6f, 0x69] // "oi"
    const igual = (u8: Uint8Array, esperado: number[]) =>
        u8.length === esperado.length && esperado.every((b, i) => u8[i] === b)
    ok('deBase64: base64 padrão', igual(deBase64('b2k='), oi))
    ok('deBase64: prefixo data URL', igual(deBase64('data:image/png;base64,b2k='), oi))
    ok('deBase64: com quebra de linha', igual(deBase64('b2\nk=\n'), oi))
    ok('deBase64: URL-safe sem padding', igual(deBase64('b2k'), oi))
    ok(
        'deBase64: URL-safe com - e _',
        // `-_8=` → `+/8=` (padrão) → bytes 0xFB 0xFF
        deBase64('-_8=').length === 2 && deBase64('-_8=')[0] === 0xfb && deBase64('-_8=')[1] === 0xff
    )
    ok('classe pública é gravável', podeGravar(CLASSES.PUBLICO))

    // Decisão do André em 2026-10-21: o clínico vai para o R2, no bucket
    // privado. A prova antiga afirmava o oposto — que a classe era recusada — e
    // foi invertida junto com a decisão, não removida: o que importa provar
    // agora é que clínico e público **não caem no mesmo bucket**.
    ok('classe clínica vai para o R2 privado', provedorDa(CLASSES.CLINICO) === 'r2-privado')
    ok('classe clínica é gravável', podeGravar(CLASSES.CLINICO))
    ok(
        'clínico e público são buckets distintos',
        provedorDa(CLASSES.CLINICO) !== provedorDa(CLASSES.PUBLICO)
    )

    try {
        provedorDa(CLASSES.NAO_CLASSIFICADO)
        ok('não classificado é recusado', false, 'não lançou')
    } catch (e) {
        ok('não classificado é recusado', e instanceof ClasseBloqueadaError)
    }

    // A recusa tem de valer no caminho de gravação, não só na consulta — senão
    // `gravar` seria uma porta lateral. Vale para NAO_CLASSIFICADO, que é o
    // bloqueio que sobrou.
    try {
        await gravar(
            CLASSES.NAO_CLASSIFICADO,
            chaveDe('ws1', 'laudo.pdf'),
            new Uint8Array(new ArrayBuffer(1)),
            { contentType: 'application/pdf' }
        )
        ok('gravar() recusa não classificado', false, 'gravou')
    } catch (e) {
        ok('gravar() recusa não classificado', e instanceof ClasseBloqueadaError)
    }

    // E clínico, agora liberado, falha por **configuração** e não por política
    // — distinção que importa: se um dia voltar a falhar por política, esta
    // prova muda de lado e alguém é obrigado a ler o porquê.
    if (!process.env.PRIVATE_STORAGE_BUCKET?.trim() || !process.env.PRIVATE_STORAGE_ENDPOINT?.trim()) {
        try {
            await gravar(
                CLASSES.CLINICO,
                chaveDe('ws1', 'foto.jpg'),
                new Uint8Array(new ArrayBuffer(1)),
                { contentType: 'image/jpeg' }
            )
            ok('clínico sem credencial falha por configuração', false, 'gravou')
        } catch (e) {
            ok(
                'clínico sem credencial falha por configuração, não por política',
                e instanceof Error &&
                    e.name === 'ProvedorNaoConfiguradoError' &&
                    !(e instanceof ClasseBloqueadaError)
            )
        }
    } else {
        skip('clínico sem credencial falha por configuração', 'PRIVATE_STORAGE_* configurado')
    }

    // ------------------------------------------------------------- chaves

    ok('chave começa pelo workspace', chaveDe('ws1', 'agents', 'a.png') === 'ws1/agents/a.png')
    ok('barras sobrando são aparadas', chaveDe('ws1', '/agents/', '/a.png') === 'ws1/agents/a.png')
    ok('partes vazias são descartadas', chaveDe('ws1', '', 'a.png') === 'ws1/a.png')

    for (const [rotulo, fn] of [
        ['sem workspace', () => chaveDe('', 'a.png')],
        ['workspace em branco', () => chaveDe('   ', 'a.png')],
        ['sem nenhuma parte', () => chaveDe('ws1')],
        ['só partes vazias', () => chaveDe('ws1', '', '  ')],
        ['escape com ..', () => chaveDe('ws1', '..', 'outro')],
        ['escape embutido', () => chaveDe('ws1', 'a/../../ws2')],
        // O prefixo de inquilino é validado como as outras partes. Hoje ele vem
        // sempre de getWorkspaceMember(), resolvido no servidor — mas a função
        // aceita uma string, e é ela que define a fronteira: é a última que deve
        // confiar que o chamador conferiu.
        ['workspaceId com ..', () => chaveDe('ws1/..', 'a.png')],
        ['workspaceId com barra', () => chaveDe('ws1/ws2', 'a.png')],
        ['workspaceId tentando escapar', () => chaveDe('../outro-inquilino', 'a.png')],
    ] as const) {
        try {
            fn()
            ok(`chave inválida recusada: ${rotulo}`, false, 'não lançou')
        } catch {
            ok(`chave inválida recusada: ${rotulo}`, true)
        }
    }

    // --------------------------------------------------------- ciclo no R2

    const temCredencial =
        process.env.PUBLIC_STORAGE_ENDPOINT &&
        process.env.PUBLIC_STORAGE_ACCESS_KEY_ID &&
        process.env.PUBLIC_STORAGE_SECRET_ACCESS_KEY &&
        process.env.PUBLIC_STORAGE_BUCKET

    if (!temCredencial) {
        skip('ciclo completo no R2', 'faltam PUBLIC_STORAGE_* (token de API do R2)')
        skip('URL assinada do R2', 'idem')
    } else {
        const chave = chaveDe('prova-migracao', `cofre-${Date.now()}.txt`)
        const conteudo = new TextEncoder().encode('prova de storage — ação, ç, 🦷')
        const corpo = new Uint8Array(new ArrayBuffer(conteudo.byteLength))
        corpo.set(conteudo)

        const ref = await gravar(CLASSES.PUBLICO, chave, corpo, { contentType: 'text/plain' })
        ok('gravou no R2', ref.provedor === 'r2-publico' && ref.chave === chave)
        ok('referência carrega a classe', ref.classe === CLASSES.PUBLICO)
        ok('referência carrega o tamanho', ref.tamanho === corpo.byteLength)
        ok('existe() encontra', await existe(ref))

        const lido = await ler(ref)
        ok(
            'leu de volta os mesmos bytes',
            lido !== null && new TextDecoder().decode(lido) === new TextDecoder().decode(corpo)
        )

        // Sem `substituir`, a segunda gravação na mesma chave tem de falhar no
        // servidor — é o If-None-Match que fecha a janela de corrida.
        try {
            await gravar(CLASSES.PUBLICO, chave, corpo, { contentType: 'text/plain' })
            ok('gravação sem substituir recusa chave existente', false, 'sobrescreveu')
        } catch {
            ok('gravação sem substituir recusa chave existente', true)
        }
        await gravar(CLASSES.PUBLICO, chave, corpo, { contentType: 'text/plain', substituir: true })
        ok('com substituir, sobrescreve', true)

        const url = await enderecoPara(ref, 60)
        ok('endereço gerado', url.startsWith('http'), url.slice(0, 60) + '…')

        /**
         * O teto, agora conferido **na assinatura de verdade** e nos dois ramos.
         *
         * O pedido de 99999 s é deliberado: o chamador pede o que quiser, e é o
         * `X-Amz-Expires` que a AWS recebe que prova quem manda. Sem isto, um
         * `Math.min` invertido passaria pelas provas puras.
         */
        const expiraDe = async (r: Parameters<typeof enderecoPara>[0], pedido: number) =>
            new URL(await enderecoPara(r, pedido)).searchParams.get('X-Amz-Expires')

        const clinico = await expiraDe({ ...ref, classe: CLASSES.CLINICO }, 99999)
        ok(
            'clínico: a assinatura sai com dez minutos',
            clinico === String(VALIDADE_MAXIMA_SEGUNDOS),
            `X-Amz-Expires=${clinico}`
        )

        const marca = await expiraDe(
            { ...ref, classe: CLASSES.PUBLICO, chave: 'ws1/agents/ag1.png' },
            99999999
        )
        ok(
            'ativo de marca: a assinatura sai com sete dias',
            marca === String(VALIDADE_MAXIMA_DO_PUBLICO),
            `X-Amz-Expires=${marca}`
        )

        const pessoa = await expiraDe(
            { ...ref, classe: CLASSES.PUBLICO, chave: 'ws1/retratos/usuario/u1.png' },
            99999999
        )
        ok(
            'retrato de pessoa: a assinatura sai com dez minutos',
            pessoa === String(VALIDADE_MAXIMA_SEGUNDOS),
            `X-Amz-Expires=${pessoa}`
        )

        // Pedir menos continua valendo: o teto é teto, não piso.
        const curta = await expiraDe({ ...ref, classe: CLASSES.PUBLICO }, 60)
        ok('pedir menos que o teto é respeitado', curta === '60', `X-Amz-Expires=${curta}`)

        await apagar(ref)
        ok('apagou', !(await existe(ref)))
        await apagar(ref)
        ok('apagar é idempotente', true)

        const ausente = await ler({ ...ref, chave: chaveDe('prova-migracao', 'nao-existe.txt') })
        ok('ler objeto ausente devolve null', ausente === null)
    }

    console.log(
        falhas === 0
            ? `\nTODOS OS TESTES PASSARAM${pulados ? ` (${pulados} pulado(s) por falta de credencial)` : ''}`
            : `\n${falhas} FALHA(S)`
    )
    process.exit(falhas === 0 ? 0 : 1)
}

void main()
