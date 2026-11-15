import type { Metadata } from 'next'
import Link from 'next/link'

/**
 * A política de privacidade, pública e sem sessão.
 *
 * ## Por que ela existe e por que a forma importa
 *
 * O Google exige uma política pública, no mesmo domínio do app, para publicar a
 * tela de consentimento OAuth — e um revisor humano a lê procurando uma coisa
 * específica: o que o app faz com os dados do **usuário do Google**. É a seção
 * §3, e ela está separada do resto de propósito.
 *
 * ## A regra que este arquivo tem de obedecer
 *
 * **Nada aqui pode ser aspiracional.** Cada afirmação foi levantada do sistema,
 * não do que seria bom dizer: os dados tratados saem do `schema.prisma`, os
 * terceiros saem das chamadas externas de `src/`, os escopos saem de
 * `GOOGLE_CALENDAR_SCOPES`, e o que NÃO é guardado — número de cartão — saiu de
 * ler `model PaymentCard`, que tem `asaasToken`, `brand` e `last4` e mais nada.
 *
 * Política de privacidade que promete mais do que o código faz é declaração
 * falsa ao titular e ao Google. Mexeu no que o sistema coleta ou em para onde
 * manda? **Mexa aqui junto**, e atualize a data.
 */

const ATUALIZADA_EM = '25 de outubro de 2026'

/**
 * O canal de privacidade.
 *
 * Tem de ser um endereço que **recebe de verdade**: a LGPD exige canal de
 * atendimento ao titular, e o Google verifica que o contato da política existe.
 * Endereço publicado que ninguém lê é pior que nenhum.
 */
const EMAIL_DE_PRIVACIDADE = 'privacidade@venn360.com'

/**
 * A qualificação de quem responde.
 *
 * A LGPD pede que o controlador seja **identificável** — sem isso o titular não
 * sabe contra quem exercer o direito do artigo 18, e a política vira um texto
 * sem dono. O CNPJ foi conferido pelos dígitos verificadores antes de entrar
 * aqui; publicar número com erro de digitação numa página jurídica é pior que
 * omiti-lo.
 */
const CONTROLADOR = {
    razaoSocial: 'André Moreira Assessoria e Gestão Empresarial Ltda.',
    cnpj: '37.001.379/0001-64',
    endereco:
        'Av. Getúlio Vargas, 671, Sala 500 — Edifício Paraúna, Savassi, ' +
        'Belo Horizonte/MG, CEP 30112-021',
}

export const metadata: Metadata = {
    title: 'Política de Privacidade — Stagent360',
    description:
        'Como o Stagent360 trata dados pessoais: o que coletamos, com quem compartilhamos, ' +
        'como usamos dados do Google e quais são os seus direitos.',
}

function Secao({
    numero,
    titulo,
    children,
}: {
    numero: string
    titulo: string
    children: React.ReactNode
}) {
    return (
        <section className="mt-10">
            <h2 className="text-h3 scroll-mt-8" id={`s${numero}`}>
                <span className="mr-2 text-muted-foreground">{numero}.</span>
                {titulo}
            </h2>
            <div className="mt-3 space-y-3 text-sm leading-relaxed text-foreground">{children}</div>
        </section>
    )
}

