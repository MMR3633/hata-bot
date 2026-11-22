// Вкладка «Игра»: колесо вопросов и действий, монетка и кости на двоих, редактор карточек.
let ctx, root, g = null, rot = 0, lastSpin = 0, lastCoin = 0, lastDice = 0, spinning = false;
let cards = [], filter = 'q', editing = null;

const KIND = {
  q: {name: 'Вопрос', many: 'Вопросы', icon: '💬'},
  a: {name: 'Действие', many: 'Действия', icon: '⚡'},
};
const SPIN_MS = 4600;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const $ = s => root.querySelector(s);
const pips = n => ({1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9]}[n]);
const die = n => `<span class="gm-die">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => `<i${pips(n).includes(i) ? ' class="on"' : ''}></i>`).join('')}</span>`;

export function mount(el, c) {
  ctx = c; root = el;
  root.innerHTML = `
    <div class="card gm-turn">
      <div class="gm-turn-who"><span class="muted">Ходит</span> <b id="gm-turn">не выбрано</b></div>
      <div class="row gm-tools">
        <button class="btn" id="gm-coin">🪙 Монетка</button>
        <button class="btn" id="gm-dice">🎲 Кости</button>
        <button class="btn" id="gm-pass">Ход дальше ➜</button>
      </div>
      <div id="gm-toss" class="gm-toss" hidden></div>
    </div>

    <div class="gm-kinds" id="gm-kinds"></div>

    <div class="gm-wheel-wrap">
      <div class="gm-pointer"></div>
      <svg id="gm-wheel" class="gm-wheel" viewBox="-110 -110 220 220"></svg>
      <button class="gm-hub" id="gm-spin">Крутить</button>
    </div>

    <div class="card gm-card" id="gm-card" hidden></div>

    <div class="card">
      <h3>Карточки</h3>
      <div class="row gm-filter" id="gm-filter"></div>
      <div class="list gm-list" id="gm-list"><div class="muted">Загружаю…</div></div>
      <label class="label" for="gm-new">Добавить: по одной на строку</label>
      <textarea class="input gm-new" id="gm-new" rows="3" placeholder="Новый вопрос или действие"></textarea>
      <div class="row" style="margin-top:8px">
        <select class="input gm-select" id="gm-new-kind"></select>
        <button class="btn primary" id="gm-add">Добавить</button>
      </div>
      <button class="btn wide" id="gm-reset" style="margin-top:12px">Начать колоду заново</button>
    </div>`;

  $('#gm-new-kind').innerHTML = Object.entries(KIND).map(([k, v]) => `<option value="${k}">${v.icon} ${v.name}</option>`).join('');
  $('#gm-spin').addEventListener('click', () => {
    if (spinning) return;
    if (!ctx.send({t: 'game_spin'})) return ctx.toast('Нет связи');
    ctx.haptic('medium');
  });
  $('#gm-coin').addEventListener('click', () => { ctx.send({t: 'game_coin'}); ctx.haptic('light'); });
  $('#gm-dice').addEventListener('click', () => { ctx.send({t: 'game_dice'}); ctx.haptic('light'); });
  $('#gm-pass').addEventListener('click', () => { ctx.send({t: 'game_pass'}); ctx.haptic('light'); });
  $('#gm-reset').addEventListener('click', () => {
    if (confirm('Вернуть все сыгранные карточки в колоду?')) ctx.send({t: 'game_reset'});
  });
  $('#gm-kinds').addEventListener('click', e => {
    const b = e.target.closest('[data-kind]');
    if (!b || !g) return;
    const k = b.dataset.kind;
    const kinds = g.kinds.includes(k) ? g.kinds.filter(x => x !== k) : [...g.kinds, k];
    if (!kinds.length) return ctx.toast('Нужен хотя бы один вид');
    ctx.send({t: 'game_kinds', kinds});
  });
  $('#gm-card').addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (b) { ctx.send({t: 'game_' + b.dataset.act}); ctx.haptic('light'); }
  });
  $('#gm-filter').addEventListener('click', e => {
    const b = e.target.closest('[data-f]');
    if (b) { filter = b.dataset.f; editing = null; renderList(); }
  });
  $('#gm-list').addEventListener('click', onListClick);
  $('#gm-add').addEventListener('click', addCards);

  ctx.on('state', m => { if (m.game) apply(m.game, null); });
  ctx.on('game', m => apply(m.game, m.event));
  ctx.on('game_empty', () => ctx.toast('Карточки кончились. Включи другой вид или начни колоду заново', 3500));
}

export function show() { loadCards(); }

function apply(next, event) {
  const prev = g;
  g = next;
  renderTurn();
  renderKinds();
  drawWheel();
  const spinN = g.spin?.n || 0;
  if (event === 'spin' && spinN !== lastSpin) {
    lastSpin = spinN;
    spinTo(g.spin, true);
  } else {
    if (!prev && g.spin) { lastSpin = spinN; spinTo(g.spin, false); }
    if (!spinning) renderCard();
  }
  if (event === 'coin' && g.coin && g.coin.n !== lastCoin) { lastCoin = g.coin.n; showCoin(g.coin); }
  if (event === 'dice' && g.dice && g.dice.n !== lastDice) { lastDice = g.dice.n; showDice(g.dice); }
  if (!prev) { lastCoin = g.coin?.n || 0; lastDice = g.dice?.n || 0; }
  if (event === 'reset') ctx.toast('Колода снова полная');
  if (['reset', 'spin', 'other'].includes(event) || (event == null && prev)) refreshUsed();
}

