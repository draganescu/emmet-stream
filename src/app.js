// Emmet Stream: a big model writes page structure as Emmet with empty text
// slots, the browser expands each line as it arrives, and a fast model fills
// the slots in parallel. See README.md for the notation.
import expandEmmet from 'emmet';
import { encode } from 'gpt-tokenizer/encoding/cl100k_base';
import KIT_CSS from './kit.css';
import DEMO_KIT from '../demos/kit.txt';
import DEMO_V1 from '../demos/v1.txt';
import FILLS_KIT from '../demos/kit-fills.json';
import FILLS_V1 from '../demos/v1-fills.json';
import { KIT_DOC, kitPrompt, v1Prompt, fillPrompt, basePrompt } from './prompts.js';
import { callClaude, MODELS, EFFORTS, supportsEffort, modelLabel } from './anthropic.js';

const DEMOS = { kit: { stream: DEMO_KIT, fills: FILLS_KIT }, v1: { stream: DEMO_V1, fills: FILLS_V1 } };
const REPLAY_PROMPT = 'A landing page for Ferment Lab, a neighborhood fermentation workshop in Arroios, Lisbon: kombucha, hot sauce and kimchi classes, a Friday tasting bar, and a monthly starter-culture subscription.';
const countTokens = s => encode(s).length;

const $ = id => document.getElementById(id);
const now = () => performance.now();
const fmtS = ms => ms == null ? '–' : (ms / 1000).toFixed(1) + ' s';
const fmtN = n => n == null ? '–' : Math.round(n).toLocaleString('en-US');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---------- HTTPS gate and API key ---------- */
const IS_HTTPS = location.protocol === 'https:' && window.isSecureContext;
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
const session = {
  get(k) { try { return sessionStorage.getItem(k) || ''; } catch { return ''; } },
  set(k, v) { try { sessionStorage.setItem(k, v); } catch {} },
  del(k) { try { sessionStorage.removeItem(k); } catch {} },
};
function loadKey() {
  const remembered = store.get('es-key', '');
  $('rememberKey').checked = !!remembered;
  $('apiKey').value = remembered || session.get('es-key');
}
function saveKey() {
  const k = $('apiKey').value.trim();
  if ($('rememberKey').checked) { store.set('es-key', k); session.del('es-key'); }
  else { store.del('es-key'); k ? session.set('es-key', k) : session.del('es-key'); }
  setRunning(!!TL.running);
}
const apiKey = () => $('apiKey').value.trim();
const canLive = () => IS_HTTPS && /^sk-ant-/.test(apiKey());

/* ---------- model pickers ---------- */
function fillSelect(id, options, value) { $(id).innerHTML = options.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join(''); $(id).value = value; }
function syncEffort(modelId, effortId) {
  const ok = supportsEffort($(modelId).value);
  $(effortId).disabled = !ok;
  if (!ok) $(effortId).value = '';
}
const PICKERS = [['bigModel', 'bigEffort'], ['fastModel', 'fastEffort'], ['baseModel', 'baseEffort']];
function initPickers() {
  const saved = store.get('es-models', {});
  const def = { bigModel: 'claude-sonnet-5', bigEffort: 'low', fastModel: 'claude-haiku-4-5-20251001', fastEffort: '', baseModel: 'claude-sonnet-5', baseEffort: '' };
  for (const [m, e] of PICKERS) {
    fillSelect(m, MODELS, saved[m] || def[m]);
    fillSelect(e, EFFORTS, saved[e] ?? def[e]);
    syncEffort(m, e);
    const persist = () => { syncEffort(m, e); const s = {}; for (const [a, b] of PICKERS) { s[a] = $(a).value; s[b] = $(b).value; } store.set('es-models', s); renderBaseInfo(); renderCompare(); };
    $(m).onchange = persist; $(e).onchange = persist;
  }
}
const pick = role => ({ model: $(role + 'Model').value, effort: $(role + 'Effort').value || null });
const pickLabel = p => modelLabel(p.model) + (p.effort ? ` · ${p.effort}` : '');

/* ---------- per-browser records ---------- */
let BASES = store.get('es-baselines', {});
let RUNS = store.get('es-runs', []);
const baseKey = (prompt, p) => `${p.model}|${p.effort || ''}::${prompt.trim()}`;
const curPrompt = () => $('prompt').value.trim() || REPLAY_PROMPT;
const curBase = () => BASES[baseKey(curPrompt(), pick('base'))] || null;

/* ---------- tabs ---------- */
document.querySelectorAll('.tabs [data-tab]').forEach(b => b.onclick = () => showTab(b.dataset.tab));
function showTab(t) {
  document.querySelectorAll('.tabs [data-tab]').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === t));
  document.querySelectorAll('.pane').forEach(p => p.hidden = p.dataset.pane !== t);
}

