'use client'

import { useRef } from 'react'
import { AlertTriangle, Check, Download, FileUp, ListPlus } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@venn/ui/button'
import { Textarea } from '@venn/ui/textarea'
import {
    conferirEstrutura,
    modeloDoDocumento,
    type DocumentoDeTreinamento as Doc,
} from '../../../lib/treinamento/documentos'
import { secionarMarkdown, semComentarios } from '../../../lib/rag/secoes'
import { textoParaAcervo } from '../../../lib/treinamento/indexar'
import { cn } from '@venn/ui/utils'
import { useVocab } from '../../../hooks/useVocab'
import { comArtigo } from '../../../lib/concordancia'

/**
 * O campo padrão da central de treinamento — um documento em Markdown.
 *
 * É o mesmo componente nos sete assuntos, desenhado a partir do catálogo
 * (`src/lib/treinamento/documentos.ts`): o que muda entre eles é dado, não
 * código. Acrescentar o oitavo documento é acrescentar uma entrada no catálogo.
 *
 * **O cartão abre com o título do documento, e só com ele** — decisão do Andre
 * em 2026-11-05, e é uma reversão consciente da regra da Tela 03, que proibia
 * título dentro do conteúdo.
 *
 * O que estava ali antes eram dois parágrafos: a `explicacao` do catálogo e uma
 * frase sobre onde o documento age ("Vai em toda mensagem. Escreva a regra, não
 * o manual."). Lidos de guia em guia, oito vezes, viravam preâmbulo — a pessoa
 * aprende a saltar o bloco cinza e a explicação deixa de ser lida justamente
 * onde ela importaria. O título diz o assunto numa linha, e o índice à esquerda
 * dá o contexto.
 *
 * **O que explicava não foi apagado, mudou de lugar.** `explicacao` e `modo`
 * continuam no catálogo, e continuam servindo ao roteiro de preenchimento em
 * `/suporte`, que é texto longo lido uma vez — não legenda relida oito. O
 * título não repete o rótulo do índice: lá é "Empresa", aqui é "Informações
 * sobre a empresa".
 *
 * Três coisas a tela continua dizendo, e o método não funciona sem elas:
 *
 *   - **Quanto cabe.** O teto dos documentos de prompt é o que protege a conta
 *     inteira: um manual de cinquenta páginas em Instruções gerais degrada
 *     todas as respostas. O contador mostra o consumo antes de salvar.
 *   - **O que falta.** O corte do acervo é por cabeçalho, então seção sem
 *     conteúdo é seção que não existe para o agente. A conferência roda contra o
 *     **corte real**, não contra o texto cru.
 *   - **O que o agente já sabe.** "Indexado em 34 trechos" é a prova de que o
 *     que foi escrito chegou ao Cérebro — o que o Cérebro nunca mostrou.
 */

interface Props {
    doc: Doc
    valor: string
    onChange: (valor: string) => void
    /** Quando e em quantos trechos foi indexado. Nulo em documento de prompt. */
    indexadoEm?: string | null
    trechos?: number | null
    /**
     * O acervo está atrasado: o que está indexado não é o que o texto publicado
     * daria hoje.
     *
     * Quem decide é o servidor, e tem de ser: a conta depende de `indexedHash`,
     * que a tela não recebe. Comparar os dois números que a tela já mostra
     * — "indexado em 10 trechos" contra "8 trechos" — pareceria suficiente e não
     * é: o contador da direita é do **rascunho** em edição, e o da esquerda é do
     * publicado. Divergir é o normal enquanto se escreve.
     */
    desatualizado?: boolean
    somenteLeitura?: boolean
    /**
     * Os campos antigos do cadastro, para o rascunho da transição.
     *
     * Ausente, o botão não aparece. O rascunho preenche o campo **na tela** e
     * nada é gravado até a pessoa salvar — script contra o banco escreveria em
     * produção antes de alguém conferir, e o que está aqui é o que o agente vai
     * dizer ao paciente.
     */
}

