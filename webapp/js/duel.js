// Вкладка «Блок-дуэль»: лобби, игровое поле с перетаскиванием фигур, итог раунда.
// Сервер — судья: ходы применяем у себя сразу, а по ответу сервера сверяемся.
import {makeShapes, fits, canPlaceAnywhere, previewClear, pieceStream} from './engine.js';

const SIZE = 8;
const LOW_TIME = 20;
const CRIT_TIME = 10;

let ctx = null;
let shapes = null;
let el = {};
const queue = [];

const S = {
  view: 'lobby',
  ready: new Set(),
  duel: null,
  me: null,
  opp: null,
  oppUid: null,
  result: null,
  pending: [],
  seq: 0,
  selected: null,
  fresh: new Set(),
  timeUp: false,
};

let drag = null;
let hover = null;
let timer = null;
let stream = {seed: null, list: []};

// ---------- утилиты ----------

const h = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

function fmtTime(sec) {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function countTo(node, to, ms = 450) {
  const from = Number(node.dataset.val || 0);
  node.dataset.val = to;
  cancelAnimationFrame(node._raf);
  if (from === to) { node.textContent = to; return; }
  const t0 = performance.now();
  const step = now => {
    const k = Math.min(1, (now - t0) / ms);
    node.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)));
    if (k < 1) node._raf = requestAnimationFrame(step);
  };
  node._raf = requestAnimationFrame(step);
  if (to > from) { node.classList.remove('bump'); void node.offsetWidth; node.classList.add('bump'); }
}

function trayAt(seed, moves) {
  if (stream.seed !== seed || stream.list.length < moves + 3) {
    stream = {seed, list: pieceStream(seed, moves + 60, shapes)};
  }
  return stream.list.slice(moves, moves + 3);
}

const inDuel = d => !!d && d.players.includes(ctx.me);
const running = () => S.view === 'game' && S.duel && !S.duel.over;
const timeLeft = () => (S.duel ? S.duel.ends_at - ctx.serverNow() : 0);
const canMove = () => running() && S.me && !S.me.finished && timeLeft() > 0;

// ---------- локальная копия хода (та же логика, что в hub/duel_engine.py) ----------

function applyLocal(g, slot, row, col) {
  const shape = shapes[g.tray[slot]];
  for (const [r, c] of shape.cells) g.board[(row + r) * SIZE + col + c] = shape.color;
  const rows = [], cols = [];
  for (let r = 0; r < SIZE; r++) if (g.board.slice(r * SIZE, r * SIZE + SIZE).every(Boolean)) rows.push(r);
  for (let c = 0; c < SIZE; c++) {
    let full = true;
    for (let r = 0; r < SIZE; r++) if (!g.board[r * SIZE + c]) { full = false; break; }
    if (full) cols.push(c);
  }
  const cleared = new Map();
  for (const r of rows) for (let c = 0; c < SIZE; c++) cleared.set(r * SIZE + c, g.board[r * SIZE + c]);
  for (const c of cols) for (let r = 0; r < SIZE; r++) cleared.set(r * SIZE + c, g.board[r * SIZE + c]);
  for (const i of cleared.keys()) g.board[i] = 0;

  const lines = rows.length + cols.length;
  let points = shape.cells.length;
  if (lines) {
    g.streak += 1;
    g.miss = 0;
    points += Math.round(10 * lines * lines * (1 + 0.5 * (g.streak - 1)));
  } else {
    g.miss = (g.miss || 0) + 1;
    if (g.miss >= 3) g.streak = 0;
  }
  g.score += points;
  g.moves += 1;
  g.tray[slot] = null;
  if (g.tray.every(s => s == null)) g.tray = trayAt(S.duel.seed, g.moves);
  g.finished = !g.tray.some(s => s != null && canPlaceAnywhere(g.board, SIZE, shapes[s]));
  return {points, lines, cleared};
}

const copyGame = (g, miss = 0) => ({...g, board: g.board.slice(), tray: g.tray.slice(), miss});

// ---------- разметка ----------