/* ---------- CSS: Emmet-abbreviated declarations -> CSS ---------- */
const EM_CSS = { type: 'stylesheet', options: { 'output.format': false } };
// SVG geometry props (d, r, x, cx…) collide with Emmet abbreviations, so short names must be explicitly real
const SHORT_OK = new Set(['gap', 'top', 'all', 'left', 'font', 'flex', 'grid', 'clip', 'fill', 'zoom']);
function isProp(p) { if (p.startsWith('--')) return true; if (p.length <= 4 && !SHORT_OK.has(p)) return false; try { return CSS.supports(p, 'inherit'); } catch { return false; } }
function splitDecls(body) {
  const out = []; let depth = 0, cur = '';
  for (const ch of body) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ';' && depth <= 0) { out.push(cur); cur = ''; } else cur += ch; }
  out.push(cur); return out;
}
function expandDecl(d, st) {
  d = d.trim(); if (!d) return '';
  const m = d.match(/^(--[\w-]+|[a-zA-Z-]+)\s*:([\s\S]*)$/);
  if (m && isProp(m[1])) return `${m[1]}:${m[2].trim()}`;
  let imp = ''; if (/!important\s*$/.test(d)) { imp = ' !important'; d = d.replace(/\s*!important\s*$/, ''); }
  try {
    const out = expandEmmet(d, EM_CSS).trim();
    if (out && !/:\s*;|prop time|\(\)|url\(\)/.test(out)) return out.replace(/;\s*$/, '') + imp;
  } catch {}
  if (m) { // abbreviation name + literal value, e.g. gtc:1fr 2fr
    try { const prop = expandEmmet(m[1], EM_CSS).split(':')[0].trim(); if (isProp(prop)) return `${prop}:${m[2].trim()}${imp}`; } catch {}
  }
  st.cssBad++; return '';
}
const expandCss = (src, st) => src.replace(/\{([^{}]*)\}/g, (_, body) => '{' + splitDecls(body).map(d => expandDecl(d, st)).filter(Boolean).join(';') + '}');