function who(uid) { return uid == null ? 'не выбрано' : uid === ctx.me ? 'Ты' : ctx.name(uid); }

function renderTurn() {
  $('#gm-turn').textContent = who(g.turn);
  $('#gm-turn').classList.toggle('me', g.turn === ctx.me);
}

function renderKinds() {
  $('#gm-kinds').innerHTML = Object.entries(KIND).map(([k, v]) => {
    const on = g.kinds.includes(k);
    return `<button class="gm-kind k-${k}${on ? ' on' : ''}" data-kind="${k}">${v.icon} ${v.many}
      <small>${g.left[k] ?? 0}/${g.total[k] ?? 0}</small></button>`;
  }).join('');
}

function drawWheel() {
  const svg = $('#gm-wheel');
  const key = g.wheel.join('');
  if (svg.dataset.key === key) return;
  svg.dataset.key = key;
  const n = g.wheel.length, step = 360 / n, r = 104;
  const pt = (deg, rad) => {
    const a = (deg - 90) * Math.PI / 180;
    return [Math.cos(a) * rad, Math.sin(a) * rad];
  };
  let html = '';
  g.wheel.forEach((k, i) => {
    const [x1, y1] = pt(i * step, r), [x2, y2] = pt((i + 1) * step, r);
    html += `<path class="gm-sec k-${k}" d="M0 0 L${x1.toFixed(2)} ${y1.toFixed(2)} A${r} ${r} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z"/>`;
    const mid = i * step + step / 2, [tx, ty] = pt(mid, 90);
    html += `<text class="gm-lbl" x="${tx.toFixed(2)}" y="${ty.toFixed(2)}" transform="rotate(${mid} ${tx.toFixed(2)} ${ty.toFixed(2)})">${KIND[k].icon}</text>`;
    const [sx, sy] = pt(mid, 56);
    html += `<text class="gm-lbl small" x="${sx.toFixed(2)}" y="${sy.toFixed(2)}" transform="rotate(${mid > 180 ? mid + 90 : mid - 90} ${sx.toFixed(2)} ${sy.toFixed(2)})">${KIND[k].name}</text>`;
  });
  html += `<circle r="${r}" class="gm-rim"/>`;
  svg.innerHTML = html;
}

function spinTo(spin, animate) {
  const step = 360 / g.wheel.length;
  const target = 360 - (spin.sector + spin.offset) * step;
  const svg = $('#gm-wheel');
  if (!animate) {
    rot = target;
    svg.style.transition = 'none';
    svg.style.transform = `rotate(${rot}deg)`;
    return;
  }
  const base = Math.ceil(rot / 360) * 360;
  rot = base + spin.turns * 360 + target;
  spinning = true;
  $('#gm-spin').disabled = true;
  $('#gm-card').hidden = true;
  svg.style.transition = `transform ${SPIN_MS}ms cubic-bezier(.12, .7, .14, 1)`;
  requestAnimationFrame(() => { svg.style.transform = `rotate(${rot}deg)`; });
  clearTimeout(spinTo._t);
  spinTo._t = setTimeout(() => {
    spinning = false;
    $('#gm-spin').disabled = false;
    ctx.haptic('success');
    renderCard(true);
    $('#gm-card').scrollIntoView({behavior: 'smooth', block: 'center'});
  }, SPIN_MS + 80);
}

function renderCard(pop) {
  const el = $('#gm-card');
  const c = g.card;
  if (!c) { el.hidden = true; return; }
  const k = KIND[c.kind] || KIND.q;
  el.className = `card gm-card k-${c.kind}${pop ? ' pop' : ''}`;
  el.innerHTML = `
    <div class="gm-card-kind">${k.icon} ${k.name}${c.for != null ? ` · для: <b>${esc(who(c.for))}</b>` : ''}</div>
    <div class="gm-card-text">${esc(c.text)}</div>
    <div class="row">
      <button class="btn" data-act="other">Другой ${k.name.toLowerCase()}</button>
      <button class="btn primary" data-act="pass">Ход дальше ➜</button>
    </div>`;
  el.hidden = false;
}

function showCoin(coin) {
  const el = $('#gm-toss');
  const heads = who(coin.heads), tails = who(coin.tails);
  el.hidden = false;
  el.innerHTML = `
    <div class="gm-coin-stage"><div class="gm-coin ${coin.side}"><span class="f">Орёл</span><span class="b">Решка</span></div></div>
    <div class="muted gm-toss-cap">Орёл: ${esc(heads)} · Решка: ${esc(tails)}</div>
    <div class="gm-toss-res" hidden>${coin.side === 'heads' ? 'Орёл' : 'Решка'}! Ходит ${esc(who(coin.winner))}</div>`;
  setTimeout(() => { const r = el.querySelector('.gm-toss-res'); if (r) r.hidden = false; ctx.haptic('success'); }, 1700);
}