function buildLobby() {
  const lobby = h('div', 'dl-lobby');
  lobby.innerHTML = `
    <div class="dl-hero">
      <div class="dl-deco" aria-hidden="true">
        <i class="dl-b k1"></i><i class="dl-b k3"></i><i class="dl-b k5"></i>
        <i class="dl-b k2"></i><i></i><i class="dl-b k6"></i>
        <i class="dl-b k4"></i><i class="dl-b k7"></i><i class="dl-b k1"></i>
      </div>
      <h1 class="dl-title">Блок-дуэль</h1>
      <p class="dl-sub muted">3 минуты, одинаковые фигуры у обоих. Собирай линии, держи серию — кто больше наберёт, тот и прав.</p>
    </div>
    <div class="dl-result" hidden>
      <div class="dl-res-title"></div>
      <div class="dl-res-scores">
        <div class="dl-res-side me"><span class="dl-res-name">Ты</span><b class="dl-res-num"></b></div>
        <div class="dl-res-sep">:</div>
        <div class="dl-res-side opp"><span class="dl-res-name"></span><b class="dl-res-num"></b></div>
      </div>
    </div>
    <div class="dl-players">
      <div class="dl-player me"><div class="dl-ava"></div><div class="dl-pname"></div><div class="dl-pstate"></div></div>
      <div class="dl-vs">VS</div>
      <div class="dl-player fr"><div class="dl-ava"></div><div class="dl-pname"></div><div class="dl-pstate"></div></div>
    </div>
    <p class="dl-hint"></p>
    <div class="dl-actions">
      <button class="btn primary wide dl-ready">Готов</button>
      <button class="btn wide dl-solo">Тренировка одному</button>
    </div>`;
  return lobby;
}

function buildGame() {
  const game = h('div', 'dl-game');
  game.innerHTML = `
    <div class="dl-bar">
      <div class="dl-side dl-mine">
        <div class="dl-lab">Ты</div>
        <div class="dl-score" data-val="0">0</div>
        <div class="dl-streak" hidden></div>
      </div>
      <div class="dl-timer">3:00</div>
      <div class="dl-side dl-opp">
        <div class="dl-oinfo">
          <div class="dl-lab dl-oname"></div>
          <div class="dl-oscore" data-val="0">0</div>
          <div class="dl-ofin" hidden>ходов нет</div>
        </div>
        <div class="dl-mini"></div>
      </div>
      <div class="dl-side dl-practice" hidden><div class="dl-lab">Режим</div><div class="dl-ptitle">Тренировка</div></div>
    </div>
    <div class="dl-stage">
      <div class="dl-board">
        <div class="dl-grid"></div>
        <div class="dl-fx"></div>
        <div class="dl-over" hidden>
          <div class="dl-over-title"></div>
          <div class="dl-over-sub"></div>
        </div>
      </div>
      <div class="dl-tray"></div>
    </div>`;
  return game;
}

// ---------- лобби ----------