/* ---------- render target: a sandboxed same-origin iframe (scripts never run) ---------- */
const SYS_CSS = `body:empty::before{content:'Waiting for the first layout line…';display:block;padding:48px 24px;font:14px system-ui,sans-serif;color:#8a8f94}
.slot{display:inline-block;vertical-align:middle;height:.72em;border-radius:.3em;background:currentColor;opacity:.16;max-width:100%}
.slot.long{display:block;height:auto;background:transparent;opacity:1}
.slot.long i{display:block;height:.72em;margin:.34em 0;border-radius:.3em;background:currentColor;opacity:.16}
.slot.long i:last-child{width:62%}
.slot.queued{animation:pulse 1.1s ease-in-out infinite}
.slot-in{animation:fade .5s ease-out}
@keyframes pulse{50%{opacity:.3}} @keyframes fade{from{opacity:0}}
@media (prefers-reduced-motion: reduce){.slot.queued,.slot-in{animation:none}}`;
function makeTarget(frame, mode) {
  const kit = mode === 'kit' ? KIT_CSS : '';
  return new Promise((resolve, reject) => {
    frame.onload = () => {
      let doc = null; try { doc = frame.contentDocument; } catch {}
      if (!doc || !doc.body) return reject(new Error('preview frame not accessible'));
      resolve({
        doc, body: doc.body, head: doc.head, gen: doc.getElementById('gen'), theme: doc.getElementById('theme'), kitEl: doc.getElementById('kit'),
        serialize: (css, links) => '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n' + links + '<style>\n' + css + '\n</style>\n</head>\n' + doc.body.outerHTML + '\n</html>\n',
      });
    };
    frame.srcdoc = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style id="kit">${kit}</style><style id="theme"></style><style id="gen"></style><style>${SYS_CSS}</style></head><body></body></html>`;
  });
}

/* ---------- timeline ---------- */
const TL = { t0: 0, rows: [], marks: [], running: false, raf: 0 };
function tlReset() { TL.t0 = now(); TL.rows = []; TL.marks = []; TL.running = true; tlLoop(); }
function tlRow(kind) {
  const r = { kind, start: now() - TL.t0, first: null, end: null, lane: 0 };
  if (kind === 'fast') { const busy = new Set(TL.rows.filter(x => x.kind === 'fast' && x.end == null).map(x => x.lane)); while (busy.has(r.lane)) r.lane++; }
  TL.rows.push(r);
  return { first() { if (r.first == null) r.first = now() - TL.t0; }, end() { if (r.first == null) r.first = now() - TL.t0; r.end = now() - TL.t0; }, row: r };
}
function tlSetRaw(kind, think, end) { TL.rows = TL.rows.filter(x => x.kind !== 'proj' && x.kind !== 'base'); if (end != null) TL.rows.push({ kind, start: 0, first: think, end, lane: 0 }); tlDraw(); }
function tlLoop() { cancelAnimationFrame(TL.raf); const f = () => { tlDraw(); if (TL.running) TL.raf = requestAnimationFrame(f); }; f(); }
function tlDraw() {
  const t = now() - TL.t0;
  const ends = TL.rows.map(r => r.end ?? (TL.running ? t : r.start));
  const max = Math.max(1500, ...ends, ...TL.marks) * 1.04;
  const pct = v => (v / max * 100).toFixed(3) + '%';
  const lanes = [];
  const bigRows = TL.rows.filter(r => r.kind === 'big');
  if (bigRows.length) lanes.push({ label: 'Structure', rows: bigRows });
  const fr = TL.rows.filter(r => r.kind === 'fast');
  const fastLanes = fr.length ? Math.max(...fr.map(r => r.lane + 1)) : 0;
  for (let i = 0; i < fastLanes; i++) lanes.push({ label: 'Text ' + (i + 1), rows: fr.filter(r => r.lane === i) });
  const raw = TL.rows.filter(r => r.kind === 'base' || r.kind === 'proj');
  if (raw.length) lanes.push({ label: raw[0].kind === 'proj' ? 'Raw (proj.)' : 'Raw HTML', rows: raw });
  $('tl').innerHTML = lanes.map(l => `<div class="lane"><span>${l.label}</span><div class="track">${l.rows.map(r => {
    const e = r.end ?? t, f = r.first ?? e;
    const w = Math.max(0, e - r.start), th = Math.max(0, Math.min(f, e) - r.start);
    return `<div class="bar ${r.kind}" style="left:${pct(r.start)};width:${pct(w)}"><div class="think" style="width:${w ? (th / w * 100).toFixed(2) : 0}%"></div></div>`;
  }).join('')}</div></div>`).join('');
  const step = [250, 500, 1000, 2000, 5000, 10000, 20000, 30000, 60000].find(s => max / s <= 7) || 120000;
  let ticks = ''; for (let v = 0; v <= max; v += step) ticks += `<b style="left:${pct(v)}">${v / 1000}s</b>`;
  $('axis').innerHTML = ticks;
  $('tlmarks').innerHTML = TL.marks.map(m => `<div class="mark" style="left:${pct(m)}"></div>`).join('');
}

/* ---------- comparison ---------- */
let LAST = null, LASTFULL = null;
function delta(ours, raw, unit) {
  if (ours == null || raw == null) return { txt: '–', cls: '' };
  const d = raw - ours, pct = raw ? Math.round(d / raw * 100) : 0;
  const txt = unit === 's' ? `${d >= 0 ? '−' : '+'}${Math.abs(d / 1000).toFixed(1)} s (${Math.abs(pct)}%)` : `${d >= 0 ? '−' : '+'}${fmtN(Math.abs(d))} (${Math.abs(pct)}%)`;
  return { txt, cls: d >= 0 ? 'up' : 'down' };
}
function rawFor(r) {
  const b = r.simulated ? null : curBase();
  if (b && b.prompt === r.prompt) return { measured: true, think: b.thinkMs, paint: b.paintMs, done: b.doneMs, tok: b.outTok, inTok: b.inTok, label: pickLabel(b.pick) };
  return { measured: false, think: r.thinkMs, paint: r.projPaint, done: r.projDone, tok: r.fullTokEst, inTok: null };
}
function renderCompare() {
  const r = LAST; if (!r) return;
  const raw = rawFor(r);
  // measured comparisons use billed tokens on both sides; projections use cl100k on both sides
  const ourTok = raw.measured ? r.outTok : r.compactTokEst;
  $('cmpSrc').innerHTML = raw.measured
    ? `Raw HTML: <b>measured</b> baseline, ${esc(raw.label)}. This run: ${r.mode === 'kit' ? 'Kit' : 'v1'} notation, structure ${esc(pickLabel(r.pick))}.`
    : `Raw HTML: <b>projected</b> from this run's own speed${r.simulated ? ' (replay timings are simulated)' : '. Run the baseline for measured numbers'}.`;
  const box = (id, v, cls, d) => { $(id).textContent = v; $(id).className = 'v' + (cls ? ' ' + cls : ''); $(id + 'D').textContent = d; };
  if (r.doneMs != null && raw.done != null) {
    const d = raw.done - r.doneMs;
    box('bDone', `${d >= 0 ? '−' : '+'}${Math.abs(d / 1000).toFixed(1)} s`, d >= 0 ? 'up' : 'down', `${fmtS(r.doneMs)} vs ${fmtS(raw.done)} · ${Math.abs(Math.round(d / raw.done * 100))}% ${d >= 0 ? 'faster' : 'slower'}`);
  } else box('bDone', fmtS(r.doneMs), '', ' ');
  if (r.paintMs != null && raw.paint != null) {
    const x = raw.paint / Math.max(1, r.paintMs);
    box('bPaint', fmtS(r.paintMs), r.paintMs <= raw.paint ? 'up' : 'down', `vs ${fmtS(raw.paint)} · ${x >= 1 ? x.toFixed(1) + '× sooner' : (1 / x).toFixed(1) + '× later'}`);
  } else box('bPaint', fmtS(r.paintMs), '', ' ');
  if (ourTok != null && raw.tok) {
    const p = Math.round((1 - ourTok / raw.tok) * 100);
    box('bTok', `${p >= 0 ? '−' : '+'}${Math.abs(p)}%`, p >= 0 ? 'up' : 'down', `${fmtN(ourTok)} vs ${fmtN(raw.tok)} tokens`);
  } else box('bTok', fmtN(ourTok), '', ' ');
  const star = raw.measured ? '' : '*';
  const rows = [
    ['Thinking', fmtS(r.thinkMs), fmtS(raw.think) + star, delta(r.thinkMs, raw.think, 's')],
    ['First layout', fmtS(r.paintMs), fmtS(raw.paint) + star, delta(r.paintMs, raw.paint, 's')],
    ['Complete', fmtS(r.doneMs), fmtS(raw.done) + star, delta(r.doneMs, raw.done, 's')],
    ['Big-model tokens', fmtN(ourTok), fmtN(raw.tok) + star, delta(ourTok, raw.tok, 't')],
    ['Text tokens', fmtN(r.simulated ? r.textTokEst : r.textOutTok), '–', { txt: `${r.batches} batches`, cls: '' }],
  ];
  if (raw.measured) rows.push(['Input tokens, all calls', fmtN(r.inTok), fmtN(raw.inTok), delta(r.inTok, raw.inTok, 't')]);
  rows.push(['Emmet expansion', r.expandMs.toFixed(0) + ' ms', '–', { txt: '', cls: '' }]);
  $('cmpBody').innerHTML = rows.map(([k, a, b, d]) => `<tr><td>${k}</td><td>${a}</td><td>${b}</td><td class="${d.cls}">${d.txt}</td></tr>`).join('');
  if (!TL.running) raw.measured ? tlSetRaw('base', raw.think, raw.done) : tlSetRaw('proj', raw.think, raw.done);
}
function renderBaseInfo() {
  const b = curBase(), p = pick('base');
  if (b) {
    const when = new Date(b.at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    $('baseInfo').innerHTML = `Stored baseline (${esc(pickLabel(b.pick))}): <b>${fmtS(b.doneMs)}</b> complete, first layout ${fmtS(b.paintMs)}, ${fmtN(b.outTok)} output tokens · ${when}.`;
    $('baseBarText').textContent = `Stored ${when} · ${pickLabel(b.pick)} · ${fmtS(b.doneMs)} · ${fmtN(b.outTok)} tokens`;
    $('baseForget').hidden = false;
    $('baseEmpty').hidden = true; $('baseFrame').hidden = false;
    const k = baseKey(b.prompt, b.pick);
    if ($('baseFrame').dataset.key !== k) { $('baseFrame').srcdoc = b.html; $('baseFrame').dataset.key = k; }
  } else {
    $('baseInfo').textContent = `No stored baseline for this prompt with ${pickLabel(p)}. Comparisons are projected until you run one.`;
    $('baseBarText').textContent = 'No baseline stored for this prompt and model.';
    $('baseForget').hidden = true;
    if (!(RUN && RUN.mode === 'base')) { $('baseEmpty').hidden = false; $('baseFrame').hidden = true; $('baseFrame').dataset.key = ''; }
  }
}
function logRun(entry) { RUNS.unshift(entry); RUNS = RUNS.slice(0, 80); store.set('es-runs', RUNS); renderRuns(); }
function renderRuns() {
  $('runsBody').innerHTML = RUNS.length ? RUNS.map(r => {
    const tag = r.kind === 'raw' ? '<span class="tag raw">Raw HTML</span>' : `<span class="tag ${r.kind}">${r.kind === 'kit' ? 'Kit' : 'v1'}</span>${r.simulated ? ' <span class="tag sim">replay</span>' : ''}`;
    return `<tr title="${esc(r.prompt)}"><td>${new Date(r.at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td><td>${tag}</td><td>${esc(r.model || '–')}</td><td>${fmtS(r.thinkMs)}</td><td>${fmtS(r.paintMs)}</td><td>${fmtS(r.doneMs)}</td><td>${fmtN(r.tokens)}</td><td>${fmtN(r.textTok)}</td></tr>`;
  }).join('') : '<tr><td colspan="8" class="empty-cell">No runs yet.</td></tr>';
}

/* ---------- structure pipeline ---------- */
let RUN = null;
const setStatus = html => { $('status').innerHTML = html; };
function setRunning(on) {
  $('runLive').disabled = on || !canLive(); $('runBase').disabled = on || !canLive(); $('runReplay').disabled = on; $('stop').hidden = !on;
  const why = !IS_HTTPS ? 'Live runs need HTTPS' : !apiKey() ? 'Enter your Anthropic API key first' : !/^sk-ant-/.test(apiKey()) ? 'That does not look like an Anthropic API key (sk-ant-…)' : '';
  $('runLive').title = $('runBase').title = why;
}
function clearBoxes() { for (const id of ['bDone', 'bPaint', 'bTok']) { $(id).textContent = '–'; $(id).className = 'v'; $(id + 'D').innerHTML = '&nbsp;'; } $('cmpBody').innerHTML = ''; $('cmpSrc').innerHTML = '&nbsp;'; }

async function run(simulated) {
  if (!simulated && !canLive()) return;
  if (RUN) RUN.ctl.abort();
  const ctl = new AbortController();
  const mode = $('mode').value, bigPick = pick('big');
  const req = simulated ? REPLAY_PROMPT : curPrompt();
  const st = RUN = {
    mode, pick: bigPick, simulated, ctl, req, brief: [], theme: {}, parts: {}, partUses: {}, cssSrc: '', cssOut: '', compact: '', lines: 0, expandMs: 0, cssBad: 0, htmlBad: 0,
    slots: new Map(), pending: [], stack: [], fills: [], inflight: 0, queue: [], batches: 0, firstPaint: null, bigDone: false, bigFirst: null, bigEnd: null, fontLinks: [],
    usage: { bigIn: 0, bigOut: 0, fillIn: 0, fillOut: 0 },
  };
  LAST = null; clearBoxes(); setRunning(true); $('save').hidden = true;
  $('compactPre').textContent = ''; $('expandedPre').textContent = '';
  try { st.target = await makeTarget($('frame'), mode); } catch (e) { setStatus('The preview frame could not be opened: ' + esc(e.message)); setRunning(false); return; }
  if (RUN !== st) return;
  showTab('preview');
  tlReset();
  const who = simulated ? '<b>Replay</b> of a recorded run with simulated model speeds (no API calls).' : `<b>Live</b>, structure on ${esc(pickLabel(bigPick))}.`;
  setStatus(who + ' Waiting for the first token…');
  const big = tlRow('big');
  const parser = lineParser(line => onLine(st, line));
  try {
    const onDelta = delta => {
      if (st.bigFirst == null) { st.bigFirst = now(); big.first(); setStatus(who + ' Structure is streaming; each line expands as it arrives.'); }
      st.compact += delta; $('compactPre').textContent = st.compact; parser.push(delta);
    };
    if (simulated) await simulateStream(DEMOS[mode].stream, { thinkMs: mode === 'kit' ? 700 : 1600, charsPerSec: 380, signal: ctl.signal, onDelta });
    else {
      const res = await callClaude({ key: apiKey(), ...bigPick, prompt: mode === 'kit' ? kitPrompt(req) : v1Prompt(req), maxTokens: 16000, signal: ctl.signal, onText: ({ delta }) => onDelta(delta) });
      st.usage.bigIn = res.usage.input; st.usage.bigOut = res.usage.output;
      if (res.stop === 'max_tokens') setStatus(who + ' The structure hit the output limit and was cut short.');
    }
    parser.end();
  } catch (e) {
    if ((e && e.code === 'cancelled') || ctl.signal.aborted) { finish(st, true); return; }
    setStatus('Structure call failed: ' + esc(errCopy(e))); finish(st, true); return;
  }
  big.end(); st.bigEnd = now(); st.bigDone = true;
  flushCss(st, true);
  flushSlots(st, true);
  if (!st.inflight && !st.queue.length) finish(st);
  else setStatus(`Structure done. The text model is filling ${st.queue.length + st.inflight} remaining batch(es)…`);
}

function lineParser(onLine) {
  let buf = '';
  return {
    push(d) { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { onLine(buf.slice(0, i)); buf = buf.slice(i + 1); } },
    end() { if (buf.trim()) onLine(buf); buf = ''; },
  };
}

function onLine(st, raw) {
  const line = raw.replace(/\r$/, '').replace(/\t/g, '  ');
  const t = line.trim();
  if (!t || t.startsWith('```')) return;
  const h = t.match(/^#(brief|theme|parts|css|html)\s*$/i);
  if (h) { st.section = h[1].toLowerCase(); return; }
  if (st.section === 'brief') { st.brief.push(t); return; }
  if (st.section === 'theme') { onTheme(st, t); return; }
  if (st.section === 'parts') { const m = t.match(/^([a-z][\w-]*)\s*=\s*(.+)$/i); if (m) st.parts[m[1]] = m[2].trim(); return; }
  if (st.section === 'css') { st.cssSrc += line + '\n'; flushCss(st, false); return; }
  if (st.section === 'html') onHtml(st, line, t);
}

/* theme: tokens -> CSS custom properties, plus Google Fonts links */
const THEME_KEYS = new Set(['bg', 'ink', 'muted', 'accent', 'accent-ink', 'alt', 'surface', 'line', 'font-d', 'font-b', 'r', 'space']);
function onTheme(st, t) {
  const m = t.match(/^([a-z-]+)\s*:\s*(.+?);?$/i); if (!m) return;
  const k = m[1].toLowerCase(); let v = m[2].trim(); if (!THEME_KEYS.has(k)) return;
  if (/[{}<>;]/.test(v)) return;
  if (k === 'r' && /^\d+(\.\d+)?$/.test(v)) v += 'px';
  if (k === 'font-d' || k === 'font-b') {
    const fam = v.split(',')[0].trim().replace(/^["']|["']$/g, '');
    v = v.split(',').map((f, i) => { f = f.trim().replace(/^["']|["']$/g, ''); return /\s/.test(f) || i === 0 ? `"${f}"` : f; }).join(', ');
    if (fam && /^[\w\s-]+$/.test(fam) && !/^(serif|sans-serif|monospace|system-ui|georgia|arial|helvetica)$/i.test(fam)) addFont(st, fam);
  }
  st.theme[k] = v;
  st.target.theme.textContent = ':root{' + Object.entries(st.theme).map(([a, b]) => `--${a}:${b}`).join(';') + '}';
}
function addFont(st, fam) {
  const base = 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(fam).replace(/%20/g, '+');
  const link = st.target.doc.createElement('link'); link.rel = 'stylesheet'; link.href = base + ':wght@400;600;700&display=swap';
  link.onerror = () => { link.onerror = null; link.href = base + '&display=swap'; };
  st.target.head.append(link); st.fontLinks.push(link);
}

/* css: expand each complete rule once, when its braces balance */
function flushCss(st, final) {
  const open = (st.cssSrc.match(/\{/g) || []).length, close = (st.cssSrc.match(/\}/g) || []).length;
  if (!st.cssSrc.trim() || (!final && (!open || open !== close))) return;
  const t0 = now(); st.cssOut += expandCss(st.cssSrc, st) + '\n'; st.expandMs += now() - t0;
  st.cssSrc = '';
  st.target.gen.textContent = st.cssOut;
}

/* parts: @name:prefix*N -> (definition)*N with slot names prefixed */
function expandParts(st, t) {
  return t.replace(/(?<![@\w])@([a-z][\w-]*)(?::([a-z]\w*))?(\*\d+)?/gi, (all, name, prefix, mult) => {
    const def = st.parts[name]; if (!def) return all;
    st.partUses[name] = (st.partUses[name] || 0) + 1;
    const p = prefix || (name + st.partUses[name]);
    const body = def.replace(/@@_([A-Za-z0-9_-]+)/g, (_, f) => '@@' + p + (mult ? '$' : '') + '_' + f);
    return '(' + body + ')' + (mult || '');
  });
}

function onHtml(st, line, t) {
  const indent = line.match(/^ */)[0].length;
  if (indent === 0) flushSlots(st, false);
  let html;
  const t0 = now();
  try { html = expandEmmet(expandParts(st, t), { options: { 'output.format': false } }); } catch { st.htmlBad++; return; }
  const tpl = st.target.doc.createElement('template'); tpl.innerHTML = html;
  const frag = tpl.content;
  frag.querySelectorAll('script,iframe,object,embed,link,meta,base').forEach(n => n.remove());
  collectSlots(st, frag);
  while (st.stack.length && st.stack[st.stack.length - 1].indent >= indent) st.stack.pop();
  const parent = st.stack.length ? st.stack[st.stack.length - 1].el : st.target.body;
  const tops = [...frag.children];
  parent.append(frag);
  st.expandMs += now() - t0; st.lines++;
  let deep = tops[tops.length - 1];
  while (deep && deep.lastElementChild && !deep.lastElementChild.classList.contains('slot')) deep = deep.lastElementChild;
  if (deep && /^(INPUT|IMG|BR|HR|SOURCE)$/.test(deep.tagName)) deep = deep.parentElement;
  if (deep) st.stack.push({ indent, el: deep });
  if (st.firstPaint == null) { st.firstPaint = now(); TL.marks.push(st.firstPaint - TL.t0); }
}

const SLOT_RE = /@@([A-Za-z0-9_-]+)((?:\|[^|@]*){0,2})/g;
function parseSpec(rest) { const p = rest.split('|').slice(1).map(s => s.trim()); return { words: (p[0] || '').replace(/\s*w$/i, ''), hint: p[1] || '' }; }
function slotFor(st, name, spec, tag) {
  let s = st.slots.get(name);
  if (!s) { s = { name, words: spec.words, hint: spec.hint, tag, nodes: [], attrs: [], state: 'new' }; st.slots.set(name, s); st.pending.push(s); }
  return s;
}
function wordsHi(w) { const n = String(w).split('-').map(Number).filter(x => !isNaN(x)); return n.length ? Math.max(...n) : 4; }
function collectSlots(st, frag) {
  frag.querySelectorAll('*').forEach(el => {
    for (const a of [...el.attributes]) {
      if (/^on/i.test(a.name)) { el.removeAttribute(a.name); continue; }
      const m = a.value.match(/@@([A-Za-z0-9_-]+)((?:\|[^|@]*){0,2})/);
      if (m) { slotFor(st, m[1], parseSpec(m[2] || ''), el.tagName.toLowerCase() + '@' + a.name).attrs.push([el, a.name]); el.setAttribute(a.name, ''); }
    }
  });
  const walker = st.target.doc.createTreeWalker(frag, NodeFilter.SHOW_TEXT);
  const texts = []; while (walker.nextNode()) if (walker.currentNode.nodeValue.includes('@@')) texts.push(walker.currentNode);
  for (const tn of texts) {
    const v = tn.nodeValue, parts = []; let last = 0, m; SLOT_RE.lastIndex = 0;
    while ((m = SLOT_RE.exec(v))) {
      if (m.index > last) parts.push(st.target.doc.createTextNode(v.slice(last, m.index)));
      const spec = parseSpec(m[2] || ''), tag = (tn.parentElement?.tagName || 'span').toLowerCase();
      const s = slotFor(st, m[1], spec, tag);
      const span = st.target.doc.createElement('span'); span.className = 'slot'; span.dataset.slot = m[1];
      const w = wordsHi(spec.words);
      if (w > 12) { span.classList.add('long'); const lines = Math.max(2, Math.round(w / 10)); for (let i = 0; i < lines; i++) span.append(st.target.doc.createElement('i')); }
      else span.style.width = Math.max(2, w * 5.2) + 'ch';
      s.nodes.push(span); parts.push(span); last = m.index + m[0].length;
    }
    if (last < v.length) parts.push(st.target.doc.createTextNode(v.slice(last)));
    tn.replaceWith(...parts);
  }
}

/* batch slots per top-level section; small sections wait to merge with the next */
function flushSlots(st, final) {
  if (!st.pending.length) return;
  if (!final && st.pending.length < 6) return;
  const all = st.pending.splice(0);
  for (let i = 0; i < all.length; i += 14) enqueue(st, all.slice(i, i + 14));
}
function enqueue(st, batch) { batch.forEach(s => { s.state = 'queued'; s.nodes.forEach(n => n.classList.add('queued')); }); st.queue.push(batch); pump(st); }
const MAX_FILL = 4;
function pump(st) {
  while (st.inflight < MAX_FILL && st.queue.length && !st.ctl.signal.aborted) {
    const batch = st.queue.shift(); st.inflight++; st.batches++;
    fillBatch(st, batch).finally(() => { st.inflight--; if (RUN !== st) return; pump(st); if (st.bigDone && !st.inflight && !st.queue.length) finish(st); });
  }
}
function applyFill(st, k, v) {
  const s = st.slots.get(k); if (!s || s.state === 'filled') return;
  s.state = 'filled'; st.fills.push(v);
  s.nodes.forEach(n => { n.className = 'slot-in'; n.removeAttribute('style'); n.textContent = v; });
  s.attrs.forEach(([el, a]) => el.setAttribute(a, v));
}
function parseFillLine(line) {
  line = line.trim().replace(/,$/, ''); if (!line.startsWith('{')) return null;
  try { const o = JSON.parse(line); return typeof o.k === 'string' && typeof o.v === 'string' ? o : null; } catch {}
  const m = line.match(/"k"\s*:\s*"([^"]+)"\s*,\s*"v"\s*:\s*"((?:[^"\\]|\\.)*)"/); if (!m) return null;
  try { return { k: m[1], v: JSON.parse('"' + m[2] + '"') }; } catch { return null; }
}
async function fillBatch(st, batch) {
  const row = tlRow('fast');
  let pending = '';
  const eat = ({ delta }) => { row.first(); const ls = (pending + delta).split('\n'); pending = ls.pop(); ls.forEach(l => { const o = parseFillLine(l); if (o) applyFill(st, o.k, o.v); }); };
  try {
    if (st.simulated) {
      const fills = DEMOS[st.mode].fills;
      const text = batch.map(s => JSON.stringify({ k: s.name, v: fills[s.name] ?? '…' })).join('\n');
      await simulateStream(text, { thinkMs: 450, charsPerSec: 900, signal: st.ctl.signal, onDelta: d => eat({ delta: d }) });
    } else {
      const res = await callClaude({ key: apiKey(), ...pick('fast'), prompt: fillPrompt(st.req, st.brief.join('\n'), batch), maxTokens: 4000, signal: st.ctl.signal, onText: eat });
      st.usage.fillIn += res.usage.input; st.usage.fillOut += res.usage.output;
    }
    const o = parseFillLine(pending); if (o) applyFill(st, o.k, o.v);
  } catch (e) {
    if (!(e && e.code === 'cancelled')) setStatus('A text batch failed: ' + esc(errCopy(e)) + '. The rest of the page continues.');
  }
  row.end();
  batch.forEach(s => { if (s.state !== 'filled') s.nodes.forEach(n => n.classList.remove('queued')); });
}

/* CSS a direct writer would need: the kit rules that match something on the page */
function usedKitCss(st) {
  const sheet = st.target.kitEl && st.target.kitEl.sheet; if (!sheet) return '';
  const q = s => st.target.doc.querySelector(s);
  const matches = sel => sel.split(',').some(s => { const x = s.replace(/::?[a-z-]+(\([^)]*\))?/gi, '').trim(); if (!x || /[>+~]$/.test(x)) return true; try { return !!q(x); } catch { return true; } });
  const walk = rules => [...rules].map(r => {
    if (r.selectorText != null) return matches(r.selectorText) ? r.cssText : '';
    if (r.cssRules) { const inner = walk(r.cssRules).filter(Boolean); return inner.length ? `@media ${r.conditionText || r.media.mediaText}{${inner.join('')}}` : ''; }
    return r.cssText;
  });
  return walk(sheet.cssRules).filter(Boolean).join('\n');
}

function finish(st, aborted) {
  if (RUN !== st) return;
  TL.running = false; setRunning(false);
  if (aborted && !st.lines) { tlDraw(); return; }
  const doneAt = now();
  if (!aborted) TL.marks.push(doneAt - TL.t0);
  const themeCss = Object.keys(st.theme).length ? ':root{' + Object.entries(st.theme).map(([a, b]) => `--${a}:${b}`).join(';') + '}\n' : '';
  const links = st.fontLinks.map(l => `<link rel="stylesheet" href="${esc(l.href)}">\n`).join('');
  const kitAll = st.mode === 'kit' ? KIT_CSS + '\n' : '';
  const kitUsed = st.mode === 'kit' ? usedKitCss(st) + '\n' : '';
  LASTFULL = st.target.serialize((kitAll + themeCss + st.cssOut).trim(), links);
  const equiv = st.target.serialize((kitUsed + themeCss + st.cssOut).trim(), links);
  const equivHead = equiv.slice(0, equiv.indexOf('<body'));
  $('expandedPre').textContent = LASTFULL;
  renderCompact(st);
  const cT = countTokens(st.compact), fT = countTokens(equiv);
  const r = {
    prompt: st.req, mode: st.mode, pick: st.pick, simulated: st.simulated, batches: st.batches, expandMs: st.expandMs,
    compactTokEst: cT, fullTokEst: fT, textTokEst: countTokens(st.fills.join('\n')),
    outTok: st.usage.bigOut, textOutTok: st.usage.fillOut, inTok: st.usage.bigIn + st.usage.fillIn,
    thinkMs: st.bigFirst ? st.bigFirst - TL.t0 : null, paintMs: st.firstPaint ? st.firstPaint - TL.t0 : null, doneMs: aborted ? null : doneAt - TL.t0,
  };
  if (st.bigFirst && st.bigEnd && st.bigEnd > st.bigFirst) {
    const rate = cT / (st.bigEnd - st.bigFirst);
    r.projDone = r.thinkMs + fT / rate;
    r.projPaint = r.thinkMs + (countTokens(equivHead) + 40) / rate;
  }
  LAST = r;
  renderCompare();
  if (!aborted) logRun({ at: Date.now(), kind: st.mode, model: st.simulated ? 'replay' : pickLabel(st.pick), simulated: st.simulated, prompt: st.req, thinkMs: r.thinkMs, paintMs: r.paintMs, doneMs: r.doneMs, tokens: st.simulated ? cT : r.outTok, textTok: st.simulated ? r.textTokEst : r.textOutTok });
  const unfilled = [...st.slots.values()].filter(s => s.state !== 'filled').length;
  const bits = [];
  if (st.htmlBad) bits.push(`${st.htmlBad} line(s) failed to expand`);
  if (st.cssBad) bits.push(`${st.cssBad} CSS declaration(s) dropped`);
  if (unfilled) bits.push(`${unfilled} slot(s) left empty`);
  setStatus((aborted ? '<b>Stopped.</b> ' : `<b>Done.</b> ${st.lines} lines expanded, ${st.slots.size} text slots filled in ${st.batches} batches. `) + (bits.length ? bits.join(' · ') + '.' : ''));
  $('save').hidden = false;
}

function renderCompact(st) {
  $('compactPre').innerHTML = esc(st.compact)
    .replace(/^(#(?:brief|theme|parts|css|html))\s*$/gm, '<span class="h">$1</span>')
    .replace(/(?<![@\w])@[a-z][\w-]*(?::[a-z]\w*)?(?:\*\d+)?/gi, m => `<span class="p">${m}</span>`)
    .replace(/@@[A-Za-z0-9_$-]+(?:\|[^|}\]\n@]*){0,2}/g, m => `<span class="s">${m}</span>`);
}

function simulateStream(text, { thinkMs, charsPerSec, signal, onDelta }) {
  return new Promise((resolve, reject) => {
    let i = 0, started = null, timer;
    const abort = () => { clearTimeout(timer); reject({ code: 'cancelled' }); };
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, { once: true });
    const tick = () => {
      if (started == null) started = now();
      const want = Math.min(text.length, Math.floor((now() - started) / 1000 * charsPerSec) + 1);
      if (want > i) { onDelta(text.slice(i, want)); i = want; }
      if (i >= text.length) { signal.removeEventListener('abort', abort); resolve(); } else timer = setTimeout(tick, 40);
    };
    timer = setTimeout(tick, thinkMs);
  });
}

function errCopy(e) {
  const c = e && e.code;
  if (c === 'auth') return 'the API key was rejected. Check it and try again';
  if (c === 'rate_limited') return 'rate limited by the API; wait a minute and try again';
  if (c === 'overloaded') return 'the API is overloaded right now; try again shortly';
  if (c === 'network') return 'could not reach api.anthropic.com';
  return (e && e.message) || 'unknown error';
}

/* ---------- raw-HTML baseline (measured, stored per prompt + model) ---------- */
async function runBaseline() {
  if (!canLive()) return;
  if (RUN) RUN.ctl.abort();
  const ctl = new AbortController(); const st = RUN = { mode: 'base', ctl };
  const req = curPrompt(), p = pick('base');
  setRunning(true);
  // keep the last structure run's rows so both share one time axis
  TL.rows = TL.rows.filter(r => r.kind !== 'proj' && r.kind !== 'base');
  TL.t0 = now(); TL.running = true; tlLoop();
  const row = tlRow('base');
  $('baseEmpty').hidden = true; const bf = $('baseFrame'); bf.hidden = false; bf.dataset.key = ''; showTab('baseline');
  $('baseBarText').textContent = `Running · ${pickLabel(p)}…`;
  setStatus(`<b>Baseline.</b> ${esc(pickLabel(p))} is writing the full page as HTML…`);
  let text = '', lastPaint = 0, firstToken = null, paintAt = null;
  const clean = () => text.replace(/^\s*```(?:html)?\s*/i, '').replace(/```\s*$/, '');
  const paint = () => { bf.srcdoc = clean(); };
  try {
    const res = await callClaude({
      key: apiKey(), ...p, prompt: basePrompt(req), maxTokens: 32000, signal: ctl.signal,
      onText: ({ delta }) => {
        if (firstToken == null) firstToken = now() - TL.t0;
        row.first(); text += delta;
        if (paintAt == null && /<body[^>]*>\s*(<!--[\s\S]*?-->\s*)*<[a-z]/i.test(text)) paintAt = now() - TL.t0;
        if (now() - TL.t0 - lastPaint > 1200) { lastPaint = now() - TL.t0; paint(); }
      },
    });
    row.end(); paint();
    const rec = { prompt: req, pick: p, thinkMs: firstToken, paintMs: paintAt ?? row.row.end, doneMs: row.row.end, outTok: res.usage.output, inTok: res.usage.input, html: clean(), at: Date.now() };
    BASES[baseKey(req, p)] = rec; store.set('es-baselines', BASES);
    logRun({ at: rec.at, kind: 'raw', model: pickLabel(p), prompt: req, thinkMs: rec.thinkMs, paintMs: rec.paintMs, doneMs: rec.doneMs, tokens: rec.outTok, textTok: null });
    bf.dataset.key = baseKey(req, p);
    setStatus(`<b>Baseline stored:</b> ${fmtS(rec.doneMs)}, ${fmtN(rec.outTok)} output tokens. Every run on this prompt now compares against it.`);
  } catch (e) {
    row.end();
    setStatus(e && e.code === 'cancelled' ? '<b>Stopped.</b>' : 'Baseline failed: ' + esc(errCopy(e)));
  }
  TL.running = false; RUN = null; setRunning(false);
  renderBaseInfo(); renderCompare(); tlDraw();
}

/* ---------- download ---------- */
function download() {
  if (!LASTFULL) return;
  const url = URL.createObjectURL(new Blob([LASTFULL], { type: 'text/html' }));
  const a = document.createElement('a'); a.href = url; a.download = 'emmet-stream-page.html';
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------- wiring ---------- */
$('runReplay').onclick = () => run(true);
$('runLive').onclick = () => run(false);
$('runBase').onclick = runBaseline;
$('stop').onclick = () => RUN && RUN.ctl.abort();
$('save').onclick = download;
$('prompt').oninput = () => renderBaseInfo();
$('apiKey').oninput = saveKey;
$('rememberKey').onchange = saveKey;
$('forgetKey').onclick = () => { $('apiKey').value = ''; $('rememberKey').checked = false; saveKey(); };
$('baseForget').onclick = () => { const b = curBase(); if (!b) return; delete BASES[baseKey(b.prompt, b.pick)]; store.set('es-baselines', BASES); renderBaseInfo(); renderCompare(); };
$('clearRuns').onclick = () => { RUNS = []; store.set('es-runs', RUNS); renderRuns(); };

if (!IS_HTTPS) { $('httpsNote').hidden = false; $('apiKey').disabled = true; $('rememberKey').disabled = true; $('forgetKey').disabled = true; }
else loadKey();
initPickers();
renderBaseInfo(); renderRuns();
setRunning(false);
run(true);
// exposed for the kit documentation in the README and for debugging in the console
window.EmmetStream = { KIT_DOC, KIT_CSS };
