import { NextRequest, NextResponse } from 'next/server'

/**
 * O código que a clínica cola no site dela.
 *
 * Servido como JavaScript de uma rota, e não como arquivo estático, por um
 * motivo: ele precisa saber a própria origem para falar com esta API, e a
 * origem muda entre ambientes.
 *
 * **Escrito sem framework e sem dependência**, porque roda no site de outra
 * pessoa: carregar React na página de um cliente para desenhar uma bolha de
 * conversa seria cobrar dele o peso da nossa escolha de ferramenta.
 *
 * E tudo dentro de um Shadow DOM: o CSS do site da clínica não entra, o nosso
 * não vaza. Sem isso, um `* { box-sizing }` qualquer no site dela desmonta o
 * nosso balão, e o nosso `button {}` mexeria nos botões dela.
 *
 * **Sempre claro, nunca seguindo o tema do sistema.** Havia aqui um bloco de
 * `prefers-color-scheme: dark`, e numa página clara da clínica ele desenhava um
 * painel escuro destoando de tudo em volta — visto numa prova. Quem dá o
 * contexto visual é o site onde o widget está colado, não o sistema operacional
 * de quem visita; é também o que Intercom e Crisp fazem. O painel tem fundo e
 * borda próprios, então se sustenta sobre página clara ou escura.
 */