export function DocumentoDeTreinamento({
    doc,
    valor,
    onChange,
    indexadoEm,
    trechos,
    desatualizado = false,
    somenteLeitura = false,
}: Props) {
    const v = useVocab()
    const entrada = useRef<HTMLInputElement>(null)
    /**
     * **"Gerar cadastro" saiu**, por decisão do Andre em 2026-11-04.
     *
     * O botão montava um rascunho do documento a partir dos campos antigos do
     * agente — nome da empresa, setor, endereço, descrição, atribuições. Fazia
     * sentido na transição para o método por .MD, quando havia agente com
     * aquele cadastro preenchido e redigitá-lo em Markdown seria jogar fora
     * trabalho feito. Essa transição acabou.
     *
     * Hoje a conta nova chega com os campos vazios, e aí o botão devolvia a
     * casca do documento: títulos e nenhuma informação — exatamente o que
     * "Inserir modelo" faz, com um nome que promete mais. Dois botões para o
     * mesmo efeito, e o de nome maior entregando menos.
     *
     * Saiu com o encanamento: `lib/treinamento/gerar.ts`, a prop
     * `camposAntigos` que atravessava três componentes e a seção do
     * `test:treinamento` que o exercitava. Código morto que ainda tem teste
     * verde é pior que código morto — ele parece vivo.
     */

    const usado = valor.length
    const excedeu = usado > doc.teto
    /* Avisa antes de estourar: descobrir o teto ao salvar é descobrir tarde. */
    const perto = !excedeu && usado > doc.teto * 0.9

    /**
     * A conferência roda sobre o texto **que vai de fato ser cortado**.
     *
     * É a mesma normalização do indexador (`textoParaAcervo`): sem comentário de
     * quem escreve e, nos documentos de acervo, sem a seção reservada de
     * exemplos. Conferir o texto cru diria que a seção existe quando o corte não
     * a vê — e o que importa é o que o agente vai conseguir recuperar, não o que
     * está escrito na tela.
     *
     * Nos documentos de **prompt** a conta é sobre o texto inteiro, porque é o
     * texto inteiro que vai ao modelo: lá o exemplo é instrução de estilo, não
     * trecho recuperável. O número de trechos de um documento de prompt não
     * descreve acervo nenhum — serve só como medida de quão bem seccionado ele
     * está.
     */
    const acervo = textoParaAcervo(valor)
    // `!== 'prompt'` e não `=== 'rag'`: o de servico também é indexado,
    // e conferir a estrutura dele contra o texto cru esconderia o que o corte
    // de fato vai ver.
    const paraConferir = doc.modo !== 'prompt' ? acervo.texto : semComentarios(valor)
    const estrutura = conferirEstrutura(secionarMarkdown(paraConferir))
    /**
     * Quem escreveu a seção de exemplos precisa saber que ela não é indexada.
     *
     * Sem este aviso, o comportamento parece defeito: a pessoa escreve três
     * exemplos de resposta, salva, e o contador de trechos não sobe. Dizer que
     * ficou de fora **e por quê** é o que transforma uma surpresa em regra
     * aprendida — e é só no documento de acervo que a distinção existe.
     */
    const exemplosFora = doc.modo !== 'prompt' ? acervo.exemplosRetirados : []
    const temConteudo = valor.trim().length > 0

    const importar = (arquivo: File) => {
        if (arquivo.size > doc.teto * 4) {
            toast.error(`O arquivo passa do teto de ${doc.teto.toLocaleString('pt-BR')} caracteres`)
            return
        }
        void arquivo.text().then((texto) => {
            onChange(texto)
            toast.success(`${arquivo.name} carregado`)
        })
    }

    const exportar = () => {
        /* Blob e `revokeObjectURL`: sem revogar, cada exportação deixa o texto
           preso na memória da aba até recarregar. */
        const url = URL.createObjectURL(new Blob([valor], { type: 'text/markdown' }))
        const link = document.createElement('a')
        link.href = url
        link.download = `${doc.slug}.md`
        link.click()
        URL.revokeObjectURL(url)
    }

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
                {/*
                  * `min-w-[260px]` e não `min-w-0`: os três botões tomam ~420px,
                  * e sem piso quem cede é o título, que colapsa e quebra em duas
                  * palavras por linha. Com piso, o `flex-wrap` faz o grupo de
                  * botões descer, que é o certo. É a armadilha que o DESIGN.md
                  * registra na Tela 03.
                  */}
                <div className="min-w-[260px] flex-1">
                    <h2 className="text-sm font-semibold text-foreground">{doc.titulo}</h2>
                </div>

                {!somenteLeitura ? (
                    <div className="flex shrink-0 items-center gap-1.5">
                        <input
                            ref={entrada}
                            type="file"
                            accept=".md,.markdown,.txt,text/markdown,text/plain"
                            className="hidden"
                            onChange={(e) => {
                                const arquivo = e.target.files?.[0]
                                if (arquivo) importar(arquivo)
                                // Zera para o mesmo arquivo poder ser escolhido de novo.
                                e.target.value = ''
                            }}
                        />
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8"
                            onClick={() => onChange(modeloDoDocumento(doc, v))}
                            // Sobrescrever texto escrito é perda silenciosa: o
                            // modelo só entra no campo vazio.
                            disabled={temConteudo}
                            title={
                                temConteudo
                                    ? 'O modelo só entra no campo vazio, para não apagar o que você escreveu'
                                    : undefined
                            }
                        >
                            <ListPlus className="size-4" aria-hidden="true" />
                            Inserir modelo
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8"
                            onClick={() => entrada.current?.click()}
                        >
                            <FileUp className="size-4" aria-hidden="true" />
                            Importar .md
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8"
                            onClick={exportar}
                            disabled={!temConteudo}
                        >
                            <Download className="size-4" aria-hidden="true" />
                            Exportar
                        </Button>
                    </div>
                ) : null}
            </div>

            <Textarea
                id={`treinamento-${doc.slug}`}
                aria-label={doc.titulo}
                className="min-h-[340px] font-mono text-[12.5px] leading-relaxed"
                spellCheck={false}
                // Sem o título no meio da frase: "Cole aqui o serviços
                // prestados" errava a concordância em quatro dos sete.
                placeholder={'Cole aqui o conteúdo em Markdown, ou use "Inserir modelo".'}
                value={valor}
                onChange={(e) => onChange(e.target.value)}
            />

            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span
                        className={cn(
                            'num',
                            excedeu
                                ? 'font-semibold text-destructive'
                                : perto
                                  ? 'font-semibold text-warning-subtle-foreground'
                                  : 'text-muted-foreground'
                        )}
                    >
                        {usado.toLocaleString('pt-BR')} / {doc.teto.toLocaleString('pt-BR')}
                    </span>

                    {/* O estado do acervo. Documento de prompt não se indexa, e
                        dizer isso é melhor que deixar um espaço vazio que
                        parece pendência. */}
                    {doc.modo === 'prompt' ? (
                        <span className="text-muted-foreground">Não se indexa</span>
                    ) : indexadoEm ? (
                        <span
                            className={cn(
                                desatualizado
                                    ? 'text-warning-subtle-foreground'
                                    : 'text-muted-foreground'
                            )}
                        >
                            Indexado em {trechos?.toLocaleString('pt-BR')} trecho
                            {trechos === 1 ? '' : 's'},{' '}
                            {new Date(indexadoEm).toLocaleString('pt-BR', {
                                day: '2-digit',
                                month: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit',
                            })}
                            {/*
                              * **O carimbo precisa saber mentir menos.**
                              *
                              * "Indexado em 10 trechos" é uma afirmação sobre o
                              * acervo, e ela ficava verdadeira no número e falsa
                              * no sentido: os 10 trechos eram de um texto que o
                              * corte de hoje não produz mais. Aconteceu quando o
                              * código que decide o que vai para o acervo mudou —
                              * ninguém editou nada, e o agente seguiu servindo
                              * diálogos de exemplo como fato.
                              *
                              * Dizer "desatualizado" aqui, colado no número que
                              * está errado, é o que liga o aviso ao botão de
                              * reindexar no cabeçalho.
                              */}
                            {desatualizado ? ' — desatualizado' : null}
                        </span>
                    ) : temConteudo ? (
                        // "Publique", não "salve": a indexação saiu do salvar e
                        // mora no Publicar desde o passo 4.
                        <span className="text-warning-subtle-foreground">
                            Escrito e ainda não indexado — publique para o agente aprender
                        </span>
                    ) : null}
                </div>

                {/*
                  * O que a conferência diz, e o que ela deixou de dizer.
                  *
                  * Ela não compara mais com a lista do catálogo: as seções são
                  * da empresa — "Prótese overdenture", "Etapa 4", "Dói?" — e
                  * exigir nome acusava documento bom. O que vale em qualquer
                  * redação é quantos trechos saem, e os dois casos em que o
                  * corte vai piorar.
                  */}
                {temConteudo ? (
                    estrutura.semSecoes ? (
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                            <AlertTriangle
                                className="size-3.5 shrink-0 text-warning-subtle-foreground"
                                aria-hidden="true"
                            />
                            Sem subtítulos — será cortado por tamanho, não por assunto
                        </span>
                    ) : estrutura.grandesDemais.length > 0 ? (
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                            <AlertTriangle
                                className="size-3.5 shrink-0 text-warning-subtle-foreground"
                                aria-hidden="true"
                            />
                            Longo demais para um trecho: {estrutura.grandesDemais.join(', ')}
                        </span>
                    ) : (
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                            <Check className="size-3.5 shrink-0" aria-hidden="true" />
                            {estrutura.trechos} trecho{estrutura.trechos === 1 ? '' : 's'}
                        </span>
                    )
                ) : null}
            </div>

            {desatualizado ? (
                <p className="text-xs text-warning-subtle-foreground">
                    <strong className="font-semibold">O acervo deste documento está atrasado.</strong>{' '}
                    O que está indexado não é o que este texto daria hoje — o que mudou foi a regra
                    de recorte, não o texto. Use “Reindexar” no cabeçalho para o agente voltar a
                    responder pelo que está escrito aqui.
                </p>
            ) : null}

            {exemplosFora.length > 0 ? (
                <p className="text-xs text-muted-foreground">
                    <strong className="font-semibold text-foreground">
                        “{exemplosFora.join('”, “')}” não vai para o acervo.
                    </strong>{' '}
                    Exemplo de resposta orienta o estilo; no acervo ele seria recuperado como
                    fato e repetido {comArtigo(v, 'pessoa', 'a')} — inclusive na pergunta errada. O texto fica
                    guardado aqui.
                </p>
            ) : null}

            {excedeu ? (
                <p className="text-xs text-destructive">
                    Passou do teto em {(usado - doc.teto).toLocaleString('pt-BR')} caracteres.{' '}
                    {doc.modo === 'prompt'
                        ? 'Este documento vai em toda mensagem — o teto existe para uma resposta não ficar pior por causa de texto demais.'
                        : 'Reduza para salvar.'}
                </p>
            ) : null}
        </div>
    )
}
