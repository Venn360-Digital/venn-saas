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
} from '@/lib/storage'

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
    // ---------------------------------------------------------------- lógica

    ok('classe pública vai para o R2', provedorDa(CLASSES.PUBLICO) === 'r2-publico')
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

        const assinada = await enderecoPara({ ...ref, classe: CLASSES.CLINICO }, 99999)
        const expira = new URL(assinada).searchParams.get('X-Amz-Expires')
        ok(
            'validade é limitada ao máximo',
            expira === String(VALIDADE_MAXIMA_SEGUNDOS),
            `X-Amz-Expires=${expira}`
        )

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
