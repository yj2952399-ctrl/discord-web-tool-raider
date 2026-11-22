'use strict';

/* ---------------- util ---------------- */
const $ = (s) => document.querySelector(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rnd(a.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'd' + Date.now() + rnd(1e6));
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const randStr = (n) => Array.from({ length: n }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[rnd(36)]).join('');
const nonce = () => String(Date.now()) + String(rnd(1e6)).padStart(6, '0');
const mask = (t) => (t.length > 14 ? t.slice(0, 6) + '••••••' + t.slice(-4) : t.slice(0, 4) + '••••');

/* ---------------- storage ---------------- */
const K = {
  cur: 'dtool:currentDevice',
  list: 'dtool:devices',
  cfg: (id) => `dtool:${id}:config`,
  logs: (id) => `dtool:${id}:logs`,
};

const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { console.warn('storage full', e); } },
  del(k) { localStorage.removeItem(k); },
};

const defaults = () => ({
  tokens: [], channelId: '', template: '',
  burst: 5, cooldown: 5200, jitter: 12, concurrency: 0, limit: 0, retry: 5,
  tts: false, zw: true, base: '/api', reveal: false,
});

let DEV = null;
let C = defaults();
let LOG = [];
let saveTimer = null;
let logSaveTimer = null;

function loadDevices() {
  return LS.get(K.list, []);
}

function initDevice() {
  let list = loadDevices();
  let id = localStorage.getItem(K.cur);
  if (!list.length) {
    id = uid();
    list = [{ id, label: '端末1', createdAt: Date.now() }];
    LS.set(K.list, list);
    localStorage.setItem(K.cur, id);
  }
  if (!id || !list.some((d) => d.id === id)) {
    id = list[0].id;
    localStorage.setItem(K.cur, id);
  }
  DEV = id;
}

function loadDeviceData() {
  C = Object.assign(defaults(), LS.get(K.cfg(DEV), {}));
  C.tokens = (C.tokens || []).map((t) => Object.assign({ id: uid(), label: '', dead: false, sent: 0, fail: 0, seq: 0, runSent: 0, resetAt: 0, lastStatus: '' }, t));
  LOG = LS.get(K.logs(DEV), []);
  bindConfigToUI();
  renderTokens();
  renderLog();
  updateStats();
}

const saveConfig = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => LS.set(K.cfg(DEV), C), 250);
};

const saveLogs = () => {
  clearTimeout(logSaveTimer);
  logSaveTimer = setTimeout(() => {
    if (LOG.length > 1500) LOG.splice(0, LOG.length - 1500);
    LS.set(K.logs(DEV), LOG);
  }, 400);
};

/* ---------------- logging ---------------- */
const LV_ORDER = { debug: 0, info: 1, success: 2, warn: 3, error: 4 };

function log(level, msg) {
  const entry = { t: Date.now(), level, msg };
  LOG.push(entry);
  if (LOG.length > 1500) LOG.splice(0, LOG.length - 1500);
  saveLogs();
  appendLog(entry);
}

function logVisible(e) {
  const min = LV_ORDER[$('#logLevel').value] ?? 1;
  if (LV_ORDER[e.level] < min) return false;
  const q = $('#logSearch').value.trim().toLowerCase();
  if (q && !e.msg.toLowerCase().includes(q)) return false;
  return true;
}

function appendLog(e) {
  if (!logVisible(e)) return;
  const box = $('#log');
  const d = document.createElement('div');
  d.className = 'lv-' + e.level;
  d.dataset.level = e.level;
  d.dataset.raw = e.msg;
  d.textContent = `[${new Date(e.t).toLocaleTimeString('ja-JP')}] ${e.level.toUpperCase().padEnd(7)} ${e.msg}`;
  box.appendChild(d);
  while (box.children.length > 800) box.firstChild.remove();
  if ($('#logAuto').checked) box.scrollTop = box.scrollHeight;
  $('#logCount').textContent = `${box.children.length} 件表示 / ${LOG.length} 件保持`;
}

function renderLog() {
  const box = $('#log');
  box.innerHTML = '';
  LOG.slice(-800).forEach(appendLog);
  $('#logCount').textContent = `${box.children.length} 件表示 / ${LOG.length} 件保持`;
}

/* ---------------- tokens ---------------- */
function tag(t) { return t.label ? `[${t.label}]` : `[${mask(t.token)}]`; }

