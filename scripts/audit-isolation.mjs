#!/usr/bin/env node
/**
 * audit-isolation.mjs — Auditoria estática de isolamento entre apps (Odontobox360 / Stagent360 / Conecta360)
 *
 * Falha (exit 1) quando o repositório:
 *   1. tem um `infra/manifest/<app>.json` que cita identificador de OUTRO app —
 *      é dali que o portão de deploy tira o que comparar, e um endpoint Neon
 *      alheio aprovaria um deploy apontado para o banco errado;
 *   2. tem, em `apps/<X>/`, identificador de outro app; ou, fora de `apps/`,
 *      identificador de app que não mora neste repositório;
 *   2b. tem identidade de app NENHUM dentro de `packages/**` — é o que força
 *      texto novo a nascer pela marca e pelo vocabulário;
 *   3. (removida — ver a nota no lugar dela; quem faz o trabalho é
 *      `scripts/check-recursos.ts`, passo 6 do portão).
 *
 * O escopo vem do CAMINHO, e o dono é DERIVADO (do nome da pasta em `apps/`, do
 * nome do arquivo em `infra/manifest/`), nunca adivinhado por prefixo —
 * `odontobox360` não começa igual a `odontobox`.
 *
 * Uso:
 *   node scripts/audit-isolation.mjs            # placeholders __FASE07__ aceitos (Fases 05-06)
 *   node scripts/audit-isolation.mjs --strict   # placeholders proibidos (Fase 07 em diante e no CI)
 *
 * Sem dependências externas. Node >= 18.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, relative, extname, basename } from 'node:path';
import { manifestos } from './lib/manifestos.mjs';

const ROOT = process.cwd();
/**
 * `--strict` é o modo do PORTÃO DE DEPLOY, e tem de significar algo.
 *
 * O único efeito dele vivia dentro da regra 3 (placeholders `__FASE07__` eram
 * erro em strict e aviso fora). Removida a regra, o flag ficou decorativo: o
 * portão continuaria passando `--strict` e o comportamento seria idêntico ao
 * modo frouxo. Flag oco num portão é pior que flag ausente, porque documenta
 * uma garantia que não existe.
 *
 * Agora ele significa: **todo app aqui tem os TRÊS** — pasta em `apps/`,
 * manifesto em `infra/manifest/` e fingerprint em `infra/fingerprints/`.
 *
 * Os três são o que torna o escopo por dono possível: a pasta diz onde o
 * código mora, o manifesto diz o que o deploy deve usar, o fingerprint diz
 * quais strings são identidade dele. Falte um e as regras deste arquivo
 * passam a proteger menos do que parecem — um manifesto sem fingerprint, por
 * exemplo, não é conferido por ninguém, porque a regra 1 escopa comparando com
 * os tokens dos OUTROS e a identidade dele não está listada em lugar nenhum.
 *
 * Fora do strict isso é aviso, de propósito: criar um app é vários commits, e
 * rodar a auditoria no meio do caminho tem de ser possível. O que não pode é
 * um app a meio caminho CHEGAR AO DEPLOY — e é o portão que passa `--strict`.
 *
 * Também vale para frente: aviso novo acrescentado a este arquivo passa a
 * barrar o deploy por construção, em vez de virar ruído permanente que ninguém
 * lê — foi o que aconteceu com "validação de bindings ignorada", impressa em
 * todo build por meses.
 */
const STRICT = process.argv.includes('--strict');
const FINGERPRINT_DIR = 'infra/fingerprints';

