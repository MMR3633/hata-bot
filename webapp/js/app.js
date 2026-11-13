// Каркас Mini App: вход, сокет с переподключением, вкладки, общий контекст для модулей.
// Модуль вкладки экспортирует mount(el, ctx) и по желанию show().
import * as duel from './duel.js';
import * as watch from './watch.js';
import * as mc from './mc.js';
import * as stats from './stats.js';

const tg = window.Telegram?.WebApp;
const $ = s => document.querySelector(s);
const listeners = {};

const ctx = {
  token: null,
  me: null,
  names: {},
  online: [],
  clockOffset: 0,
  serverNow() { return Date.now() / 1000 + this.clockOffset; },
  name(uid) { return this.names[String(uid)] || 'Друг'; },
  friend() { return Object.keys(this.names).map(Number).find(u => u !== this.me) ?? null; },
  on(type, fn) { (listeners[type] ||= []).push(fn); },
  send(msg) { if (ws && ws.readyState === 1) { ws.send(JSON.stringify(msg)); return true; } return false; },
  async api(path, opts = {}) {
    const r = await fetch(path, {
      ...opts,
      headers: {'Authorization': `Bearer ${this.token}`, 'Content-Type': 'application/json', ...(opts.headers || {})},
    });
    if (r.status === 401) { localStorage.removeItem('hata_token'); location.reload(); }
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  toast(text, ms = 2200) {
    const t = $('#toast');
    t.textContent = text; t.hidden = false;
    clearTimeout(t._h); t._h = setTimeout(() => { t.hidden = true; }, ms);
  },
  haptic(kind = 'light') {
    try {
      if (['success', 'error', 'warning'].includes(kind)) tg?.HapticFeedback?.notificationOccurred(kind);
      else tg?.HapticFeedback?.impactOccurred(kind);
    } catch (e) {}
  },
};

function emit(type, msg) { (listeners[type] || []).forEach(fn => { try { fn(msg); } catch (e) { console.error(e); } }); }

async function login() {
  const pc = new URLSearchParams(location.search).get('pc');
  let body = null;
  if (tg?.initData) body = {init_data: tg.initData};
  else if (pc) body = {pc};
  else {
    const saved = localStorage.getItem('hata_token');
    if (saved) return {token: saved};
    throw new Error('Открой Хату через бота @hata_duo_bot или по ссылке /pc');
  }
  const r = await fetch('/api/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  if (!r.ok) throw new Error(r.status === 403 ? 'Сюда только своим 🙂' : 'Сервер не отвечает');
  const data = await r.json();
  if (pc) { localStorage.setItem('hata_token', data.token); history.replaceState(null, '', '/'); }
  return data;
}

let ws = null, backoff = 500;
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws?t=${encodeURIComponent(ctx.token)}`);
  ws.onopen = () => { backoff = 500; document.body.classList.remove('offline'); };
  ws.onmessage = e => {
    const msg = JSON.parse(e.data);
    if (msg.now) ctx.clockOffset = msg.now - Date.now() / 1000;
    if (msg.t === 'state') { ctx.me = msg.me; Object.assign(ctx.names, msg.names); ctx.online = msg.online; renderPresence(); }
    if (msg.t === 'presence') { Object.assign(ctx.names, msg.names || {}); ctx.online = msg.online; renderPresence(); }
    emit(msg.t, msg);
  };
  ws.onclose = () => {
    document.body.classList.add('offline');
    setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 8000);
  };
}

function renderPresence() {
  const el = $('#presence');
  el.innerHTML = '';
  for (const uid of Object.keys(ctx.names).map(Number)) {
    const on = ctx.online.includes(uid);
    const chip = document.createElement('span');
    chip.className = 'chip' + (on ? ' on' : '');
    chip.textContent = (uid === ctx.me ? 'Ты' : ctx.name(uid));
    chip.title = on ? 'в Хате' : 'не в сети';
    el.append(chip);
  }
}

const modules = {duel, watch, mc, stats};
function go(tab) {
  document.querySelectorAll('.tab').forEach(s => { s.hidden = s.dataset.tab !== tab; });
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.go === tab));
  modules[tab].show?.();
  history.replaceState(null, '', '#' + tab);
}

async function boot() {
  tg?.ready(); tg?.expand();
  try { tg?.disableVerticalSwipes?.(); } catch (e) {}
  try { tg?.setHeaderColor?.('#121318'); tg?.setBackgroundColor?.('#121318'); } catch (e) {}
  try {
    const data = await login();
    ctx.token = data.token;
    const me = await ctx.api('/api/me');
    ctx.me = me.uid; Object.assign(ctx.names, me.names);
  } catch (e) {
    $('#gate-msg').textContent = e.message;
    return;
  }
  $('#gate').hidden = true;
  $('#app').hidden = false;
  for (const [name, m] of Object.entries(modules)) m.mount(document.getElementById('tab-' + name), ctx);
  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => { ctx.haptic('light'); go(b.dataset.go); }));
  connect();
  renderPresence();
  const start = location.hash.slice(1);
  go(modules[start] ? start : 'duel');
}

boot();