function renderLobby() {
  const me = ctx.me, fr = ctx.friend();
  const busy = S.duel && !S.duel.over && !inDuel(S.duel);
  const meReady = S.ready.has(me), frReady = fr != null && S.ready.has(fr);
  const frOnline = fr != null && ctx.online.includes(fr);

  const card = (node, uid, isMe) => {
    const name = uid == null ? 'Нет друга' : (isMe ? ctx.name(uid) : ctx.name(uid));
    const online = uid != null && (isMe || ctx.online.includes(uid));
    const ready = uid != null && S.ready.has(uid);
    node.querySelector('.dl-ava').textContent = (name || '?').trim().charAt(0).toUpperCase();
    node.querySelector('.dl-pname').textContent = isMe ? `${name} (ты)` : name;
    const st = node.querySelector('.dl-pstate');
    st.className = 'dl-pstate' + (ready ? ' ready' : online ? ' on' : '');
    st.textContent = ready ? 'готов ✓' : online ? 'в Хате' : 'не в сети';
    node.classList.toggle('is-ready', ready);
    node.classList.toggle('is-off', !online);
  };
  card(el.lobby.querySelector('.dl-player.me'), me, true);
  card(el.lobby.querySelector('.dl-player.fr'), fr, false);

  const r = S.result;
  const btn = el.lobby.querySelector('.dl-ready');
  btn.textContent = meReady ? (frReady ? 'Начинаем…' : 'Жду друга…') : (r && !r.solo ? 'Реванш' : 'Готов');
  btn.classList.toggle('waiting', meReady);
  btn.disabled = !!busy;
  el.lobby.querySelector('.dl-solo').disabled = !!busy;
  el.lobby.querySelector('.dl-solo').textContent = r && r.solo ? 'Ещё тренировка' : 'Тренировка одному';

  const hint = el.lobby.querySelector('.dl-hint');
  let text = '', cls = 'dl-hint';
  if (busy) { text = 'Друг тренируется — дождись конца его раунда'; }
  else if (fr == null) { text = 'Второго игрока пока нет — можно потренироваться'; }
  else if (!frOnline) { text = 'Друг не в Хате — позови его'; cls += ' warn'; }
  else if (frReady && !meReady) { text = 'Друг уже готов — жми «Готов»!'; cls += ' go'; }
  else if (meReady && !frReady) { text = 'Как только друг нажмёт «Готов», начнём'; }
  hint.className = cls;
  hint.textContent = text;
  hint.hidden = !text;
}

function renderResult() {
  const box = el.lobby.querySelector('.dl-result');
  const r = S.result;
  box.hidden = !r;
  if (!r) return;
  const me = ctx.me;
  const oppUid = Object.keys(r.scores).map(Number).find(u => u !== me);
  const title = box.querySelector('.dl-res-title');
  const sides = box.querySelectorAll('.dl-res-side');
  let kind;
  if (r.solo) kind = 'solo';
  else if (r.winner == null) kind = 'draw';
  else kind = r.winner === me ? 'win' : 'lose';
  box.className = 'dl-result ' + kind;
  title.textContent = {solo: `Твой счёт ${r.scores[me] ?? 0}`, draw: 'Ничья', win: 'Победа!', lose: 'Поражение'}[kind];
  box.querySelector('.dl-res-scores').hidden = r.solo;
  if (!r.solo) {
    sides[1].querySelector('.dl-res-name').textContent = ctx.name(oppUid);
    const a = sides[0].querySelector('.dl-res-num'), b = sides[1].querySelector('.dl-res-num');
    a.dataset.val = 0; b.dataset.val = 0;
    countTo(a, r.scores[me] ?? 0, 700);
    countTo(b, r.scores[oppUid] ?? 0, 700);
    sides[0].classList.toggle('lead', kind === 'win');
    sides[1].classList.toggle('lead', kind === 'lose');
  }
}

// ---------- игра ----------

function renderBoard(preview) {
  const b = S.me.board;
  for (let i = 0; i < SIZE * SIZE; i++) {
    let cls = 'dl-cell';
    if (preview && preview.clear.has(i)) cls += ' dl-b dl-hl k' + preview.color;
    else if (preview && preview.ghost.has(i)) cls += ' dl-ghost';
    else if (b[i]) cls += ' dl-b k' + b[i] + (S.fresh.has(i) ? ' dl-new' : '');
    if (el.cells[i].className !== cls) el.cells[i].className = cls;
  }
}

function renderTray() {
  const g = S.me;
  const geo = boardGeo();
  const slots = el.tray.children;
  for (let i = 0; i < 3; i++) {
    const slot = slots[i];
    const s = g.tray[i];
    slot.replaceChildren();
    slot.className = 'dl-slot';
    if (s == null) { slot.classList.add('empty'); continue; }
    const shape = shapes[s];
    const sw = slot.clientWidth || 100, sh = slot.clientHeight || 80;
    const base = geo.pitch * 0.52;
    const pitch = Math.min(base, (sw - 14) / shape.nc, (sh - 14) / shape.nr);
    slot.append(pieceNode(shape, pitch * (geo.cell / geo.pitch), pitch, 'dl-piece'));
    if (!canPlaceAnywhere(g.board, SIZE, shape)) slot.classList.add('dim');
    if (S.selected === i) slot.classList.add('sel');
    if (drag && drag.slot === i) slot.classList.add('lifted');
  }
}