const IGNORE_DIRS = new Set([
  '.git', 'node_modules', '.wrangler', '.open-next', '.next', 'dist', 'build',
  'coverage', '.turbo', '.vercel', '.cache',
  // `.claude/` carrega worktrees locais com CÓPIAS de infra/ (fingerprints dos
  // outros apps inclusive) — era a fonte de 347 "erros" no --strict desta
  // máquina, nenhum deles do código publicado. No CI o diretório nem existe.
  '.claude',
]);
// Caminhos onde menções a outros apps são legítimas (documentação, inventários, listas proibidas)
const IGNORE_PREFIXES = [
  'infra/runbook/', 'infra/fingerprints/', 'infra/inventory/', 'infra/reports/',
  /*
   * `infra/manifest/<slug>.json` é a identidade DECLARADA de cada app: ele tem
   * de poder dizer o próprio nome. Quem confere que ele não diz o nome dos
   * outros é a regra 1, arquivo por arquivo, com o dono vindo do nome do
   * arquivo — mesma divisão de trabalho dos fingerprints acima.
   */
  'infra/manifest/',
  'scripts/audit-isolation.mjs',
  /*
   * Migração APLICADA é imutável: editar o arquivo muda o checksum e o
   * `prisma migrate deploy` passa a recusar o ambiente onde ela já rodou. A de
   * `app_identity` grava o slug do app como sentinela — é o dado que o smoke de
   * identidade compara, e ele existe justamente para ser o nome deste app.
   */
  'packages/db/prisma/migrations/',
];
const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico', '.pdf', '.woff', '.woff2',
  '.ttf', '.otf', '.eot', '.zip', '.gz', '.tgz', '.mp4', '.mp3', '.wav', '.webm', '.lockb', '.wasm',
]);

const errors = [];
const warnings = [];
const err = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

// ---------- utilidades ----------
function readJson(path) {
  if (!existsSync(path)) {
    console.error(`✖ Arquivo obrigatório ausente: ${path}`);
    process.exit(2);
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    console.error(`✖ JSON inválido em ${path}: ${e.message}`);
    process.exit(2);
  }
}

function deepStrings(value, acc = []) {
  if (typeof value === 'string') acc.push(value);
  else if (Array.isArray(value)) value.forEach((v) => deepStrings(v, acc));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => deepStrings(v, acc));
  return acc;
}



/**
 * A lista de arquivos vem do GIT, não do disco — e isso foi um conserto.
 *
 * A varredura por diretório lia tudo que estivesse na pasta, inclusive o que o
 * git nem rastreia: logs de sessão (`.playwright-mcp/`), worktrees em
 * `.claude/`, anotações soltas. Medido em 01/11: 347 "erros" no `--strict`
 * desta máquina, **zero** deles em código publicável — e o portão de deploy
 * usa `--strict`, então a auditoria reprovava um deploy por causa de um log
 * local. O contêiner de build clona o repositório limpo: o que define o que é
 * auditável é o índice do git, e agora o local confere exatamente o mesmo
 * conjunto que o CI confere.
 *
 * O `walk` fica como reserva para ambiente sem git.
 */
/**
 * Os arquivos do repositório — rastreados **e os novos ainda não rastreados**.
 *
 * Era só `git ls-files`, e isso abria um falso verde que me pegou em 15/11:
 * arquivo recém-criado é invisível a `ls-files` até o `git add`, então rodar a
 * auditoria antes de commitar a aprovava sobre um arquivo que ela **nunca
 * leu** — e o build reprovou no primeiro arquivo novo do lote, por um
 * identificador de app irmão num comentário meu.
 *
 * `--others --exclude-standard` acrescenta o não rastreado respeitando o
 * `.gitignore`, que é o que torna o resultado local igual ao do builder (lá
 * tudo já está commitado). Mesma classe das outras seis formas do defeito de
 * caminho: a verificação olhava um conjunto diferente do que o portão olha.
 */
