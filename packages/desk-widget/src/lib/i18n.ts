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
        arquivoGrande: '{nome} tem {mb} MB e o limite é {limite} MB. Tente recortar a tela em vez de gravar a janela inteira.',
        chamadoCriadoSemAnexo: 'O chamado {numero} foi criado. O anexo não subiu: {motivo}',
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
        comoFoiOAtendimento: 'Como foi o atendimento?',
        notaRuim: 'Ruim',
        notaOtima: 'Ótima',
        contarMais: 'Quer contar o que aconteceu? (opcional)',
        enviarNota: 'Enviar',
        obrigadoPelaNota: 'Obrigado. A sua nota é lida por gente.',
        suaNota: 'Você avaliou com {nota} de 5.',
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
        arquivoGrande: '{nome} is {mb} MB and the limit is {limite} MB. Try cropping the screen instead of capturing the whole window.',
        chamadoCriadoSemAnexo: 'Ticket {numero} was created. The attachment did not upload: {motivo}',
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
        comoFoiOAtendimento: 'How was the support?',
        notaRuim: 'Poor',
        notaOtima: 'Great',
        contarMais: 'Want to tell us what happened? (optional)',
        enviarNota: 'Send',
        obrigadoPelaNota: 'Thank you. A person reads your rating.',
        suaNota: 'You rated it {nota} out of 5.',
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
        arquivoGrande: '{nome} tiene {mb} MB y el límite es {limite} MB. Prueba a recortar la pantalla en vez de capturar toda la ventana.',
        chamadoCriadoSemAnexo: 'El ticket {numero} fue creado. El adjunto no subió: {motivo}',
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
        comoFoiOAtendimento: '¿Cómo fue la atención?',
        notaRuim: 'Mala',
        notaOtima: 'Excelente',
        contarMais: '¿Quieres contarnos qué pasó? (opcional)',
        enviarNota: 'Enviar',
        obrigadoPelaNota: 'Gracias. Una persona lee tu valoración.',
        suaNota: 'La valoraste con {nota} de 5.',
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

/**
 * O idioma do documento, com pt-BR como padrão.
 *
 * **Devolve pt-BR quando não há documento, e isso não é defensividade vazia.**
 * O widget nasceu num Vite, onde todo render acontece no navegador. Dentro do
 * Next, um componente de cliente também é renderizado NO SERVIDOR no primeiro
 * paint — `'use client'` diz onde ele ganha interatividade, não onde ele é
 * renderizado. Sem esta guarda, ler `document` durante o render do servidor
 * lança, e a exceção sobe até derrubar o layout inteiro do painel: Error 1101
 * nos três apps em produção, medido em 18/11/2026.
 *
 * O padrão acerta o caso comum (os três apps são pt-BR) e, quando não acertar,
 * o idioma certo chega no segundo render, no cliente — um texto em português
 * por um quadro é incomparavelmente melhor que um painel que não abre.
 */
export function idiomaDoDocumento(): Idioma {
    if (typeof document === 'undefined') return 'pt-BR'

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