function renderMine() {
  const g = S.me;
  countTo(el.score, g.score);
  const st = el.streak;
  st.hidden = g.streak < 2;
  if (g.streak >= 2 && st.textContent !== `Серия ×${g.streak}`) {
    st.textContent = `Серия ×${g.streak}`;
    st.classList.remove('bump'); void st.offsetWidth; st.classList.add('bump');
  }
  const over = el.game.querySelector('.dl-over');
  const showOver = g.finished || S.timeUp;
  over.hidden = !showOver;
  if (showOver) {
    over.querySelector('.dl-over-title').textContent = S.timeUp && !g.finished ? 'Время!' : 'Ходов нет';
    over.querySelector('.dl-over-sub').textContent = S.oppUid != null
      ? `Твой счёт ${g.score} — ждём конца раунда` : `Твой счёт ${g.score}`;
  }
}

function renderOpp() {
  const solo = S.oppUid == null;
  el.game.querySelector('.dl-opp').hidden = solo;
  el.game.querySelector('.dl-practice').hidden = !solo;
  if (solo || !S.opp) return;
  el.game.querySelector('.dl-oname').textContent = ctx.name(S.oppUid);
  countTo(el.oscore, S.opp.score);
  el.game.querySelector('.dl-ofin').hidden = !S.opp.finished;
  const b = S.opp.board;
  for (let i = 0; i < SIZE * SIZE; i++) {
    const cls = b[i] ? 'dl-mc k' + b[i] : 'dl-mc';
    if (el.mini[i].className !== cls) el.mini[i].className = cls;
  }
}

function renderGame() {
  if (!S.me) return;
  renderBoard(currentPreview());
  renderTray();
  renderMine();
  renderOpp();
  tick();
}

function tick() {
  if (S.view !== 'game' || !S.duel) return;
  const left = timeLeft();
  el.timer.textContent = fmtTime(left);
  el.timer.classList.toggle('low', left < LOW_TIME);
  el.timer.classList.toggle('crit', left < CRIT_TIME && left > 0);
  if (left <= 0 && !S.timeUp && !S.duel.over) {
    S.timeUp = true;
    cancelDrag();
    renderMine();
  }
}

function paint() {
  el.lobby.hidden = S.view !== 'lobby';
  el.game.hidden = S.view !== 'game';
  el.root.classList.toggle('in-game', S.view === 'game');
  clearInterval(timer);
  if (S.view === 'game') {
    timer = setInterval(tick, 250);
    window.scrollTo(0, 0);
    fit();
    renderGame();
  } else {
    renderLobby();
    renderResult();
  }
}

// Подгоняем поле под экран: всё должно влезть без прокрутки над нижними вкладками
function fit() {
  if (S.view !== 'game' || el.game.hidden || !el.game.offsetParent) return;
  const tabs = document.querySelector('.tabs');
  const tabsH = tabs ? tabs.getBoundingClientRect().height : 64;
  const top = el.game.getBoundingClientRect().top + window.scrollY;
  const avail = Math.max(320, window.innerHeight - tabsH - top - 8);
  el.game.style.height = avail + 'px';
  const bar = el.game.querySelector('.dl-bar').offsetHeight;
  const width = el.game.clientWidth;
  // поле + лоток (четверть поля) + отступы
  const bs = Math.floor(Math.min(width, 420, (avail - bar - 26) / 1.27));
  el.root.style.setProperty('--bs', bs + 'px');
  if (S.me) renderTray();
}

// ---------- геометрия и фигуры ----------

function boardGeo() {
  const a = el.cells[0].getBoundingClientRect(), b = el.cells[1].getBoundingClientRect();
  return {x: a.left, y: a.top, cell: a.width || 30, pitch: (b.left - a.left) || 34};
}