const SCRIPT = (origem: string) => `(function () {
  'use strict'
  var atual = document.currentScript
  var chave = atual && atual.getAttribute('data-key')
  if (!chave) { console.warn('[OdontoBox360] falta data-key no script do widget'); return }

  var ORIGEM = ${JSON.stringify(origem)}
  var API = ORIGEM + '/api/widget/' + encodeURIComponent(chave)
  var GUARDA = 'ob360_visitante_' + chave

  function leChave() { try { return localStorage.getItem(GUARDA) } catch (e) { return null } }
  function gravaChave(v) { try { localStorage.setItem(GUARDA, v) } catch (e) {} }

  var visitante = leChave()
  var aberto = false
  var buscando = null
  var info = null
  /** Os ids que já estão na tela, para a busca não repetir o que já desenhou. */
  var vistos = Object.create(null)
  /**
   * As bolhas desenhadas antes de o servidor confirmar.
   *
   * A mensagem do visitante aparece na hora — esperar o ida-e-volta para ver o
   * que se acabou de digitar parece travamento. Quando a mesma mensagem volta do
   * servidor, ela **adota** a bolha que já está lá em vez de desenhar outra;
   * sem isso o texto aparecia duas vezes.
   */
  var pendentes = []

  var host = document.createElement('div')
  host.setAttribute('data-ob360', '')
  document.body.appendChild(host)
  var raiz = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host

  var estilo = document.createElement('style')
  estilo.textContent = [
    /* A cor e o lado vêm da configuração, por variável de CSS. Trocar a cor
       deixa de exigir reescrever cinco regras — e, mais importante, o estilo é
       escrito UMA vez, antes de a configuração chegar: o widget não repinta na
       frente do visitante. */
    ':host, * { box-sizing: border-box; }',
    ':host { --cor: #06B6D4; --sobre-cor: #0B1F3B; }',
    '.bolha { position: fixed; bottom: 20px; z-index: 2147483000; }',
    '.bolha.dir { right: 20px; } .bolha.esq { left: 20px; }',
    '.botao { height: 56px; min-width: 56px; border-radius: 999px; border: 0; cursor: pointer;',
    '  background: var(--cor); color: var(--sobre-cor); box-shadow: 0 6px 24px rgba(0,0,0,.22);',
    '  display: flex; align-items: center; gap: 10px; padding: 0; justify-content: center;',
    '  font: 600 14px/1 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;',
    '  transition: transform .15s; }',
    '.botao:hover { transform: scale(1.04); }',
    /* Balão: o mesmo botão, com a saudação ao lado do retrato. Dois formatos e
       um componente — o balão é a bolha que também fala. */
    '.botao.balao { border-radius: 28px; padding: 0 18px 0 8px; max-width: min(300px, calc(100vw - 48px)); }',
    '.botao .rotulo { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: left; }',
    '.retrato { width: 40px; height: 40px; border-radius: 999px; object-fit: cover; object-position: center; flex: 0 0 40px; background: rgba(0,0,0,.12); }',
    '.botao:not(.balao) .retrato { width: 34px; height: 34px; flex-basis: 34px; }',
    '.painel { position: fixed; bottom: 88px; width: 352px; max-width: calc(100vw - 32px);',
    '  height: 520px; max-height: calc(100vh - 120px); background: #fff; border-radius: 14px;',
    '  box-shadow: 0 12px 48px rgba(0,0,0,.26); display: flex; flex-direction: column;',
    '  overflow: hidden; font: 14px/1.45 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;',
    '  color: #0B1F3B; z-index: 2147483000; }',
    '.painel.dir { right: 20px; } .painel.esq { left: 20px; }',
    '.topo { background: var(--cor); color: var(--sobre-cor); padding: 12px 14px; display: flex; gap: 10px; align-items: center; }',
    '.topo .nome { font-weight: 600; }',
    '.topo .sub { font-size: 12px; opacity: .78; }',
    '.fechar { margin-left: auto; background: none; border: 0; color: inherit; font-size: 20px; cursor: pointer; opacity: .8; }',
    '.corpo { flex: 1; overflow-y: auto; padding: 14px; background: #F8FBFD; display: flex; flex-direction: column; gap: 8px; }',
    '.msg { max-width: 82%; padding: 9px 12px; border-radius: 12px; white-space: pre-wrap; word-break: break-word; }',
    '.deles { background: #fff; border: 1px solid #E3EAF0; align-self: flex-start; border-bottom-left-radius: 4px; }',
    '.meu { background: var(--cor); color: var(--sobre-cor); align-self: flex-end; border-bottom-right-radius: 4px; }',
    '.aviso { font-size: 12px; color: #5B6B7C; text-align: center; padding: 6px 10px; }',
    '.pe { display: flex; gap: 8px; padding: 10px; border-top: 1px solid #E3EAF0; background: #fff; }',
    '.campo { flex: 1; border: 1px solid #D5E0E8; border-radius: 9px; padding: 9px 11px; font: inherit; resize: none; max-height: 90px; }',
    '.campo:focus { outline: 2px solid var(--cor); outline-offset: -1px; }',
    '.enviar { border: 0; background: var(--cor); color: var(--sobre-cor); border-radius: 9px; padding: 0 15px; cursor: pointer; font-weight: 600; }',
    '.enviar:disabled { opacity: .45; cursor: default; }',
    /* O formulário de captura: um cartão dentro da conversa, não uma tela
       antes dela. O visitante já vê a saudação e já sabe com quem fala. */
    '.ficha { background: #fff; border: 1px solid #E3EAF0; border-radius: 10px; padding: 11px; display: flex; flex-direction: column; gap: 6px; }',
    '.ficha p { margin: 0 0 2px; font-size: 12px; color: #5B6B7C; }',
    '.ficha input { border: 1px solid #D5E0E8; border-radius: 8px; padding: 8px 10px; font: inherit; }',
    '.ficha input:focus { outline: 2px solid var(--cor); outline-offset: -1px; }',
    '.ficha button { margin-top: 2px; border: 0; background: var(--cor); color: var(--sobre-cor); border-radius: 8px; padding: 9px; cursor: pointer; font: 600 14px/1 inherit; }',
    '.pular { background: none !important; color: #5B6B7C !important; font-weight: 400 !important; padding: 4px !important; text-decoration: underline; }',
  ].join('\\n')
  raiz.appendChild(estilo)

  var caixa = document.createElement('div')
  caixa.className = 'bolha dir'
  caixa.innerHTML = '<button class="botao" aria-label="Abrir conversa"></button>'
  raiz.appendChild(caixa)
  var botao = caixa.querySelector('.botao')

  var painel = null, corpo = null, campo = null, enviar = null
  /** A ficha de contato já foi respondida ou pulada nesta conversa? */
  var fichaResolvida = false
  var lead = null

  function escapa(t) { var d = document.createElement('div'); d.textContent = t || ''; return d.innerHTML }

  /** Só o retrato quando há foto; senão, a inicial do nome num disco. */
  function retrato() {
    if (info && info.avatar) return '<img class="retrato" src="' + escapa(info.avatar) + '" alt="">'
    var inicial = (info && info.agentName ? info.agentName.trim().charAt(0) : '?').toUpperCase()
    return '<span class="retrato" aria-hidden="true" style="display:flex;align-items:center;justify-content:center;font-weight:700">' + escapa(inicial) + '</span>'
  }

  /**
   * A cor escolhida decide a cor do texto que vai por cima dela.
   *
   * O painel tinha o texto branco fixo sobre o topo; com a clínica escolhendo a
   * cor, um amarelo ou um verde-água deixam o branco ilegível. A conta é a
   * luminância relativa do WCAG, e o corte em 0,55 é o ponto em que o preto
   * passa a contrastar mais que o branco. Sem isto, "escolha sua cor" seria
   * "escolha sua cor, e torça".
   */
  function sobre(cor) {
    var h = String(cor || '').replace('#', '')
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
    if (h.length !== 6) return '#0B1F3B'
    var c = [0, 2, 4].map(function (i) {
      var v = parseInt(h.substr(i, 2), 16) / 255
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
    })
    var l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
    return l > 0.55 ? '#0B1F3B' : '#FFFFFF'
  }

  /** Aplica no DOM o que a configuração mandou. Chamado uma vez, ao chegar. */
  function aplica() {
    var lado = info && info.posicao === 'esquerda' ? 'esq' : 'dir'
    caixa.className = 'bolha ' + lado

    // As variáveis vão no HOST do shadow root: a regra :host as lê de lá, e ele
    // é o único elemento do documento da clínica que nos pertence.
    // (Sem crase nos comentários daqui para dentro: este bloco inteiro é um
    // template literal do TypeScript, e uma crase solta FECHA a string — o
    // arquivo deixa de compilar com "Expected a semicolon" cem linhas abaixo.)
    if (info && info.cor) {
      host.style.setProperty('--cor', info.cor)
      host.style.setProperty('--sobre-cor', sobre(info.cor))
    }

    var ehBalao = info && info.formato === 'balao'
    botao.className = 'botao' + (ehBalao ? ' balao' : '')
    botao.innerHTML = ehBalao
      ? retrato() + '<span class="rotulo">' + escapa(info.greeting || 'Fale com a gente') + '</span>'
      : retrato()
    botao.setAttribute('aria-label', 'Abrir conversa com ' + ((info && info.agentName) || 'a equipe'))
  }

  function desenhaPainel() {
    painel = document.createElement('div')
    painel.className = 'painel ' + (info && info.posicao === 'esquerda' ? 'esq' : 'dir')
    painel.setAttribute('role', 'dialog')
    painel.setAttribute('aria-label', 'Conversa com ' + (info && info.agentName ? info.agentName : 'a equipe'))
    painel.innerHTML =
      '<div class="topo">' +
        retrato() +
        '<div><div class="nome"></div><div class="sub"></div></div>' +
        '<button class="fechar" aria-label="Fechar conversa">&times;</button>' +
      '</div>' +
      '<div class="corpo" aria-live="polite"></div>' +
      '<div class="pe">' +
        '<textarea class="campo" rows="1" placeholder="Escreva sua mensagem" aria-label="Sua mensagem"></textarea>' +
        '<button class="enviar">Enviar</button>' +
      '</div>'
    raiz.appendChild(painel)
    painel.querySelector('.nome').textContent = (info && info.agentName) || 'Atendimento'
    painel.querySelector('.sub').textContent = (info && info.clinicName) || ''
    corpo = painel.querySelector('.corpo')
    campo = painel.querySelector('.campo')
    enviar = painel.querySelector('.enviar')
    painel.querySelector('.fechar').addEventListener('click', alterna)
    enviar.addEventListener('click', manda)
    campo.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); manda() }
    })
    if (info && info.greeting) poe('clinic', info.greeting)
    if (info && info.active === false) {
      var a = document.createElement('div')
      a.className = 'aviso'
      a.textContent = 'A equipe responde assim que possível.'
      corpo.appendChild(a)
    }
    desenhaFicha()
  }

  /** Quais campos a clínica pediu. Vazio = sem captura. */
  function camposDaFicha() {
    var c = (info && info.captura) || {}
    var campos = []
    if (c.nome) campos.push({ chave: 'nome', rotulo: 'Seu nome', tipo: 'text', auto: 'name' })
    if (c.whatsapp) campos.push({ chave: 'whatsapp', rotulo: 'Seu WhatsApp', tipo: 'tel', auto: 'tel' })
    if (c.email) campos.push({ chave: 'email', rotulo: 'Seu e-mail', tipo: 'email', auto: 'email' })
    return campos
  }

  /**
   * A ficha de contato, **dentro** da conversa.
   *
   * Não é uma tela antes do atendimento: o visitante já leu a saudação e já
   * sabe com quem fala quando ela aparece. Formulário na porta é o que faz
   * metade das pessoas fechar a aba.
   *
   * Obrigatória, ela esconde o campo de texto até ser respondida — é o que a
   * clínica escolheu. Opcional, ela traz "Agora não" e sai do caminho; o lead
   * ainda pode ser preenchido depois, porque o servidor completa o contato em
   * vez de só criá-lo.
   */
  function desenhaFicha() {
    var campos = camposDaFicha()
    if (campos.length === 0 || fichaResolvida) return

    var obrigatoria = !!(info && info.captura && info.captura.obrigatorio)
    if (obrigatoria) painel.querySelector('.pe').style.display = 'none'

    var ficha = document.createElement('form')
    ficha.className = 'ficha'
    var html = '<p>' + (obrigatoria ? 'Para começar, me diga:' : 'Quer que a gente retome depois? Deixe seu contato:') + '</p>'
    for (var i = 0; i < campos.length; i++) {
      html += '<input name="' + campos[i].chave + '" type="' + campos[i].tipo +
        '" autocomplete="' + campos[i].auto + '" placeholder="' + campos[i].rotulo +
        '" aria-label="' + campos[i].rotulo + '"' + (obrigatoria ? ' required' : '') + '>'
    }
    html += '<button type="submit">' + (obrigatoria ? 'Começar conversa' : 'Enviar contato') + '</button>'
    if (!obrigatoria) html += '<button type="button" class="pular">Agora não</button>'
    ficha.innerHTML = html
    corpo.appendChild(ficha)
    corpo.scrollTop = corpo.scrollHeight

    function fecha() {
      fichaResolvida = true
      ficha.remove()
      painel.querySelector('.pe').style.display = ''
      if (campo) campo.focus()
    }

    ficha.addEventListener('submit', function (e) {
      e.preventDefault()
      lead = {}
      for (var k = 0; k < campos.length; k++) {
        var el = ficha.querySelector('[name="' + campos[k].chave + '"]')
        if (el && el.value.trim()) lead[campos[k].chave] = el.value.trim()
      }
      fecha()
    })

    var pular = ficha.querySelector('.pular')
    if (pular) pular.addEventListener('click', fecha)
  }

  function poe(de, texto) {
    var el = document.createElement('div')
    el.className = 'msg ' + (de === 'visitor' ? 'meu' : 'deles')
    el.textContent = texto
    corpo.appendChild(el)
    corpo.scrollTop = corpo.scrollHeight
    return el
  }

  function alterna() {
    aberto = !aberto
    if (aberto) {
      if (!painel) desenhaPainel()
      painel.style.display = 'flex'
      campo.focus()
      busca()
      if (!buscando) buscando = setInterval(busca, 3000)
    } else {
      if (painel) painel.style.display = 'none'
      if (buscando) { clearInterval(buscando); buscando = null }
    }
  }

  function busca() {
    if (!visitante || !corpo) return
    fetch(API + '/messages?visitor=' + encodeURIComponent(visitante))
      .then(function (r) { return r.ok ? r.json() : null })
      .then(function (d) {
        if (!d || !d.messages) return
        for (var i = 0; i < d.messages.length; i++) {
          var m = d.messages[i]
          if (vistos[m.id]) continue
          vistos[m.id] = true
          // A própria mensagem do visitante já está na tela: a bolha otimista
          // assume o id do servidor em vez de nascer uma segunda igual.
          var j = m.from === 'visitor' ? pendentes.indexOf(m.content) : -1
          if (j !== -1) { pendentes.splice(j, 1); continue }
          poe(m.from, m.content)
        }
      })
      .catch(function () {})
  }

  function manda() {
    var texto = (campo.value || '').trim()
    if (!texto) return
    campo.value = ''
    enviar.disabled = true
    poe('visitor', texto)
    pendentes.push(texto)
    fetch(API + '/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // O lead vai junto da mensagem, e só até o servidor confirmar: mandá-lo
      // em toda mensagem seria repetir a mesma escrita de contato a cada frase.
      body: JSON.stringify({ visitor: visitante, content: texto, lead: lead || undefined }),
    })
      .then(function (r) { return r.json() })
      .then(function (d) {
        if (d && d.visitor) { visitante = d.visitor; gravaChave(visitante) }
        lead = null
        // A própria mensagem já está na tela; a busca não deve repeti-la.
        setTimeout(busca, 1200)
      })
      .catch(function () {
        poe('clinic', 'Não consegui enviar. Tente de novo em instantes.')
      })
      .finally(function () { enviar.disabled = false; campo.focus() })
  }

  botao.addEventListener('click', alterna)

  /**
   * O widget só aparece depois de a clínica confirmar que está ligado.
   *
   * A bolha nasce escondida e só se mostra quando esta busca responde. Se o
   * canal estiver desligado — ou a chave não existir mais — ela some da página,
   * em vez de oferecer uma conversa que não vai a lugar nenhum: a tag do script
   * continua colada no site da clínica mesmo depois de ela desligar o widget, e
   * o visitante não tem como saber que está falando com o vazio.
   *
   * Medido: antes disto, com o canal desligado, o painel abria dizendo
   * "Atendimento", aceitava texto e engolia tudo em silêncio.
   */
  caixa.style.display = 'none'
  fetch(API)
    .then(function (r) { return r.ok ? r.json() : null })
    .then(function (d) {
      if (!d) { host.remove(); return }
      info = d
      aplica()
      caixa.style.display = ''
    })
    .catch(function () { host.remove() })
})()`