function arquivosDoGit() {
  const saida = execSync('git ls-files -z --cached --others --exclude-standard', {
    cwd: ROOT,
    maxBuffer: 64 * 1024 * 1024,
  });
  const lista = [];
  for (const rel of saida.toString('utf8').split('\0')) {
    if (!rel) continue;
    const partes = rel.split('/');
    if (partes.some((seg) => IGNORE_DIRS.has(seg))) continue;
    if (IGNORE_PREFIXES.some((p) => rel === p.replace(/\/$/, '') || rel.startsWith(p))) continue;
    let st;
    try { st = statSync(join(ROOT, rel)); } catch { continue; } // deletado localmente
    if (st.isDirectory()) continue;
    lista.push({ rel, binary: BINARY_EXT.has(extname(rel).toLowerCase()) || st.size > 2_000_000 });
  }
  return lista;
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (IGNORE_DIRS.has(name)) continue;
    const full = join(dir, name);
    const rel = relative(ROOT, full).split('\\').join('/');
    if (IGNORE_PREFIXES.some((p) => rel === p.replace(/\/$/, '') || rel.startsWith(p))) continue;
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) walk(full, out);
    else out.push({ rel, binary: BINARY_EXT.has(extname(name).toLowerCase()) || st.size > 2_000_000 });
  }
  return out;
}

// ---------- carga ----------
/**
 * Um manifesto por app (`infra/manifest/<slug>.json`). A validação de forma —
 * existir, ser JSON, o nome do arquivo bater com `app.slug`, declarar os dois
 * ambientes — mora em `scripts/lib/manifestos.mjs`, porque três verificadores
 * dependem dela.
 */
const MANIFESTOS = manifestos();
const SLUGS_DAQUI = new Set(MANIFESTOS.map((m) => m.slug));

const fingerprints = [];
/** TODOS os fingerprints, o dos apps daqui incluídos — a regra por pasta precisa deles. */
const fingerprintsTodos = [];
if (existsSync(FINGERPRINT_DIR)) {
  for (const f of readdirSync(FINGERPRINT_DIR).filter((x) => x.endsWith('.json'))) {
    const fp = readJson(join(FINGERPRINT_DIR, f));
    const fpSlug = fp.slug || basename(f, '.json');
    fingerprintsTodos.push({ file: f, slug: fpSlug, data: fp });
    /*
     * A lista proibida GLOBAL (para caminhos sem dono: `packages/`, `scripts/`,
     * a raiz) é derivada: é o fingerprint de app que **não mora neste
     * repositório**, isto é, que não tem manifesto aqui.
     *
     * Antes era "todos menos o do manifesto", com um manifesto só. Dava o mesmo
     * resultado por acidente de haver um app. Com três, a raiz passa a nomear
     * legitimamente os três — `package.json` já carrega `--expect-slug
     * odontobox` no `migrate:prod` e o `smoke:prod` nomeia o app que publica —,
     * então "todos menos um" reprovaria o orquestrador do monorepo.
     *
     * Quem protege os caminhos sem dono é a regra 2b, que proíbe identidade de
     * app NENHUM em `packages/**`. A lista global cuida do caso diferente e
     * ainda real: o identificador de um app que ainda vive em outro repositório
     * não pode aparecer aqui antes de ele chegar — foi assim que um comentário
     * copiado barrou um deploy em 13/11.
     */
    if (SLUGS_DAQUI.has(fpSlug)) continue;
    fingerprints.push({ file: f, slug: fpSlug, data: fp });
  }
} else {
  /*
   * Erro SEMPRE, e não só em strict: varrer 1200 arquivos contra uma lista
   * vazia relata "nenhum vazamento encontrado" — a forma mais perfeita de
   * falso verde que existe. Não há uso, nem local, em que isso seja aceitável.
   */
  err(`Pasta ${FINGERPRINT_DIR}/ não existe — nenhuma lista proibida carregada, logo nada a encontrar.`);
}
if (fingerprintsTodos.length === 0) {
  err(
    `${FINGERPRINT_DIR}/ não tem nenhum fingerprint — a varredura abaixo compararia cada arquivo contra uma lista vazia e passaria.`
  );
}