function showDice(dice) {
  const el = $('#gm-toss');
  el.hidden = false;
  const uids = Object.keys(dice.rolls).map(Number);
  el.innerHTML = `<div class="gm-dice-row">${uids.map(u => `
      <div class="gm-dice-p"><div class="muted">${esc(who(u))}</div><div class="gm-dice" data-u="${u}">${die(1)}${die(1)}</div>
      <b class="gm-dice-sum" hidden>${dice.rolls[u][0] + dice.rolls[u][1]}</b></div>`).join('')}</div>
    <div class="gm-toss-res" hidden>${dice.winner != null ? `Ходит ${esc(who(dice.winner))}` : 'Ничья, кидайте ещё раз'}</div>`;
  let ticks = 0;
  const t = setInterval(() => {
    ticks++;
    const done = ticks >= 12;
    for (const u of uids) {
      const box = el.querySelector(`.gm-dice[data-u="${u}"]`);
      if (!box) { clearInterval(t); return; }
      const v = done ? dice.rolls[u] : [1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)];
      box.innerHTML = die(v[0]) + die(v[1]);
      box.classList.toggle('roll', !done);
    }
    if (done) {
      clearInterval(t);
      el.querySelectorAll('.gm-dice-sum, .gm-toss-res').forEach(x => { x.hidden = false; });
      ctx.haptic('success');
    }
  }, 90);
}

async function loadCards() {
  try { cards = (await ctx.api('/api/game/cards')).cards; } catch (e) { $('#gm-list').innerHTML = '<div class="muted">Не загрузилось</div>'; return; }
  renderList();
}

let usedTimer = null;
function refreshUsed() {
  if (root.hidden) return;
  clearTimeout(usedTimer);
  usedTimer = setTimeout(loadCards, spinning ? SPIN_MS + 200 : 150);
}

function renderList() {
  $('#gm-filter').innerHTML = Object.entries(KIND).map(([k, v]) => {
    const n = cards.filter(c => c.kind === k).length;
    return `<button class="btn${filter === k ? ' primary' : ''}" data-f="${k}">${v.icon} ${v.many} ${n}</button>`;
  }).join('');
  $('#gm-new-kind').value = filter;
  const list = cards.filter(c => c.kind === filter);
  $('#gm-list').innerHTML = list.map(c => editing === c.id ? `
      <div class="gm-edit" data-id="${c.id}">
        <textarea class="input" rows="3">${esc(c.text)}</textarea>
        <div class="row" style="margin-top:6px">
          <select class="input gm-select">${Object.entries(KIND).map(([k, v]) => `<option value="${k}"${k === c.kind ? ' selected' : ''}>${v.icon} ${v.name}</option>`).join('')}</select>
          <button class="btn primary" data-save="${c.id}">Сохранить</button>
          <button class="btn danger" data-del="${c.id}">Удалить</button>
          <button class="btn" data-cancel="1">Отмена</button>
        </div>
      </div>` : `
      <button class="list-item gm-item${c.used ? ' used' : ''}" data-edit="${c.id}">
        <span>${esc(c.text)}</span>${c.used ? '<small class="muted">было</small>' : ''}
      </button>`).join('') || '<div class="muted">Тут пусто, добавь ниже</div>';
}

async function onListClick(e) {
  const t = e.target.closest('[data-edit],[data-save],[data-del],[data-cancel]');
  if (!t) return;
  if (t.dataset.edit) { editing = Number(t.dataset.edit); renderList(); root.querySelector('.gm-edit textarea')?.focus(); return; }
  if (t.dataset.cancel) { editing = null; renderList(); return; }
  if (t.dataset.del) {
    if (!confirm('Удалить карточку?')) return;
    try { await ctx.api(`/api/game/cards/${t.dataset.del}`, {method: 'DELETE'}); } catch (err) { return ctx.toast('Не удалилось'); }
    editing = null; return loadCards();
  }
  if (t.dataset.save) {
    const box = t.closest('.gm-edit');
    const text = box.querySelector('textarea').value.trim(), kind = box.querySelector('select').value;
    if (!text) return ctx.toast('Пустой текст');
    try {
      await ctx.api(`/api/game/cards/${t.dataset.save}`, {method: 'POST', body: JSON.stringify({kind, text})});
    } catch (err) { return ctx.toast('Не сохранилось'); }
    editing = null; filter = kind; ctx.toast('Сохранено'); return loadCards();
  }
}

async function addCards() {
  const texts = $('#gm-new').value.split('\n').map(s => s.trim()).filter(Boolean);
  if (!texts.length) return ctx.toast('Напиши хотя бы одну карточку');
  const kind = $('#gm-new-kind').value;
  try {
    const r = await ctx.api('/api/game/cards', {method: 'POST', body: JSON.stringify({kind, texts})});
    ctx.toast(`Добавлено: ${r.ids.length}`);
  } catch (e) { return ctx.toast('Не добавилось'); }
  $('#gm-new').value = '';
  filter = kind;
  loadCards();
}
