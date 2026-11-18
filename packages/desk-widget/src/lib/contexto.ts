/**
 * O contexto que o widget captura sem o usuário digitar (seção 7). É o que
 * permite à IA reproduzir o defeito em vez de pedir "manda print".
 *
 * **O que NÃO é capturado, por minimização (seção 10):** corpo de requisição,
 * conteúdo de formulário, cookie, localStorage, e o texto da página. O
 * Odontobox atende clínicas — qualquer um desses carregaria dado de paciente
 * para dentro de um chamado que vai para o Slack e para uma issue.
 *
 * Os erros de console e as requisições com falha são coletados por um gravador
 * circular pequeno, instalado quando o provider monta. Guarda só o necessário
 * para localizar a falha: mensagem, método, rota e status. Nunca corpo.
 */

const LIMITE_ERROS = 10
const LIMITE_FALHAS = 10

export interface FalhaDeRede {
    metodo: string
    rota: string
    status: number
    quando: string
}

export interface ErroDeConsole {
    mensagem: string
    quando: string
}

const erros: ErroDeConsole[] = []
const falhas: FalhaDeRede[] = []
let instalado = false

function anota<T>(lista: T[], item: T, limite: number) {
    lista.push(item)
    if (lista.length > limite) lista.shift()
}

/** Instala os gravadores. Idempotente: dois providers não duplicam captura. */
export function instalarGravadores(): () => void {
    if (instalado) return () => {}
    instalado = true

    const aoErrar = (e: ErrorEvent) => {
        anota(
            erros,
            { mensagem: String(e.message).slice(0, 300), quando: new Date().toISOString() },
            LIMITE_ERROS
        )
    }

    const aoRejeitar = (e: PromiseRejectionEvent) => {
        const motivo = e.reason
        const mensagem = motivo instanceof Error ? motivo.message : String(motivo)
        anota(erros, { mensagem: mensagem.slice(0, 300), quando: new Date().toISOString() }, LIMITE_ERROS)
    }

    window.addEventListener('error', aoErrar)
    window.addEventListener('unhandledrejection', aoRejeitar)

    /**
     * O `fetch` é embrulhado para anotar APENAS falhas — status >= 400 ou
     * exceção de rede. Requisição que deu certo não interessa e seria ruído.
     * A URL é reduzida ao caminho: query string pode carregar identificador.
     */
    const originalFetch = window.fetch
    window.fetch = async function (...args: Parameters<typeof fetch>) {
        const [entrada, init] = args
        const metodo = (init?.method ?? 'GET').toUpperCase()
        let rota = '(desconhecida)'
        try {
            const bruta = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url
            rota = new URL(bruta, location.origin).pathname
        } catch {
            /* URL estranha: fica como desconhecida */
        }

        try {
            const resposta = await originalFetch.apply(this, args)
            if (resposta.status >= 400) {
                anota(falhas, { metodo, rota, status: resposta.status, quando: new Date().toISOString() }, LIMITE_FALHAS)
            }
            return resposta
        } catch (erro) {
            anota(falhas, { metodo, rota, status: 0, quando: new Date().toISOString() }, LIMITE_FALHAS)
            throw erro
        }
    }

    return () => {
        window.removeEventListener('error', aoErrar)
        window.removeEventListener('unhandledrejection', aoRejeitar)
        window.fetch = originalFetch
        instalado = false
    }
}

export interface ContextoCapturado {
    rota: string
    urlCompleta: string
    titulo: string
    versaoDoApp?: string
    navegador: string
    plataforma: string
    tela: string
    janela: string
    idioma: string
    fuso: string
    online: boolean
    errosDeConsole: ErroDeConsole[]
    falhasDeRede: FalhaDeRede[]
}

export function capturarContexto(versaoDoApp?: string): ContextoCapturado {
    return {
        rota: location.pathname,
        /// A URL completa entra sem query string, pelo mesmo motivo acima.
        urlCompleta: `${location.origin}${location.pathname}`,
        titulo: document.title.slice(0, 120),
        ...(versaoDoApp === undefined ? {} : { versaoDoApp }),
        navegador: navigator.userAgent.slice(0, 200),
        plataforma: navigator.platform,
        tela: `${screen.width}x${screen.height}`,
        janela: `${window.innerWidth}x${window.innerHeight}`,
        idioma: navigator.language,
        fuso: Intl.DateTimeFormat().resolvedOptions().timeZone,
        online: navigator.onLine,
        errosDeConsole: [...erros],
        falhasDeRede: [...falhas],
    }
}
