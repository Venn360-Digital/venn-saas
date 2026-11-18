/**
 * Os textos, em três idiomas — um dos apps é internacional, e a especificação
 * pede pt-BR, en e es desde o início (seção 7).
 *
 * Sem biblioteca de i18n de propósito: são poucas dezenas de frases, e uma
 * dependência a mais num pacote que entra em três apps de produção custa mais
 * que um objeto. O vocabulário do nicho NÃO está aqui — "clínica" contra
 * "agência" vem por prop do app hospedeiro, porque é cadastro, não tradução.
 */

export type Idioma = 'pt-BR' | 'en' | 'es'

const TEXTOS = {
    'pt-BR': {
        suporte: 'Suporte',
        abrirChamado: 'Abrir chamado',
        meusChamados: 'Meus chamados',
        daEmpresa: 'Da empresa',
        voltar: 'Voltar',
        fechar: 'Fechar',
        assunto: 'Assunto',
        descricao: 'O que aconteceu?',
        modulo: 'Onde aconteceu',
        impacto: 'Quem isso afeta',
        impactoSoEu: 'Só eu',
        impactoEquipe: 'Minha equipe',
        impactoParado: 'Não consigo trabalhar',
        anexos: 'Anexos',
        anexar: 'Anexar arquivo',
        capturarTela: 'Capturar a tela',
        enviar: 'Enviar',
        enviando: 'Enviando…',
        responder: 'Responder',
        suaResposta: 'Escreva sua resposta',
        abertos: 'Abertos',
        emAndamento: 'Em andamento',
        fechados: 'Fechados',
        semChamados: 'Você ainda não abriu chamados.',
        carregando: 'Carregando…',
        criado: 'Chamado {numero} criado. Avisamos por e-mail.',
        issoResolveu: 'Isso resolveu?',
        sim: 'Sim, resolveu',
        nao: 'Ainda não',
        etapaEngenharia: 'Etapa na engenharia',
        semSessao: 'Entre no sistema para falar com o suporte.',
        falhou: 'Não foi possível concluir. Tente de novo.',
        /**
         * "terceiros", e não a palavra do nicho.
         *
         * Dizia "dados de pacientes" — palavra do Odontobox, exibida também na
         * agência do Conecta e no escritório do Stagent, onde não quer dizer
         * nada. O portão do monorepo pegou isso assim que o widget mudou de
         * casa (`lint-vocabulario`).
         *
         * Trocar por uma variável do vocabulário resolveria o idioma e não o
         * aviso: quem usa o painel também não deve colar dado de colega nem de
         * fornecedor. "Terceiros" cobre os três nichos e cobre mais.
         */
        avisoDados: 'Não inclua dados pessoais de terceiros nem informações sensíveis.',
        voce: 'Você',
        suporteNome: 'Suporte',
    },
    en: {
        suporte: 'Support',
        abrirChamado: 'New ticket',
        meusChamados: 'My tickets',
        daEmpresa: 'Company tickets',
        voltar: 'Back',
        fechar: 'Close',
        assunto: 'Subject',
        descricao: 'What happened?',
        modulo: 'Where it happened',
        impacto: 'Who this affects',
        impactoSoEu: 'Only me',
        impactoEquipe: 'My team',
        impactoParado: "I can't work",
        anexos: 'Attachments',
        anexar: 'Attach file',
        capturarTela: 'Capture screen',
        enviar: 'Send',
        enviando: 'Sending…',
        responder: 'Reply',
        suaResposta: 'Write your reply',
        abertos: 'Open',
        emAndamento: 'In progress',
        fechados: 'Closed',
        semChamados: "You haven't opened any tickets yet.",
        carregando: 'Loading…',
        criado: 'Ticket {numero} created. We will email you.',
        issoResolveu: 'Did this solve it?',
        sim: 'Yes, solved',
        nao: 'Not yet',
        etapaEngenharia: 'Engineering stage',
        semSessao: 'Sign in to contact support.',
        falhou: "Couldn't complete. Please try again.",
        avisoDados: 'Do not include other people\u2019s personal data or sensitive information.',
        voce: 'You',
        suporteNome: 'Support',
    },
    es: {
        suporte: 'Soporte',
        abrirChamado: 'Nuevo ticket',
        meusChamados: 'Mis tickets',
        daEmpresa: 'Tickets de la empresa',
        voltar: 'Volver',
        fechar: 'Cerrar',
        assunto: 'Asunto',
        descricao: '¿Qué ocurrió?',
        modulo: 'Dónde ocurrió',
        impacto: 'A quién afecta',
        impactoSoEu: 'Solo a mí',
        impactoEquipe: 'A mi equipo',
        impactoParado: 'No puedo trabajar',
        anexos: 'Adjuntos',
        anexar: 'Adjuntar archivo',
        capturarTela: 'Capturar pantalla',
        enviar: 'Enviar',
        enviando: 'Enviando…',
        responder: 'Responder',
        suaResposta: 'Escribe tu respuesta',
        abertos: 'Abiertos',
        emAndamento: 'En curso',
        fechados: 'Cerrados',
        semChamados: 'Todavía no has abierto tickets.',
        carregando: 'Cargando…',
        criado: 'Ticket {numero} creado. Te avisaremos por correo.',
        issoResolveu: '¿Esto lo resolvió?',
        sim: 'Sí, resuelto',
        nao: 'Todavía no',
        etapaEngenharia: 'Etapa en ingeniería',
        semSessao: 'Inicia sesión para contactar al soporte.',
        falhou: 'No se pudo completar. Inténtalo de nuevo.',
        avisoDados: 'No incluyas datos personales de terceros ni información sensible.',
        voce: 'Tú',
        suporteNome: 'Soporte',
    },
} as const

export type Chave = keyof (typeof TEXTOS)['pt-BR']

/** O idioma do documento, com pt-BR como padrão. */
export function idiomaDoDocumento(): Idioma {
    const bruto = (document.documentElement.lang || navigator.language || 'pt-BR').toLowerCase()
    if (bruto.startsWith('es')) return 'es'
    if (bruto.startsWith('en')) return 'en'
    return 'pt-BR'
}

export function tradutor(idioma: Idioma) {
    return (chave: Chave, valores?: Record<string, string>): string => {
        const texto: string = TEXTOS[idioma][chave] ?? TEXTOS['pt-BR'][chave]
        if (!valores) return texto
        return Object.entries(valores).reduce((t, [k, v]) => t.replace(`{${k}}`, v), texto)
    }
}