function addTokens(text) {
  const existing = new Set(C.tokens.map((t) => t.token));
  let added = 0;
  text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).forEach((raw) => {
    const tok = raw.replace(/^(Bot\s+|Bearer\s+)/i, '').trim();
    if (!tok || existing.has(tok)) return;
    existing.add(tok);
    C.tokens.push({ id: uid(), token: tok, label: '', dead: false, sent: 0, fail: 0, seq: 0, runSent: 0, resetAt: 0, lastStatus: '' });
    added++;
  });
  saveConfig();
  renderTokens();
  updateStats();
  log('info', `トークン ${added} 件追加（重複 ${text.split(/\r?\n/).filter(Boolean).length - added} 件除外）`);
}

function renderTokens() {
  const box = $('#tokList');
  box.innerHTML = '';
  C.tokens.forEach((t, i) => {
    const row = document.createElement('div');
    row.className = 'tok';
    const dot = document.createElement('span');
    dot.className = 'dot' + (t.dead ? ' bad' : t.busy ? ' busy' : t.lastStatus === '200' ? ' ok' : '');
    const lbl = document.createElement('span');
    lbl.className = 'lbl';
    lbl.textContent = `${i + 1}. ${t.label ? t.label + ' — ' : ''}${C.reveal ? t.token : mask(t.token)}`;
    const num = document.createElement('span');
    num.className = 'num';
    num.textContent = `${t.sent}/${t.fail}`;
    const ren = document.createElement('button');
    ren.textContent = '✎';
    ren.onclick = () => { const v = prompt('ラベル', t.label); if (v !== null) { t.label = v.trim(); saveConfig(); renderTokens(); } };
    const del = document.createElement('button');
    del.textContent = '✕';
    del.onclick = () => { C.tokens = C.tokens.filter((x) => x.id !== t.id); saveConfig(); renderTokens(); updateStats(); };
    row.append(dot, lbl, num, ren, del);
    box.appendChild(row);
  });
  updateStats();
}

async function checkTokens() {
  if (!C.tokens.length) return log('warn', 'トークンがありません');
  log('info', `${C.tokens.length} 件を検証開始`);
  for (const t of C.tokens) {
    const t0 = performance.now();
    try {
      const res = await fetch(`${C.base}/users/@me`, { headers: { Authorization: t.token } });
      const ms = Math.round(performance.now() - t0);
      if (res.ok) {
        const u = await res.json();
        t.dead = false;
        t.lastStatus = '200';
        if (!t.label) t.label = u.username;
        log('success', `${tag(t)} 有効 ${u.username}#${u.discriminator ?? '0'} (${u.id}) ${ms}ms`);
      } else {
        t.dead = res.status === 401;
        t.lastStatus = String(res.status);
        log('error', `${tag(t)} 無効 HTTP ${res.status} ${ms}ms`);
      }
    } catch (e) {
      log('error', `${tag(t)} 通信失敗 ${e.message}`);
    }
    renderTokens();
    saveConfig();
    await sleep(600);
  }
  log('info', '検証完了');
}

/* ---------------- message ---------------- */
function buildMessage(t) {
  const lines = C.template.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  let s = lines.length ? pick(lines) : 'test {rand:6}';
  t.seq++;
  s = s
    .replace(/\{n\}/g, t.seq)
    .replace(/\{rand:(\d+)\}/g, (_, n) => randStr(clamp(+n, 1, 64)))
    .replace(/\{rand\}/g, randStr(8))
    .replace(/\{time\}/g, new Date().toLocaleTimeString('ja-JP'))
    .replace(/\{date\}/g, new Date().toLocaleDateString('ja-JP'))
    .replace(/\{i\}/g, C.tokens.indexOf(t) + 1)
    .replace(/\{name\}/g, t.label || '');
  if (C.zw) s += '\u200b'.repeat(1 + rnd(3)) + '\u200c'.repeat(1 + rnd(2));
  return s;
}

/* ---------------- engine ---------------- */
const E = { running: false, paused: false, sent: 0, fail: 0, t0: 0, timer: null, sem: null };

class Sem {
  constructor(n) { this.n = n; this.q = []; }
  async acq() { if (this.n > 0) { this.n--; return; } await new Promise((r) => this.q.push(r)); }
  rel() { const r = this.q.shift(); if (r) r(); else this.n++; }
}