function pieceNode(shape, cell, pitch, cls) {
  const n = h('div', cls);
  n.style.width = (shape.nc * pitch - (pitch - cell)) + 'px';
  n.style.height = (shape.nr * pitch - (pitch - cell)) + 'px';
  for (const [r, c] of shape.cells) {
    const b = h('i', 'dl-b k' + shape.color);
    b.style.cssText = `left:${c * pitch}px;top:${r * pitch}px;width:${cell}px;height:${cell}px`;
    n.append(b);
  }
  return n;
}

function makePreview(shape, row, col) {
  if (!fits(S.me.board, SIZE, shape, row, col)) return null;
  const ghost = new Set(shape.cells.map(([r, c]) => (row + r) * SIZE + col + c));
  const {rows, cols} = previewClear(S.me.board, SIZE, shape, row, col);
  const clear = new Set();
  for (const r of rows) for (let c = 0; c < SIZE; c++) clear.add(r * SIZE + c);
  for (const c of cols) for (let r = 0; r < SIZE; r++) clear.add(r * SIZE + c);
  return {row, col, ghost, clear, color: shape.color};
}

function currentPreview() {
  if (drag && drag.preview) return drag.preview;
  return hover;
}

// ---------- ход ----------

function commit(slot, row, col) {
  const g = S.me;
  const shape = shapes[g.tray[slot]];
  if (!canMove() || !fits(g.board, SIZE, shape, row, col)) return false;
  const before = copyGame(g, g.miss);
  const id = ++S.seq;
  if (!ctx.send({t: 'duel_move', slot, row, col, id})) {
    ctx.toast('Нет связи с Хатой');
    ctx.haptic('error');
    return false;
  }
  S.pending.push(id);
  const res = applyLocal(g, slot, row, col);
  S.selected = null;
  hover = null;

  // свежепоставленные клетки слегка «впрыгивают»
  S.fresh = new Set(shape.cells.map(([r, c]) => (row + r) * SIZE + col + c).filter(i => g.board[i]));
  clearTimeout(S.freshT);
  S.freshT = setTimeout(() => { S.fresh = new Set(); }, 260);

  if (res.cleared.size) {
    burst(res.cleared, row, col, shape);
    ctx.haptic('medium');
  } else {
    ctx.haptic('light');
  }
  popup(res.points, res.lines, row, col, shape);
  renderGame();
  if (g.finished && !before.finished) ctx.haptic('warning');
  return true;
}

function burst(cleared, row, col, shape) {
  const cr = row + (shape.nr - 1) / 2, cc = col + (shape.nc - 1) / 2;
  for (const [i, v] of cleared) {
    const cell = el.cells[i];
    const fx = h('i', 'dl-b dl-boom k' + (v || shape.color));
    fx.style.cssText = `left:${cell.offsetLeft}px;top:${cell.offsetTop}px;width:${cell.offsetWidth}px;height:${cell.offsetHeight}px;` +
      `animation-delay:${Math.round(Math.hypot(Math.floor(i / SIZE) - cr, (i % SIZE) - cc) * 22)}ms`;
    el.fx.append(fx);
    setTimeout(() => fx.remove(), 560);
  }
  el.board.classList.remove('shake'); void el.board.offsetWidth; el.board.classList.add('shake');
}

function popup(points, lines, row, col, shape) {
  const geo = el.cells[0];
  const pitch = el.cells[1].offsetLeft - geo.offsetLeft;
  const bs = el.board.clientWidth;
  const x = Math.min(bs - 40, Math.max(40, geo.offsetLeft + (col + shape.nc / 2) * pitch));
  const y = Math.max(24, geo.offsetTop + (row + shape.nr / 2) * pitch);
  const p = h('div', 'dl-pop' + (lines ? ' big' : ''), `+${points}`);
  if (lines >= 2) p.append(h('small', null, `${lines} линии`));
  p.style.left = x + 'px';
  p.style.top = y + 'px';
  el.fx.append(p);
  setTimeout(() => p.remove(), 950);
}

// ---------- перетаскивание ----------