/*
 * `warnStrings` NÃO entra aqui, e a razão é um defeito que esta leitura
 * revelou: o radar de termo de nicho **nunca disparou**.
 *
 * Ele era montado a partir de `fingerprints`, que é a lista dos OUTROS apps — e
 * `warnStrings` só existe no fingerprint do odontobox, justamente o que fica
 * fora dessa lista. Dez termos ('odontograma', 'dentista', 'convênio', 'CRO'…)
 * apontados por ninguém, desde sempre.
 *
 * Consertá-lo aqui seria duplicar mal o `lint-vocabulario`, que faz o mesmo
 * trabalho **certo**: separa comentário de código por análise de estado (há 705
 * "paciente" e 1231 "clínica" em prosa de comentário dentro de `packages/`,
 * explicando o domínio — proibi-los ensinaria a escrever código sem
 * explicação), tem teto que só desce e está em zero absoluto. Esta auditoria não
 * analisa comentário: ligar o radar aqui reprovaria 1900 linhas de prosa
 * legítima.
 *
 * Seis dos dez termos já estão cobertos pelos quatro eixos do
 * `lint-vocabulario`. Os outros quatro — 'odontograma', 'odontológico',
 * 'convênio' e 'CRO' — vão para lá no lote dos prompts de IA, e não aqui:
 * medidos fora de comentário, são **12 ocorrências em 5 arquivos**
 * (`treinamento/modelos` 5, `types/agent-creation` 3, `config/app` 2,
 * `conversas/resumo` 1, `follow-up-suggestion` 1) — texto de prompt e um
 * feature flag chamado `odontograma`. Prompt é o que o agente fala com o
 * cliente final: mexer nele pede `test:prompt`, `test:cenarios` e
 * `test:escalada` antes e depois, que é lote próprio por desenho. Entrar no
 * teto junto com eles é o que impede os 12 de virarem 13.
 */
const forbidden = []; // { token, lower, owner }
for (const fp of fingerprints) {
  for (const [key, val] of Object.entries(fp.data)) {
    if (key === 'slug' || key === 'warnStrings' || key.startsWith('$')) continue;
    for (const tk of deepStrings(val).map((s) => s.trim()).filter((s) => s.length >= 3 && !s.startsWith('<'))) {
      forbidden.push({ token: tk, lower: tk.toLowerCase(), owner: fp.slug });
    }
  }
}

/* ----------  0. os três artefatos de cada app  ----------
 *
 * Erro em strict, aviso fora. Ver a nota do `--strict` acima para por que são
 * três e por que a tolerância local é deliberada.
 */
const pastasDeApp = existsSync('apps')
  ? readdirSync('apps').filter((n) => existsSync(join('apps', n, 'cloudflare.config.ts')))
  : [];
const slugsComFingerprint = new Set(fingerprintsTodos.map((fp) => fp.slug));
const cobrar = STRICT ? err : warn;

for (const slug of SLUGS_DAQUI) {
  if (!slugsComFingerprint.has(slug)) {
    cobrar(`o app "${slug}" tem manifesto mas não tem ${FINGERPRINT_DIR}/${slug}.json — sem fingerprint, a identidade dele não é conferida por ninguém.`);
  }
}
for (const fp of fingerprintsTodos) {
  if (!SLUGS_DAQUI.has(fp.slug)) continue; // app de outro repositório: só a lista proibida
  const temPasta = pastasDeApp.some((n) => n.startsWith(fp.slug));
  if (!temPasta) {
    cobrar(`o app "${fp.slug}" tem manifesto e fingerprint mas nenhuma pasta em apps/ com cloudflare.config.ts.`);
  }
}
if (pastasDeApp.length === 0) {
  err('apps/ não tem nenhuma pasta com cloudflare.config.ts — não há app para auditar.');
}

/**
 * De quem é a pasta `apps/<X>/`? Derivado do fingerprint, com fail-fast.
 *
 * Existe porque a regra 1 nasceu mono-app: um slug vindo de um manifesto só, e
 * os outros fingerprints proibidos em TODO o repositório. Com os três apps no
 * mesmo repositório isso deixa de fazer sentido — `apps/stagent360/**` tem de
 * poder dizer "stagent", que é a identidade dele, e tem de NÃO poder dizer
 * "odontobox".
 *
 * O dono não é adivinhado por prefixo (`odontobox360` não começa igual a
 * `odontobox`): é o fingerprint cujo `strings` contém o nome exato da pasta.
 * Zero ou mais de um é erro — um app sem fingerprint não pode ser auditado, e
 * auditar com o dono errado é pior que não auditar.
 */
