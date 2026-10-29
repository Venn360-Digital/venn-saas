'use client'

import { useRef } from 'react'
import { AlertTriangle, Check, Download, FileUp, ListPlus, Wand2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
    conferirEstrutura,
    modeloDoDocumento,
    type DocumentoDeTreinamento as Doc,
} from '@/lib/treinamento/documentos'
import { secionarMarkdown, semComentarios } from '@/lib/rag/secoes'
import { gerarRascunho, type CamposAntigos } from '@/lib/treinamento/gerar'
import { cn } from '@/lib/utils'

/**
 * O campo padrão da central de treinamento — um documento em Markdown.
 *
 * É o mesmo componente nos sete assuntos, desenhado a partir do catálogo
 * (`src/lib/treinamento/documentos.ts`): o que muda entre eles é dado, não
 * código. Acrescentar o oitavo documento é acrescentar uma entrada no catálogo.
 *
 * **Sem título dentro do conteúdo**, por decisão do DESIGN.md (Tela 03): a linha
 * das seções já diz onde se está e o índice já diz o assunto; um título aqui
 * seria a mesma palavra uma terceira vez. Fica a frase que explica o que ali se
 * faz.
 *
 * Quatro coisas que a tela precisa dizer, e que o método não funciona sem:
 *
 *   - **Onde o documento age.** "Vai em toda mensagem" e "é consultado quando a
 *     conversa pede" levam a escrever coisas diferentes. Sem isso dito no campo,
 *     a pessoa descobre pelo resultado.
 *   - **Quanto cabe.** O teto dos documentos de prompt é o que protege a conta
 *     inteira: um manual de cinquenta páginas em Instruções centrais degrada
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
    somenteLeitura?: boolean
    /**
     * Os campos antigos do cadastro, para o rascunho da transição.
     *
     * Ausente, o botão não aparece. O rascunho preenche o campo **na tela** e
     * nada é gravado até a pessoa salvar — script contra o banco escreveria em
     * produção antes de alguém conferir, e o que está aqui é o que o agente vai
     * dizer ao paciente.
     */
    camposAntigos?: CamposAntigos
}

export function DocumentoDeTreinamento({
    doc,
    valor,
    onChange,
    indexadoEm,
    trechos,
    somenteLeitura = false,
    camposAntigos,
}: Props) {
    const entrada = useRef<HTMLInputElement>(null)
    const rascunho = camposAntigos ? gerarRascunho(doc.slug, camposAntigos) : null

    const usado = valor.length
    const excedeu = usado > doc.teto
    /* Avisa antes de estourar: descobrir o teto ao salvar é descobrir tarde. */
    const perto = !excedeu && usado > doc.teto * 0.9

    /**
     * A conferência roda sobre o texto **sem comentário** e pelo **corte real**.
     *
     * É a mesma função que o indexador usa. Conferir o texto cru diria que a
     * seção existe quando o corte não a vê — e o que importa é o que o agente
     * vai conseguir recuperar, não o que está escrito na tela.
     */
    const estrutura = conferirEstrutura(doc, secionarMarkdown(semComentarios(valor)))
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
                <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-[12.5px] text-muted-foreground">{doc.explicacao}</p>
                    <p className="text-xs text-muted-foreground">
                        {doc.modo === 'prompt' ? (
                            <>
                                <strong className="font-semibold text-foreground">
                                    Vai em toda mensagem.
                                </strong>{' '}
                                Escreva a regra, não o manual.
                            </>
                        ) : (
                            <>
                                <strong className="font-semibold text-foreground">
                                    Consultado quando a conversa pede.
                                </strong>{' '}
                                Um subtítulo por assunto — é o subtítulo que vira um trecho.
                            </>
                        )}
                    </p>
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
                            onClick={() => onChange(modeloDoDocumento(doc))}
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
                        {rascunho ? (
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8"
                                onClick={() => onChange(rascunho)}
                                // Mesmo cuidado do modelo: não apaga texto escrito.
                                disabled={temConteudo}
                                title={
                                    temConteudo
                                        ? 'O rascunho só entra no campo vazio, para não apagar o que você escreveu'
                                        : 'Monta um rascunho a partir do que já está no cadastro do agente'
                                }
                            >
                                <Wand2 className="size-4" aria-hidden="true" />
                                Gerar do cadastro
                            </Button>
                        ) : null}
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
                placeholder={`Cole aqui o ${doc.titulo.toLowerCase()} em Markdown, ou use "Inserir modelo".`}
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
                        <span className="text-muted-foreground">
                            Indexado em {trechos?.toLocaleString('pt-BR')} trecho
                            {trechos === 1 ? '' : 's'},{' '}
                            {new Date(indexadoEm).toLocaleString('pt-BR', {
                                day: '2-digit',
                                month: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit',
                            })}
                        </span>
                    ) : temConteudo ? (
                        <span className="text-warning-subtle-foreground">
                            Escrito e ainda não indexado — salve para o agente aprender
                        </span>
                    ) : null}
                </div>

                {temConteudo ? (
                    estrutura.faltando.length > 0 ? (
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                            <AlertTriangle
                                className="size-3.5 shrink-0 text-warning-subtle-foreground"
                                aria-hidden="true"
                            />
                            Sem conteúdo em: {estrutura.faltando.join(', ')}
                        </span>
                    ) : (
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                            <Check className="size-3.5 shrink-0" aria-hidden="true" />
                            Todas as seções preenchidas
                        </span>
                    )
                ) : null}
            </div>

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