function readLimits(t, res) {
  const rem = res.headers.get('x-ratelimit-remaining');
  const after = res.headers.get('x-ratelimit-reset-after');
  const bucket = res.headers.get('x-ratelimit-bucket');
  const scope = res.headers.get('x-ratelimit-scope');
  if (rem !== null) {
    log('debug', `${tag(t)} rl remaining=${rem} reset=${after ?? '-'}s bucket=${bucket?.slice(0, 8) ?? '-'} scope=${scope ?? '-'}`);
    if (Number(rem) <= 0 && after) t.resetAt = Date.now() + Number(after) * 1000 + 150;
  }
}

async function sendOne(t) {
  const content = buildMessage(t);
  const body = JSON.stringify({ content, tts: !!C.tts, nonce: nonce(), enforce_nonce: true });
  for (let a = 0; a <= C.retry; a++) {
    if (t.resetAt > Date.now()) {
      const w = t.resetAt - Date.now();
      log('debug', `${tag(t)} バケット待機 ${w}ms`);
      await sleep(w);
    }
    await E.sem.acq();
    const t0 = performance.now();
    let res;
    try {
      res = await fetch(`${C.base}/channels/${encodeURIComponent(C.channelId)}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: t.token },
        body,
      });
    } catch (e) {
      E.sem.rel();
      E.fail++; t.fail++; t.lastStatus = 'NET';
      log('error', `${tag(t)} ネットワーク失敗 ${e.message}`);
      renderTokens(); updateStats();
      await sleep(1000);
      continue;
    }
    const ms = Math.round(performance.now() - t0);
    readLimits(t, res);
    E.sem.rel();

    if (res.status === 429) {
      let wait = 1500;
      try { const j = await res.json(); if (j.retry_after) wait = clamp(j.retry_after * 1000, 500, 65000); } catch {}
      wait += rnd(400);
      t.lastStatus = '429';
      log('warn', `${tag(t)} 429 レート制限 ${Math.round(wait)}ms 待機 (${ms}ms応答, 試行${a + 1})`);
      renderTokens();
      await sleep(wait);
      continue;
    }
    if (res.status === 401) { t.dead = true; E.fail++; t.fail++; log('error', `${tag(t)} 401 トークン無効`); renderTokens(); updateStats(); return false; }
    if (res.status === 403) { t.dead = true; E.fail++; t.fail++; log('error', `${tag(t)} 403 権限なし/閲覧不可`); renderTokens(); updateStats(); return false; }
    if (res.status === 404) { E.fail++; t.fail++; t.lastStatus = '404'; log('error', `${tag(t)} 404 チャンネルID不正`); renderTokens(); updateStats(); await sleep(1200); continue; }
    if (res.status === 400) {
      let m = ''; try { const j = await res.json(); m = j.message || ''; } catch {}
      E.fail++; t.fail++; t.lastStatus = '400';
      log('error', `${tag(t)} 400 ${m}`);
      renderTokens(); updateStats(); return false;
    }
    if (!res.ok) {
      E.fail++; t.fail++; t.lastStatus = String(res.status);
      log('error', `${tag(t)} HTTP ${res.status} ${ms}ms`);
      renderTokens(); updateStats();
      await sleep(900);
      continue;
    }
    const j = await res.json().catch(() => null);
    E.sent++; t.sent++; t.runSent++; t.lastStatus = '200';
    log('debug', `${tag(t)} 200 ${ms}ms id=${j?.id?.slice(0, 10) ?? '-'} len=${content.length}`);
    renderTokens(); updateStats();
    return true;
  }
  return false;
}

async function runToken(t) {
  t.runSent = 0; t.runFail = 0; t.busy = false;
  while (E.running && !t.dead) {
    if (E.paused) { await sleep(200); continue; }
    for (let b = 0; b < C.burst && E.running && !E.paused && !t.dead; b++) {
      if (C.limit && t.runSent >= C.limit) { log('info', `${tag(t)} 上限 ${C.limit} 到達`); return; }
      await sendOne(t);
      if (b < C.burst - 1) await sleep(120 + rnd(90));
    }
    if (E.running && !E.paused) {
      const base = C.cooldown;
      const jit = Math.round(base * (C.jitter / 100) * (Math.random() * 2 - 1));
      await sleep(Math.max(150, base + jit));
    }
  }
}

function start() {
  if (E.running) return;
  if (!C.tokens.length) return log('warn', 'トークン未登録');
  if (!C.channelId) return log('warn', 'チャンネルID未入力');
  const alive = C.tokens.filter((t) => !t.dead);
  if (!alive.length) return log('warn', '生存トークンが0件');
  E.running = true; E.paused = false; E.sent = 0; E.fail = 0; E.t0 = Date.now();
  E.sem = new Sem(C.concurrency > 0 ? C.concurrency : 999);
  $('#hState').textContent = '稼働中';
  log('info', `開始: 生存${alive.length}/${C.tokens.length} burst=${C.burst} cool=${C.cooldown}ms jitter=${C.jitter}% 同時=${C.concurrency || '無制限'}`);
  alive.forEach((t) => runToken(t));
  clearInterval(E.timer);
  E.timer = setInterval(updateStats, 500);
}

function stop() {
  E.running = false; E.paused = false;
  clearInterval(E.timer);
  $('#hState').textContent = '停止中';
  log('info', '停止');
  renderTokens();
}

/* ---------------- stats ---------------- */
function updateStats() {
  $('#sSent').textContent = E.sent;
  $('#sFail').textContent = E.fail;
  const sec = E.t0 ? (Date.now() - E.t0) / 1000 : 0;
  const rate = sec > 0 ? (E.sent / sec) : 0;
  $('#sRate').textContent = rate.toFixed(1);
  $('#hRate').textContent = rate.toFixed(1) + ' msg/s';
  $('#sTime').textContent = Math.round(sec) + 's';
  $('#sTok').textContent = C.tokens.filter((t) => !t.dead).length;
}

/* ---------------- config bind ---------------- */
function bindConfigToUI() {
  $('#channel').value = C.channelId;
  $('#template').value = C.template;
  $('#burst').value = C.burst;
  $('#cooldown').value = C.cooldown;
  $('#jitter').value = C.jitter;
  $('#concurrency').value = C.concurrency;
  $('#limit').value = C.limit;
  $('#retry').value = C.retry;
  $('#tts').value = C.tts ? '1' : '0';
  $('#zw').value = C.zw ? '1' : '0';
  $('#base').value = C.base;
}

function bindUI() {
  $('#channel').oninput = (e) => { C.channelId = e.target.value.trim(); saveConfig(); };
  $('#template').oninput = (e) => { C.template = e.target.value; saveConfig(); };
  $('#burst').oninput = (e) => { C.burst = clamp(+e.target.value || 1, 1, 10); saveConfig(); };
  $('#cooldown').oninput = (e) => { C.cooldown = Math.max(200, +e.target.value || 200); saveConfig(); };
  $('#jitter').oninput = (e) => { C.jitter = clamp(+e.target.value || 0, 0, 100); saveConfig(); };
  $('#concurrency').oninput = (e) => { C.concurrency = Math.max(0, +e.target.value || 0); saveConfig(); };
  $('#limit').oninput = (e) => { C.limit = Math.max(0, +e.target.value || 0); saveConfig(); };
  $('#retry').oninput = (e) => { C.retry = clamp(+e.target.value || 0, 0, 10); saveConfig(); };
  $('#tts').onchange = (e) => { C.tts = e.target.value === '1'; saveConfig(); };
  $('#zw').onchange = (e) => { C.zw = e.target.value === '1'; saveConfig(); };
  $('#base').oninput = (e) => { C.base = e.target.value.trim() || '/api'; saveConfig(); };

  $('#tokAdd').onclick = () => { addTokens($('#tokInput').value); $('#tokInput').value = ''; };
  $('#tokCheck').onclick = checkTokens;
  $('#tokReveal').onclick = () => { C.reveal = !C.reveal; saveConfig(); renderTokens(); };
  $('#tokClear').onclick = () => { if (confirm('全トークン削除？')) { C.tokens = []; saveConfig(); renderTokens(); } };

  $('#start').onclick = start;
  $('#stop').onclick = stop;
  $('#pause').onclick = () => {
    E.paused = !E.paused;
    $('#pause').textContent = E.paused ? '再開' : '一時停止';
    $('#hState').textContent = E.paused ? '一時停止' : '稼働中';
    log('info', E.paused ? '一時停止' : '再開');
  };
  $('#cfgSave').onclick = () => { LS.set(K.cfg(DEV), C); log('success', '設定保存'); };

  $('#logLevel').onchange = renderLog;
  $('#logSearch').oninput = renderLog;
  $('#logClear').onclick = () => { LOG = []; LS.set(K.logs(DEV), LOG); renderLog(); };
  $('#logCopy').onclick = async () => {
    const txt = LOG.map((e) => `[${new Date(e.t).toISOString()}] ${e.level} ${e.msg}`).join('\n');
    try { await navigator.clipboard.writeText(txt); log('success', `ログ ${LOG.length} 行コピー`); } catch { log('error', 'コピー失敗'); }
  };
  $('#logDl').onclick = () => {
    const txt = LOG.map((e) => `[${new Date(e.t).toISOString()}] ${e.level} ${e.msg}`).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([txt], { type: 'text/plain' }));
    a.download = `dtool-${DEV.slice(0, 8)}-${Date.now()}.log`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  /* device */
  $('#device').onchange = (e) => { localStorage.setItem(K.cur, e.target.value); DEV = e.target.value; loadDeviceData(); renderDevices(); };
  $('#devNew').onclick = () => {
    const label = prompt('新しい端末プロファイル名', `端末${loadDevices().length + 1}`);
    if (label === null) return;
    const list = loadDevices();
    const id = uid();
    list.push({ id, label: label.trim() || `端末${list.length + 1}`, createdAt: Date.now() });
    LS.set(K.list, list);
    localStorage.setItem(K.cur, id);
    DEV = id;
    C = defaults(); LOG = [];
    LS.set(K.cfg(DEV), C); LS.set(K.logs(DEV), LOG);
    renderDevices(); bindConfigToUI(); renderTokens(); renderLog(); updateStats();
    log('info', '新しい端末プロファイルを作成');
  };
  $('#devRename').onclick = () => {
    const list = loadDevices();
    const d = list.find((x) => x.id === DEV);
    const v = prompt('名前', d?.label || '');
    if (v === null || !d) return;
    d.label = v.trim() || d.label;
    LS.set(K.list, list);
    renderDevices();
  };
  $('#devDel').onclick = () => {
    const list = loadDevices();
    if (list.length <= 1) return alert('最後の1つは削除できません');
    if (!confirm('この端末の設定とログを削除？')) return;
    LS.del(K.cfg(DEV)); LS.del(K.logs(DEV));
    const next = list.filter((d) => d.id !== DEV);
    LS.set(K.list, next);
    localStorage.setItem(K.cur, next[0].id);
    DEV = next[0].id;
    renderDevices(); loadDeviceData();
  };

  /* backup */
  $('#expPlain').onclick = () => {
    const data = JSON.stringify({ v: 1, plain: true, device: DEV, config: C }, null, 2);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    a.download = `dtool-plain-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    log('warn', '平文JSON書き出し（トークン含む）');
  };
  $('#expEnc').onclick = async () => {
    const pass = prompt('パスフレーズ（復元時に必要）');
    if (!pass || pass.length < 6) return alert('6文字以上');
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(pass, salt);
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify({ device: DEV, config: C })));
    const out = JSON.stringify({ v: 1, enc: true, salt: b64(salt), iv: b64(iv), ct: b64(ct) });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([out], { type: 'application/json' }));
    a.download = `dtool-enc-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    log('success', '暗号化書き出し完了');
  };
  $('#impBtn').onclick = () => $('#impFile').click();
  $('#impFile').onchange = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const text = await f.text();
    let data;
    try { data = JSON.parse(text); } catch { return log('error', 'JSON解析失敗'); }
    if (data.enc) {
      const pass = prompt('パスフレーズ');
      if (!pass) return;
      try {
        const key = await deriveKey(pass, unb64(data.salt));
        const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(data.iv) }, key, unb64(data.ct));
        data = JSON.parse(new TextDecoder().decode(pt));
      } catch { return log('error', '復号失敗（パスフレーズ相違）'); }
    }
    const cfg = data.config || data;
    if (!cfg.tokens) return log('error', '形式不正');
    C = Object.assign(defaults(), cfg);
    C.tokens = C.tokens.map((t) => Object.assign({ id: uid(), label: '', dead: false, sent: 0, fail: 0, seq: 0, runSent: 0, resetAt: 0, lastStatus: '' }, t));
    saveConfig(); bindConfigToUI(); renderTokens(); updateStats();
    log('success', `読み込み完了: ${C.tokens.length} トークン`);
  };

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); start(); }
  });
}

async function deriveKey(pass, salt) {
  const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 210000, hash: 'SHA-256' }, km, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

function renderDevices() {
  const sel = $('#device');
  sel.innerHTML = '';
  loadDevices().forEach((d) => {
    const o = document.createElement('option');
    o.value = d.id;
    o.textContent = d.label;
    o.selected = d.id === DEV;
    sel.appendChild(o);
  });
}

/* ---------------- init ---------------- */
initDevice();
renderDevices();
bindUI();
loadDeviceData();
log('info', `起動: 端末=${loadDevices().find((d) => d.id === DEV)?.label ?? '-'} トークン=${C.tokens.length} ログ=${LOG.length}`);