function startDrag(e, slot) {
  if (!canMove() || drag) return;
  const s = S.me.tray[slot];
  if (s == null) return;
  const shape = shapes[s];
  const slotEl = el.tray.children[slot];
  if (!canPlaceAnywhere(S.me.board, SIZE, shape)) {
    ctx.haptic('error');
    slotEl.classList.remove('nope'); void slotEl.offsetWidth; slotEl.classList.add('nope');
    return;
  }
  e.preventDefault();
  try { slotEl.setPointerCapture(e.pointerId); } catch (err) {}
  const geo = boardGeo();
  const node = pieceNode(shape, geo.cell, geo.pitch, 'dl-float');
  const wrap = h('div', 'dl-floatwrap');
  wrap.append(node);
  document.body.append(wrap);
  drag = {
    slot, shape, geo, wrap, node, id: e.pointerId, touch: e.pointerType !== 'mouse',
    x0: e.clientX, y0: e.clientY, t0: performance.now(), moved: false, preview: null,
    w: parseFloat(node.style.width), h: parseFloat(node.style.height),
  };
  slotEl.classList.add('lifted');
  moveDrag(e.clientX, e.clientY);
}

function dragPos(x, y) {
  const lift = drag.touch ? drag.geo.pitch * 1.25 : 0;
  const left = x - drag.w / 2;
  const top = drag.touch ? y - drag.h - lift : y - drag.h / 2;
  return {left, top};
}

function moveDrag(x, y) {
  if (!drag) return;
  if (Math.hypot(x - drag.x0, y - drag.y0) > 8) drag.moved = true;
  const {left, top} = dragPos(x, y);
  drag.wrap.style.transform = `translate3d(${left}px, ${top}px, 0)`;
  const g = drag.geo;
  const col = Math.round((left - g.x) / g.pitch);
  const row = Math.round((top - g.y) / g.pitch);
  const prev = drag.preview;
  if (prev && prev.row === row && prev.col === col) return;
  drag.preview = makePreview(drag.shape, row, col);
  if (prev || drag.preview) renderBoard(drag.preview);
  drag.wrap.classList.toggle('ok', !!drag.preview);
}

function endDrag(e, cancelled) {
  if (!drag || (e && e.pointerId !== drag.id)) return;
  const d = drag;
  const isTap = !d.moved && performance.now() - d.t0 < 450;
  if (!cancelled && isTap) {
    dropFloating(d);
    drag = null;
    S.selected = S.selected === d.slot ? null : d.slot;
    hover = null;
    ctx.haptic('light');
    renderBoard(null);
    renderTray();
    return;
  }
  drag = null;
  if (!cancelled && d.preview && commit(d.slot, d.preview.row, d.preview.col)) {
    d.wrap.remove();
    return;
  }
  if (!cancelled && d.moved) ctx.haptic('error');
  renderBoard(hover);
  flyBack(d);
}

function dropFloating(d) { d.wrap.remove(); el.tray.children[d.slot]?.classList.remove('lifted'); }

function flyBack(d) {
  const slotEl = el.tray.children[d.slot];
  const target = slotEl?.querySelector('.dl-piece');
  if (!target || !S.me || S.me.tray[d.slot] == null) { dropFloating(d); renderTray(); return; }
  const r = target.getBoundingClientRect();
  const k = r.width / d.w;
  d.wrap.classList.add('back');
  d.wrap.style.transform = `translate3d(${r.left}px, ${r.top}px, 0) scale(${k})`;
  setTimeout(() => { dropFloating(d); renderTray(); }, 190);
}

function cancelDrag() {
  if (!drag) return;
  const d = drag;
  drag = null;
  dropFloating(d);
  if (S.me) { renderBoard(null); renderTray(); }
}

// Запасной путь: выбрал фигуру тапом — тапни клетку поля (фигура встанет центром туда)
function cellFromPoint(x, y) {
  const g = boardGeo();
  const c = Math.floor((x - g.x + (g.pitch - g.cell) / 2) / g.pitch);
  const r = Math.floor((y - g.y + (g.pitch - g.cell) / 2) / g.pitch);
  return (r < 0 || c < 0 || r >= SIZE || c >= SIZE) ? null : {r, c};
}

function anchorFor(shape, cell) {
  return {row: cell.r - Math.floor((shape.nr - 1) / 2), col: cell.c - Math.floor((shape.nc - 1) / 2)};
}

