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
  var ultimoId = null
  var buscando = null
  var info = null

  var host = document.createElement('div')
  host.setAttribute('data-ob360', '')
  document.body.appendChild(host)
  var raiz = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host

  var estilo = document.createElement('style')
  estilo.textContent = [
    ':host, * { box-sizing: border-box; }',
    '.bolha { position: fixed; right: 20px; bottom: 20px; z-index: 2147483000; }',
    '.botao { width: 56px; height: 56px; border-radius: 999px; border: 0; cursor: pointer;',
    '  background: #06B6D4; color: #fff; box-shadow: 0 6px 24px rgba(0,0,0,.22);',
    '  display: grid; place-items: center; font-size: 24px; transition: transform .15s; }',
    '.botao:hover { transform: scale(1.05); }',
    '.painel { position: fixed; right: 20px; bottom: 88px; width: 352px; max-width: calc(100vw - 32px);',
    '  height: 520px; max-height: calc(100vh - 120px); background: #fff; border-radius: 14px;',
    '  box-shadow: 0 12px 48px rgba(0,0,0,.26); display: flex; flex-direction: column;',
    '  overflow: hidden; font: 14px/1.45 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;',
    '  color: #0B1F3B; z-index: 2147483000; }',
    '.topo { background: #0B1F3B; color: #fff; padding: 14px 16px; display: flex; gap: 10px; align-items: center; }',
    '.topo .nome { font-weight: 600; }',
    '.topo .sub { font-size: 12px; opacity: .72; }',
    '.fechar { margin-left: auto; background: none; border: 0; color: #fff; font-size: 20px; cursor: pointer; opacity: .8; }',
    '.corpo { flex: 1; overflow-y: auto; padding: 14px; background: #F8FBFD; display: flex; flex-direction: column; gap: 8px; }',
    '.msg { max-width: 82%; padding: 9px 12px; border-radius: 12px; white-space: pre-wrap; word-break: break-word; }',
    '.deles { background: #fff; border: 1px solid #E3EAF0; align-self: flex-start; border-bottom-left-radius: 4px; }',
    '.meu { background: #06B6D4; color: #fff; align-self: flex-end; border-bottom-right-radius: 4px; }',
    '.aviso { font-size: 12px; color: #5B6B7C; text-align: center; padding: 6px 10px; }',
    '.pe { display: flex; gap: 8px; padding: 10px; border-top: 1px solid #E3EAF0; background: #fff; }',
    '.campo { flex: 1; border: 1px solid #D5E0E8; border-radius: 9px; padding: 9px 11px; font: inherit; resize: none; max-height: 90px; }',
    '.campo:focus { outline: 2px solid #06B6D4; outline-offset: -1px; }',
    '.enviar { border: 0; background: #06B6D4; color: #fff; border-radius: 9px; padding: 0 15px; cursor: pointer; font-weight: 600; }',
    '.enviar:disabled { opacity: .45; cursor: default; }',
    '@media (prefers-color-scheme: dark) {',
    '  .painel { background: #0F1B26; color: #E8EFF4; }',
    '  .corpo { background: #0B1620; }',
    '  .deles { background: #16242F; border-color: #24323D; }',
    '  .pe { background: #0F1B26; border-color: #24323D; }',
    '  .campo { background: #16242F; border-color: #2B3946; color: inherit; }',
    '}',
  ].join('\\n')
  raiz.appendChild(estilo)

  var caixa = document.createElement('div')
  caixa.className = 'bolha'
  caixa.innerHTML = '<button class="botao" aria-label="Abrir conversa">&#128172;</button>'
  raiz.appendChild(caixa)
  var botao = caixa.querySelector('.botao')

  var painel = null, corpo = null, campo = null, enviar = null

  function desenhaPainel() {
    painel = document.createElement('div')
    painel.className = 'painel'
    painel.setAttribute('role', 'dialog')
    painel.setAttribute('aria-label', 'Conversa com ' + (info && info.agentName ? info.agentName : 'a clínica'))
    painel.innerHTML =
      '<div class="topo">' +
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
  }

  function poe(de, texto) {
    var el = document.createElement('div')
    el.className = 'msg ' + (de === 'visitor' ? 'meu' : 'deles')
    el.textContent = texto
    corpo.appendChild(el)
    corpo.scrollTop = corpo.scrollHeight
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
    if (!visitante) return
    fetch(API + '/messages?visitor=' + encodeURIComponent(visitante))
      .then(function (r) { return r.ok ? r.json() : null })
      .then(function (d) {
        if (!d || !d.messages) return
        var novas = ultimoId
          ? d.messages.slice(d.messages.findIndex(function (m) { return m.id === ultimoId }) + 1)
          : d.messages
        for (var i = 0; i < novas.length; i++) poe(novas[i].from, novas[i].content)
        if (d.messages.length) ultimoId = d.messages[d.messages.length - 1].id
      })
      .catch(function () {})
  }

  function manda() {
    var texto = (campo.value || '').trim()
    if (!texto) return
    campo.value = ''
    enviar.disabled = true
    poe('visitor', texto)
    fetch(API + '/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitor: visitante, content: texto }),
    })
      .then(function (r) { return r.json() })
      .then(function (d) {
        if (d && d.visitor) { visitante = d.visitor; gravaChave(visitante) }
        // A própria mensagem já está na tela; a busca não deve repeti-la.
        setTimeout(busca, 1200)
      })
      .catch(function () {
        poe('clinic', 'Não consegui enviar. Tente de novo em instantes.')
      })
      .finally(function () { enviar.disabled = false; campo.focus() })
  }

  botao.addEventListener('click', alterna)

  fetch(API)
    .then(function (r) { return r.ok ? r.json() : null })
    .then(function (d) { info = d })
    .catch(function () {})
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