function donoDaPasta(nomeDaPasta) {
  const candidatos = fingerprintsTodos.filter((fp) =>
    deepStrings(fp.data.strings ?? []).some((t) => t.trim() === nomeDaPasta)
  );
  if (candidatos.length === 1) return candidatos[0].slug;
  err(
    candidatos.length === 0
      ? `apps/${nomeDaPasta}/ não tem fingerprint em ${FINGERPRINT_DIR}/ — crie um antes de auditar o app.`
      : `apps/${nomeDaPasta}/ casa com ${candidatos.length} fingerprints (${candidatos.map((c) => c.slug).join(', ')}) — ambíguo.`
  );
  return null;
}

/** O slug do app a que um caminho pertence, ou null para código compartilhado. */
function appDoCaminho(rel) {
  const m = rel.match(/^apps\/([^/]+)\//);
  if (!m) return null;
  if (!(m[1] in donoPorPasta)) donoPorPasta[m[1]] = donoDaPasta(m[1])
  return donoPorPasta[m[1]];
}
const donoPorPasta = {};

/** Tokens de TODOS os apps, com o dono — para a regra por pasta. */
const todosOsTokens = [];
for (const fp of fingerprintsTodos) {
  for (const [key, val] of Object.entries(fp.data)) {
    if (key === 'slug' || key === 'warnStrings' || key.startsWith('$')) continue;
    for (const t of deepStrings(val).map((x) => x.trim()).filter((x) => x.length >= 3 && !x.startsWith('<'))) {
      todosOsTokens.push({ token: t, lower: t.toLowerCase(), owner: fp.slug });
    }
  }
}

/* ----------  1. colisão manifesto × outros apps  ----------
 *
 * Arquivo por arquivo, e o dono vem do NOME do arquivo. O manifesto de um app
 * pode — tem de — dizer a identidade dele; o que não pode é citar a de outro,
 * porque é dali que o portão de deploy tira o que comparar. Um manifesto com o
 * endpoint Neon do app irmão aprovaria um deploy apontado para o banco errado.
 */
for (const { slug, caminho, dados } of MANIFESTOS) {
  const valores = deepStrings(dados).map((s) => s.toLowerCase()).filter((s) => s.length >= 3);
  const alheios = todosOsTokens.filter((tk) => tk.owner !== slug);
  for (const f of alheios) {
    if (valores.some((v) => v === f.lower || (f.lower.length >= 8 && v.includes(f.lower)))) {
      err(`${caminho} contém "${f.token}", que pertence ao app "${f.owner}"`);
    }
  }
}

// ---------- 2. varredura do repositório ----------
let files;
try { files = arquivosDoGit(); } catch { files = walk(ROOT); }
for (const { rel, binary } of files) {
  const relLower = rel.toLowerCase();
  /*
   * O dono da pasta: dentro de `apps/<X>/` o proibido são os OUTROS apps, não
   * os "outros" do manifesto. Fora de `apps/`, segue a lista global (código
   * compartilhado não fala de app nenhum — e a regra de proibir TODOS os
   * identificadores em `packages/**` entra quando o vocabulário sair do core,
   * porque hoje ela reprovaria ~14 componentes que dizem o nome do 1º app).
   */
  const dono = appDoCaminho(rel);
  const proibidosAqui = dono === null
    ? forbidden
    : todosOsTokens.filter((t) => t.owner !== dono);

  for (const f of proibidosAqui) {
    if (relLower.includes(f.lower)) err(`Nome de arquivo ${rel} contém "${f.token}" (app "${f.owner}")`);
  }
  if (binary) continue;
  let text;
  try { text = readFileSync(join(ROOT, rel), 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  const lower = text.toLowerCase();
  for (const f of proibidosAqui) {
    if (!lower.includes(f.lower)) continue;
    const ln = lines.findIndex((l) => l.toLowerCase().includes(f.lower)) + 1;
    err(`${rel}:${ln} referencia "${f.token}" (app "${f.owner}")`);
  }
}

/* ----------  2b. identidade de app dentro do código compartilhado  ----------
 *
 * Agora ERRO, e não mais aviso contado.
 *
 * `packages/**` não contém identificador de app NENHUM — é o que força texto
 * novo a nascer pela marca e pelo vocabulário em vez de pelo nome do primeiro
 * app. Entrou como aviso contado em 14/11 (50 arquivos), e vira erro agora que
 * os dois sweeps acabaram.
 *
 * ## Duas exceções, e nenhuma é conveniência
 *
 * **Comentário não conta.** Mesma decisão do `lint-vocabulario`: explicar por
 * que algo existe — "era `odontobox` até 15/11" — não é texto que o usuário lê,
 * e proibi-lo ensina a escrever código sem explicação. São 27 ocorrências em
 * prosa histórica, e elas valem mais do que custam.
 *
 * **As chaves antigas de migração ficam**, por arquivo e com allowlist
 * conferida. `ler('som', ['odontobox360-sound-enabled'])` cita o nome antigo
 * porque é ele que está no navegador de quem usa o produto: apagar essa linha
 * apagaria a preferência de todo mundo. O nome antigo ali é a PROVA de que a
 * migração existe — o oposto de dívida.
 */
/**
 * Arquivos em que o nome antigo é a chave de MIGRAÇÃO, não dívida.
 *
 * Cada um passa o nome herdado como lista de `antigas` para `lib/armazenamento`,
 * que lê a chave nova e, na ausência dela, migra a velha. Apagar a linha
 * apagaria a preferência de quem já usa o produto.
 */
/*
 * VAZIA — e isso é o estado certo, não um esquecimento.
 *
 * Ela nasceu com quatro arquivos: os que citavam a chave antiga do PRIMEIRO app
 * (`odontobox360-sound-enabled` e companhia) porque a leitura dupla precisa
 * citar o nome que está no navegador de quem usa o produto. Era a exceção certa
 * para um app.
 *
 * Com o segundo app ela deixou de ser exceção e passou a ser DEFEITO: o core
 * migraria a preferência de um produto e apagaria a do outro em silêncio. A
 * medição nos três mostrou que as chaves antigas seguem a mesma forma
 * (`<slug>360-sound-enabled`, `<slug>360-last-reminder-count`,
 * `<slug>.inbox.emoji.recent`), então o sufixo ficou no core e o slug vem da
 * marca, por `armazenamento.anterior()`.
 *
 * Fica declarada e vazia de propósito: a lista existir é o que faz a próxima
 * exceção ser escrita aqui, com a razão, em vez de resolvida por um
 * `IGNORE_PREFIXES` que desligaria a regra para o arquivo inteiro. E
 * `orfaosDaMigracao` abaixo garante que ela não guarde caminho morto.
 */
const CHAVES_DE_MIGRACAO = [];

/** O texto sem comentários — por análise de estado, não por regex. */
function semComentarios(src) {
  const out = [];
  let i = 0;
  let estado = 'codigo';
  while (i < src.length) {
    const c = src[i];
    const d = src.slice(i, i + 2);
    if (estado === 'codigo') {
      if (d === '/*') { estado = 'bloco'; i += 2; continue; }
      if (d === '//') { estado = 'linha'; i += 2; continue; }
      out.push(c); i++; continue;
    }
    if (estado === 'bloco') { if (d === '*/') { estado = 'codigo'; i += 2; } else i++; continue; }
    if (estado === 'linha') { if (c === '\n') { estado = 'codigo'; out.push(c); } i++; }
  }
  return out.join('');
}

const vazamentosNoCompartilhado = new Map();
const orfaosDaMigracao = CHAVES_DE_MIGRACAO.filter((p) => !files.some((f) => f.rel === p));
if (orfaosDaMigracao.length) {
  err(`CHAVES_DE_MIGRACAO cita ${orfaosDaMigracao.length} arquivo(s) que não existem: ${orfaosDaMigracao.join(', ')}`);
}
for (const { rel, binary } of files) {
  if (binary) continue;
  if (!rel.startsWith('packages/')) continue;
  if (IGNORE_PREFIXES.some((p) => rel.startsWith(p))) continue;
  if (CHAVES_DE_MIGRACAO.includes(rel)) continue;
  let texto;
  try { texto = semComentarios(readFileSync(join(ROOT, rel), 'utf8')).toLowerCase(); } catch { continue; }
  for (const t of todosOsTokens) {
    if (!texto.includes(t.lower)) continue;
    if (!vazamentosNoCompartilhado.has(rel)) vazamentosNoCompartilhado.set(rel, new Set());
    vazamentosNoCompartilhado.get(rel).add(`${t.token} (${t.owner})`);
  }
}
if (vazamentosNoCompartilhado.size > 0) {
  for (const [rel, toks] of vazamentosNoCompartilhado) {
    err(`${rel} cita identidade de app fora de comentário: ${[...toks].slice(0, 3).join(', ')}`);
  }
  err(
    'O nome do produto vem da marca — `BRAND().name` no servidor, `useMarca().name` no ' +
    'cliente. Prefixo de cookie, chave de armazenamento e nome de instância vêm de ' +
    '`BRAND().slug`: ver lib/auth/cookies, lib/armazenamento, lib/whatsapp/instancia.'
  );
}

/* ----------  3. (removida) wrangler × manifesto  ----------
 *
 * Eram ~110 linhas que **nunca validaram nada**: toda a regra vivia dentro de
 * `if (wranglerFile)`, e não existe `wrangler.jsonc` neste repositório desde a
 * migração para o pacote `cf`. O ramo do `else` imprimia
 * "validação de bindings ignorada" em todo build — um aviso permanente, que é
 * a forma mais eficiente de ninguém mais ler os avisos.
 *
 * A premissa dela também morreu com o monorepo: ela esperava UM wrangler na
 * raiz, e aqui cada app tem o seu `cloudflare.config.ts`, que importa o
 * entrypoint com `with { type: 'cf-worker' }` e por isso não é avaliável no
 * Node — não há o que interpretar como JSON.
 *
 * Quem faz o trabalho hoje, e de verdade, é `scripts/check-recursos.ts` (passo
 * 6 do portão, PR #224): afirma um prefixo por ambiente, prefixos diferentes
 * entre produção e homologação, e o config contendo o prefixo e o nome do
 * Worker que o manifesto declara — agora app por app. Foi provado em quatro
 * cenários, cada um um erro real.
 */

const head = `Auditoria de isolamento — ${MANIFESTOS.length} app(s) aqui (${[...SLUGS_DAQUI].join(', ')})${STRICT ? ' (strict)' : ''} — ${files.length} arquivos, ${forbidden.length} identificadores proibidos de ${fingerprints.length} app(s) de fora`;
console.log(head);
for (const w of warnings) console.log(`  ⚠ ${w}`);
for (const e of errors) console.log(`  ✖ ${e}`);
if (errors.length) {
  console.log(`\nFALHOU: ${errors.length} erro(s). Não faça deploy nem rode migrations. Não desabilite esta auditoria (R12).`);
  process.exit(1);
}
if (STRICT && warnings.length) {
  console.log(`\nFALHOU: ${warnings.length} aviso(s), e --strict não tolera aviso. Resolva ou rebaixe a regra de propósito.`);
  process.exit(1);
}
console.log(`\nOK: nenhum vazamento de identidade encontrado${warnings.length ? ` (${warnings.length} aviso(s) para revisar)` : ''}.`);