function boardHover(e) {
  if (drag || S.selected == null || !canMove() || e.pointerType !== 'mouse') return;
  const shape = shapes[S.me.tray[S.selected]];
  const cell = cellFromPoint(e.clientX, e.clientY);
  let next = null;
  if (cell && shape) {
    const {row, col} = anchorFor(shape, cell);
    next = makePreview(shape, row, col);
  }
  if (next?.row === hover?.row && next?.col === hover?.col) return;
  hover = next;
  renderBoard(hover);
}

function boardTap(e) {
  if (drag || S.selected == null || !canMove()) return;
  const shape = shapes[S.me.tray[S.selected]];
  const cell = cellFromPoint(e.clientX, e.clientY);
  if (!shape || !cell) return;
  e.preventDefault();
  const {row, col} = anchorFor(shape, cell);
  if (!commit(S.selected, row, col)) {
    ctx.haptic('error');
    ctx.toast('Не влезает');
  }
}

// ---------- сообщения сервера ----------

function applyDuel(d, fromState) {
  S.duel = d;
  if (d && inDuel(d) && !d.over) {
    enterGame(d);
    return;
  }
  cancelDrag();
  if (fromState && d && d.over && inDuel(d) && !S.result) {
    const scores = Object.fromEntries(Object.entries(d.games).map(([u, g]) => [u, g.score]));
    let winner = null;
    if (d.players.length === 2) {
      const [a, b] = d.players;
      const sa = d.games[String(a)].score, sb = d.games[String(b)].score;
      winner = sa > sb ? a : sb > sa ? b : null;
    }
    S.result = {scores, winner, solo: d.players.length === 1};
  }
  S.view = 'lobby';
  paint();
}

function enterGame(d) {
  cancelDrag();
  const mine = d.games[String(ctx.me)];
  S.me = copyGame(mine, S.me && S.view === 'game' ? S.me.miss : 0);
  S.oppUid = d.players.find(u => u !== ctx.me) ?? null;
  S.opp = S.oppUid != null ? d.games[String(S.oppUid)] : null;
  S.pending = [];
  S.selected = null;
  hover = null;
  S.timeUp = false;
  S.result = null;
  const fresh = S.view !== 'game';
  S.view = 'game';
  if (fresh) { el.score.dataset.val = mine.score; el.oscore.dataset.val = S.opp ? S.opp.score : 0; }
  paint();
}

function adopt(game) {
  S.me = copyGame(game, S.me ? S.me.miss : 0);
  renderGame();
}

const handlers = {
  state(m) {
    S.ready = new Set(m.ready || []);
    applyDuel(m.duel || null, true);
  },
  ready(m) {
    const fr = ctx.friend();
    const was = fr != null && S.ready.has(fr);
    S.ready = new Set(m.ready || []);
    if (fr != null && !was && S.ready.has(fr) && S.view === 'lobby') ctx.haptic('light');
    if (S.view === 'lobby') renderLobby();
  },
  presence(m) {
    if (m.ready) S.ready = new Set(m.ready);
    if (S.view === 'lobby') renderLobby(); else renderOpp();
  },
  duel_start(m) {
    if (inDuel(m.duel)) { S.ready.clear(); ctx.haptic('heavy'); }
    applyDuel(m.duel, false);
  },
  duel_ack(m) {
    const i = S.pending.indexOf(m.id);
    if (i >= 0) S.pending.splice(i, 1);
    if (S.view !== 'game' || !S.me) return;
    if (!m.ok) {
      S.pending = [];
      if (m.game) adopt(m.game);
      ctx.toast(timeLeft() <= 0 ? 'Время вышло' : 'Не влезает');
      ctx.haptic('error');
      return;
    }
    if (!S.pending.length && m.game) adopt(m.game);
  },
  duel_opp(m) {
    if (S.view !== 'game' || m.uid !== S.oppUid) return;
    S.opp = m.game;
    renderOpp();
    el.game.querySelector('.dl-mini').classList.remove('ping');
    void el.game.offsetWidth;
    el.game.querySelector('.dl-mini').classList.add('ping');
  },
  duel_end(m) {
    const mine = S.duel && inDuel(S.duel);
    if (S.duel) S.duel.over = true;
    cancelDrag();
    if (mine) {
      S.result = {scores: m.scores, winner: m.winner, solo: !!m.solo};
      if (!m.solo && m.winner === ctx.me) ctx.haptic('success');
      else if (!m.solo && m.winner != null) ctx.haptic('heavy');
    }
    S.view = 'lobby';
    S.ready.clear();
    paint();
  },
};