function Tabela({ cabecalho, linhas }: { cabecalho: string[]; linhas: string[][] }) {
    return (
        /* Rola dentro de si: numa tela de 360px uma tabela de três colunas
           empurraria a página inteira para o lado. */
        <div className="mt-3 overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[32rem] border-collapse text-sm">
                <thead>
                    <tr className="bg-muted/50">
                        {cabecalho.map((c) => (
                            <th
                                key={c}
                                className="border-b border-border px-3 py-2 text-left text-xs font-semibold text-muted-foreground"
                            >
                                {c}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {linhas.map((linha) => (
                        <tr key={linha[0]} className="border-b border-border last:border-b-0">
                            {linha.map((celula, i) => (
                                <td
                                    key={i}
                                    className={
                                        i === 0
                                            ? 'px-3 py-2 align-top font-medium'
                                            : 'px-3 py-2 align-top text-muted-foreground'
                                    }
                                >
                                    {celula}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
}

export default function PoliticaDePrivacidade() {
    return (
        <main className="min-h-screen bg-background px-5 py-10">
            <article className="mx-auto max-w-3xl">
                <header className="border-b border-border pb-6">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Stagent360
                    </p>
                    <h1 className="mt-1 text-h1">Política de Privacidade</h1>
                    <p className="mt-2 text-sm text-muted-foreground">
                        Atualizada em {ATUALIZADA_EM}
                    </p>
                </header>

                <p className="mt-6 text-sm leading-relaxed">
                    O Stagent360 é um sistema de atendimento, agenda e CRM para empresas.
                    Esta política descreve quais dados pessoais são tratados, com
                    que finalidade, com quem são compartilhados e quais direitos você tem. Ela
                    segue a Lei Geral de Proteção de Dados (Lei 13.709/2018).
                </p>

                <Secao numero="1" titulo="Quem trata os dados, e em qual papel">
                    <p>
                        A distinção abaixo não é formalidade: ela define a quem você deve recorrer.
                    </p>
                    <p>
                        <strong>Dados dos clientes.</strong> Quem decide coletar, por que e por
                        quanto tempo é a <strong>empresa</strong> que usa o sistema — ela é a{' '}
                        <strong>controladora</strong>. O Stagent360 atua como{' '}
                        <strong>operador</strong>: tratamos esses dados seguindo as instruções da
                        empresa, para prestar o serviço contratado. Se você é cliente e quer
                        acessar, corrigir ou excluir seus dados, o caminho mais direto é a empresa
                        que o atende; podemos encaminhar o pedido, mas a decisão é dela.
                    </p>
                    <p>
                        <strong>Dados de quem contrata.</strong> Para os dados cadastrais e de
                        cobrança da própria empresa e de seus usuários, o Stagent360 é{' '}
                        <strong>controlador</strong>.
                    </p>
                    <p>
                        O Stagent360 é operado por{' '}
                        <strong>{CONTROLADOR.razaoSocial}</strong>, inscrita no CNPJ sob o nº{' '}
                        {CONTROLADOR.cnpj}, com sede na {CONTROLADOR.endereco}.
                    </p>
                </Secao>

                <Secao numero="2" titulo="Dados que tratamos">
                    <Tabela
                        cabecalho={['Categoria', 'O que inclui', 'Para quê']}
                        linhas={[
                            [
                                'Conta e acesso',
                                'Nome, e-mail, senha (guardada apenas como hash), sessões e registro de aceite dos termos',
                                'Autenticar, controlar permissões e registrar quem fez o quê',
                            ],
                            [
                                'Clientes e contatos',
                                'Nome, telefone, e-mail, foto, identificador de Instagram, anotações, etiquetas, campos personalizados e origem',
                                'Atendimento, agenda e histórico do relacionamento',
                            ],
                            [
                                'Conversas',
                                'Mensagens trocadas por WhatsApp, Instagram ou pelo widget do site, incluindo arquivos — imagens, áudios e documentos — e status de entrega',
                                'Atender, registrar o que foi combinado e permitir retomar o assunto',
                            ],
                            [
                                'Agenda',
                                'Compromissos, horários, profissional responsável e lembretes',
                                'Organizar a agenda e avisar quem precisa ser avisado',
                            ],
                            [
                                'Cobrança',
                                'Plano, faturas, bandeira e os quatro últimos dígitos do cartão, além de um token do meio de pagamento',
                                'Cobrar a assinatura da empresa',
                            ],
                            [
                                'Uso do sistema',
                                'Registros de ações, consumo de créditos de IA e notificações enviadas',
                                'Segurança, suporte e medição de consumo',
                            ],
                        ]}
                    />
                    <p>
                        <strong>Não guardamos o número do cartão nem o código de segurança.</strong>{' '}
                        Esses dados vão direto ao processador de pagamento, que nos devolve um
                        token. É esse token, a bandeira e os quatro últimos dígitos que ficam
                        conosco.
                    </p>
                    <p>
                        Conversas de uma empresa podem conter informação sobre saúde,
                        que a LGPD classifica como <strong>dado pessoal sensível</strong>. Tratamos
                        esse conteúdo apenas para prestar o serviço à empresa, sob a mesma proteção
                        técnica descrita na seção 6.
                    </p>
                </Secao>

                <Secao numero="3" titulo="Dados do Google (Calendar) e Uso Limitado">
                    <p>
                        Esta seção descreve, em separado, o tratamento dos dados obtidos por meio
                        das APIs do Google — é o que a Política de Dados do Usuário dos Serviços de
                        API do Google exige.
                    </p>
                    <p>
                        A conexão é <strong>iniciada pelo próprio profissional</strong>, em
                        Integrações, e pode ser desfeita por ele a qualquer momento no mesmo lugar.
                    </p>
                    <Tabela
                        cabecalho={['Escopo solicitado', 'Para que é usado']}
                        linhas={[
                            [
                                '.../auth/calendar.events',
                                'Criar, atualizar e remover na agenda principal do profissional o evento correspondente a um compromisso agendado, remarcado ou cancelado no Stagent360',
                            ],
                            [
                                '.../auth/userinfo.email',
                                'Exibir na tela qual conta Google está conectada, para que o profissional saiba de qual agenda se trata',
                            ],
                        ]}
                    />
                    <p>
                        <strong>Não lemos, criamos, compartilhamos nem excluímos agendas</strong> —
                        apenas eventos. Guardamos os tokens de acesso e de atualização e o e-mail da
                        conta conectada, e nada mais do Google.
                    </p>
                    <p>
                        <strong>Uso Limitado.</strong> O uso que o Stagent360 faz das informações
                        recebidas das APIs do Google obedece à{' '}
                        <a
                            className="underline underline-offset-2 hover:text-primary"
                            href="https://developers.google.com/terms/api-services-user-data-policy"
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            Política de Dados do Usuário dos Serviços de API do Google
                        </a>
                        , inclusive aos requisitos de Uso Limitado. Em termos diretos: esses dados{' '}
                        <strong>não são vendidos</strong>, <strong>não são usados para
                        publicidade</strong>, <strong>não são usados para treinar modelos de
                        inteligência artificial</strong> e não são compartilhados com terceiros,
                        salvo com os provedores de infraestrutura estritamente necessários para
                        operar a integração, por determinação legal ou com o consentimento expresso
                        do usuário.
                    </p>
                    <p>
                        Ao desconectar a integração, o token é revogado junto ao Google e as
                        credenciais são apagadas do nosso banco. Os eventos já criados permanecem na
                        agenda do profissional, sob controle dele.
                    </p>
                </Secao>

                <Secao numero="4" titulo="Com quem compartilhamos">
                    <p>
                        Não vendemos dados pessoais. O compartilhamento abaixo é o necessário para
                        o sistema funcionar, e cada item existe por uma função concreta.
                    </p>
                    <Tabela
                        cabecalho={['Quem', 'O que recebe', 'Por quê']}
                        linhas={[
                            [
                                'Cloudflare',
                                'Todo o tráfego da aplicação e os arquivos enviados nas conversas',
                                'Hospedagem, rede e armazenamento de arquivos',
                            ],
                            [
                                'Neon',
                                'O banco de dados da aplicação',
                                'Banco de dados gerenciado, em região do Brasil (São Paulo)',
                            ],
                            [
                                'Meta (WhatsApp e Instagram)',
                                'Mensagens e identificadores das conversas desses canais',
                                'Enviar e receber mensagens pelos canais oficiais',
                            ],
                            [
                                'OpenAI',
                                'O conteúdo das mensagens da conversa em que o agente de IA atua, e o material de conhecimento cadastrado pela empresa',
                                'Gerar as respostas do agente de IA, transcrever áudios recebidos e sintetizar voz',
                            ],
                            [
                                'Google',
                                'Apenas os eventos de agenda descritos na seção 3',
                                'Sincronizar a agenda, quando o profissional conecta',
                            ],
                            [
                                'Asaas',
                                'Dados de cobrança da empresa',
                                'Processar a assinatura e os pagamentos',
                            ],
                            [
                                'Resend',
                                'E-mail e nome do destinatário',
                                'Enviar avisos de cobrança e do sistema',
                            ],
                        ]}
                    />
                    <p>
                        Também podemos compartilhar dados para cumprir obrigação legal ou ordem de
                        autoridade competente.
                    </p>
                </Secao>

                <Secao numero="5" titulo="Transferência internacional">
                    <p>
                        O banco de dados fica em <strong>São Paulo</strong>. Parte dos provedores
                        acima opera fora do Brasil — notadamente OpenAI, Meta e a rede da
                        Cloudflare. Nesses casos a transferência ocorre para a execução do contrato
                        com a empresa, conforme o artigo 33 da LGPD, e exige dos provedores
                        compromissos contratuais de proteção.
                    </p>
                </Secao>

                <Secao numero="6" titulo="Segurança">
                    <p>Medidas técnicas que estão em uso, não planejadas:</p>
                    <ul className="list-disc space-y-1 pl-5">
                        <li>tráfego sempre em HTTPS, com HSTS;</li>
                        <li>
                            senhas guardadas apenas como hash — não há como recuperá-las, só
                            redefinir;
                        </li>
                        <li>
                            credenciais de integração cifradas em AES-256-GCM, com a chave fora do
                            banco;
                        </li>
                        <li>
                            arquivos das conversas em armazenamento privado, acessíveis apenas por
                            link assinado de curta duração;
                        </li>
                        <li>
                            isolamento por empresa aplicado em cada consulta, de modo que uma
                            empresa não alcança o dado de outra;
                        </li>
                        <li>
                            limitação de tentativas de login e bloqueio de tráfego malicioso na
                            borda.
                        </li>
                    </ul>
                    <p>
                        Nenhum sistema é imune. Se ocorrer incidente de segurança com risco
                        relevante aos titulares, comunicaremos as empresas afetadas e a Autoridade
                        Nacional de Proteção de Dados, nos termos do artigo 48 da LGPD.
                    </p>
                </Secao>

                <Secao numero="7" titulo="Por quanto tempo guardamos">
                    <p>
                        Enquanto a empresa mantém a conta ativa, os dados permanecem disponíveis
                        para ela. Encerrado o contrato, a empresa recebe avisos antes da exclusão e
                        a <strong>exportação continua disponível durante todo esse período</strong>
                        — apagar o histórico de uma empresa antes que ela possa levá-lo embora
                        seria o pior desfecho possível.
                    </p>
                    <p>
                        A empresa pode solicitar a exclusão a qualquer momento. Alguns registros são
                        mantidos por prazo maior quando a lei exige, como os documentos fiscais
                        ligados à cobrança.
                    </p>
                </Secao>

                <Secao numero="8" titulo="Seus direitos">
                    <p>
                        O artigo 18 da LGPD garante a você: confirmação de que existe tratamento;
                        acesso aos dados; correção de dado incompleto, inexato ou desatualizado;
                        anonimização, bloqueio ou eliminação de dado desnecessário ou tratado em
                        desconformidade; portabilidade; informação sobre com quem compartilhamos;
                        e revogação do consentimento.
                    </p>
                    <p>
                        Para exercê-los, escreva para{' '}
                        <a
                            className="underline underline-offset-2 hover:text-primary"
                            href={`mailto:${EMAIL_DE_PRIVACIDADE}`}
                        >
                            {EMAIL_DE_PRIVACIDADE}
                        </a>
                        . Se você é cliente de uma empresa que usa o Stagent360, procure primeiro
                        a empresa: ela é a controladora dos seus dados, como explicado na seção 1.
                    </p>
                </Secao>

                <Secao numero="9" titulo="Cookies">
                    <p>
                        Usamos apenas os cookies necessários para manter você conectado e proteger a
                        sessão. Não usamos cookies de publicidade nem de rastreamento entre sites.
                    </p>
                </Secao>

                <Secao numero="10" titulo="Alterações">
                    <p>
                        Mudanças relevantes nesta política passam a valer na data de atualização
                        indicada no topo, e as empresas são avisadas dentro do sistema. A versão em
                        vigor é sempre a publicada nesta página.
                    </p>
                </Secao>

                <footer className="mt-12 border-t border-border pt-6 text-sm text-muted-foreground">
                    <p className="leading-relaxed">
                        {CONTROLADOR.razaoSocial}
                        <br />
                        CNPJ {CONTROLADOR.cnpj}
                        <br />
                        {CONTROLADOR.endereco}
                    </p>
                    <p className="mt-3">
                        Dúvidas sobre privacidade:{' '}
                        <a
                            className="underline underline-offset-2 hover:text-primary"
                            href={`mailto:${EMAIL_DE_PRIVACIDADE}`}
                        >
                            {EMAIL_DE_PRIVACIDADE}
                        </a>
                    </p>
                    <p className="mt-3">
                        <Link className="underline underline-offset-2 hover:text-primary" href="/login">
                            Voltar para o Stagent360
                        </Link>
                    </p>
                </footer>
            </article>
        </main>
    )
}