/**
 * A origem pública da aplicação, como o navegador do visitante a enxerga.
 *
 * **`new URL(request.url).origin` não serve aqui.** Atrás do Traefik ele devolve
 * o endereço interno em que o contêiner escuta — medido em produção:
 * `https://0.0.0.0:3000`. O script saía com esse endereço embutido, e o widget
 * no site da clínica tentava falar com uma máquina que não existe para ele:
 * `ERR_CONNECTION_REFUSED`, sem nenhuma outra pista.
 *
 * A ordem é: o que a aplicação declara ser; depois o que o proxy diz que o
 * cliente pediu; e só então a requisição, para o caso de rodar sem proxy nenhum.
 */
function origemPublica(request: NextRequest): string {
    const declarada = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '')
    if (declarada) return declarada

    const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
    if (host) {
        const protocolo = request.headers.get('x-forwarded-proto') ?? 'https'
        return `${protocolo}://${host}`
    }

    return new URL(request.url).origin
}

export async function GET(request: NextRequest) {
    const origem = origemPublica(request)
    return new NextResponse(SCRIPT(origem), {
        headers: {
            'Content-Type': 'application/javascript; charset=utf-8',
            // Curto de propósito: a clínica cola o script uma vez e nunca mais
            // pensa nele, então uma correção precisa chegar sem ela fazer nada.
            'Cache-Control': 'public, max-age=300',
            'Access-Control-Allow-Origin': '*',
        },
    })
}

export const dynamic = 'force-dynamic'