// ---------- вход ----------

export function mount(root, c) {
  ctx = c;
  root.classList.add('dl-root');
  el.root = root;
  el.lobby = buildLobby();
  el.game = buildGame();
  el.game.hidden = true;
  root.append(el.lobby, el.game);

  el.grid = el.game.querySelector('.dl-grid');
  el.board = el.game.querySelector('.dl-board');
  el.fx = el.game.querySelector('.dl-fx');
  el.tray = el.game.querySelector('.dl-tray');
  el.timer = el.game.querySelector('.dl-timer');
  el.score = el.game.querySelector('.dl-score');
  el.oscore = el.game.querySelector('.dl-oscore');
  el.streak = el.game.querySelector('.dl-streak');
  el.cells = Array.from({length: SIZE * SIZE}, () => el.grid.appendChild(h('div', 'dl-cell')));
  const mini = el.game.querySelector('.dl-mini');
  el.mini = Array.from({length: SIZE * SIZE}, () => mini.appendChild(h('i', 'dl-mc')));

  for (let i = 0; i < 3; i++) {
    const slot = el.tray.appendChild(h('div', 'dl-slot'));
    slot.addEventListener('pointerdown', e => startDrag(e, i));
    slot.addEventListener('pointermove', e => { if (drag && e.pointerId === drag.id) moveDrag(e.clientX, e.clientY); });
    slot.addEventListener('pointerup', e => endDrag(e, false));
    slot.addEventListener('pointercancel', e => endDrag(e, true));
    slot.addEventListener('lostpointercapture', e => { if (drag && e.pointerId === drag.id) endDrag(e, false); });
  }
  el.board.addEventListener('pointerdown', boardTap);
  el.board.addEventListener('pointermove', boardHover);
  el.board.addEventListener('pointerleave', () => { if (hover) { hover = null; renderBoard(null); } });

  el.lobby.querySelector('.dl-ready').addEventListener('click', () => {
    const on = !S.ready.has(ctx.me);
    if (!ctx.send({t: 'duel_ready', on})) { ctx.toast('Нет связи с Хатой'); return; }
    ctx.haptic(on ? 'medium' : 'light');
    if (on) S.ready.add(ctx.me); else S.ready.delete(ctx.me);
    renderLobby();
  });
  el.lobby.querySelector('.dl-solo').addEventListener('click', () => {
    if (!ctx.send({t: 'duel_solo'})) { ctx.toast('Нет связи с Хатой'); return; }
    ctx.haptic('medium');
  });

  window.addEventListener('resize', () => { cancelDrag(); fit(); });
  window.Telegram?.WebApp?.onEvent?.('viewportChanged', () => fit());

  // сообщения, пришедшие до загрузки фигур, разбираем потом по порядку
  for (const [type, fn] of Object.entries(handlers)) {
    ctx.on(type, m => (shapes ? fn(m) : queue.push([fn, m])));
  }
  fetch('/shapes.json').then(r => r.json()).then(data => {
    shapes = makeShapes(data).map(s => ({
      ...s,
      nr: Math.max(...s.cells.map(([r]) => r)) + 1,
      nc: Math.max(...s.cells.map(([, c]) => c)) + 1,
    }));
    while (queue.length) { const [fn, m] = queue.shift(); try { fn(m); } catch (e) { console.error(e); } }
  }).catch(() => ctx.toast('Не загрузились фигуры, обнови страницу'));

  renderLobby();
}

export function show() {
  if (S.view === 'game') requestAnimationFrame(fit);
  else if (ctx) renderLobby();
}
