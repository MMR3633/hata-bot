// Вкладка «Экран»: общий браузер на сервере. Оба видят одну картинку и оба управляют.
let ctx, root, ws = null, url = '', view = {w: 412, h: 860}, frameUrl = null, retry = null, active = false;
const $ = s => root.querySelector(s);

const VIDEO_RE = [
  [/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/, 'yt'],
  [/rutube\.ru\/(?:video|shorts)\/([0-9a-f]{32})/, 'rutube'],
  [/(?:vk\.com|vk\.ru|vkvideo\.ru)\/.*video(-?\d+_\d+)/, 'vk'],
];

export function mount(el, c) {
  ctx = c; root = el;
  root.classList.add('sc-tab');
  root.innerHTML = `
    <div class="sc-bar">
      <button class="sc-ic" data-act="back" aria-label="Назад">‹</button>
      <button class="sc-ic" data-act="reload" aria-label="Обновить">↻</button>
      <form class="sc-addr"><input class="input" id="sc-url" placeholder="Поиск или адрес" autocomplete="off" enterkeyhint="go"></form>
      <button class="sc-ic" data-act="mode" aria-label="Телефон или компьютер">📱</button>
    </div>
    <div class="sc-stage">
      <div class="sc-screen">
        <img id="sc-img" alt="" draggable="false">
        <div class="sc-msg" id="sc-msg">Подключаюсь к общему браузеру…</div>
      </div>
    </div>
    <div class="sc-tools">
      <button class="btn" data-act="kbd">⌨️</button>
      <button class="btn" data-video="back">−10</button>
      <button class="btn primary" data-video="toggle">⏯</button>
      <button class="btn" data-video="fwd">+10</button>
      <button class="btn" data-act="sound" id="sc-sound" hidden>🔊 Со звуком</button>
      <span class="sc-viewers muted" id="sc-viewers"></span>
    </div>
    <input id="sc-kbd" class="sc-kbd" autocomplete="off" autocapitalize="off" aria-hidden="true">
    <div class="sc-note muted">Звук из общего браузера не идёт. Видео со звуком у обоих: кнопка «🔊 Со звуком» включит его во вкладке «Кино».</div>`;

  $('#sc-url').addEventListener('focus', e => e.target.select());
  $('.sc-addr').addEventListener('submit', e => {
    e.preventDefault();
    const v = $('#sc-url').value.trim();
    if (v) { send({t: 'goto', url: v}); $('#sc-url').blur(); }
  });
  root.addEventListener('click', e => {
    const b = e.target.closest('[data-act],[data-video]');
    if (!b) return;
    ctx.haptic('light');
    if (b.dataset.video) return send({t: 'video', act: b.dataset.video});
    const act = b.dataset.act;
    if (act === 'back' || act === 'reload') send({t: act});
    if (act === 'mode') send({t: 'mode', mode: view.w < 600 ? 'desktop' : 'phone'});
    if (act === 'kbd') { const k = $('#sc-kbd'); k.value = ''; k.focus(); }
    if (act === 'sound') soundTogether();
  });
  bindPointer();
  bindKeyboard();
  window.addEventListener('resize', fit);
}

export function show() {
  active = true;
  if (!ws || ws.readyState > 1) connect();
  fit();
}

export function hide() {
  active = false;
  clearTimeout(retry);
  if (ws) { ws.onclose = null; ws.close(); ws = null; }
}

function send(msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); }

function connect() {
  if (!ctx.screenUrl) { $('#sc-msg').textContent = 'Общий браузер не настроен'; return; }
  const u = ctx.screenUrl.replace(/^http/, 'ws') + '/ws?t=' + encodeURIComponent(ctx.token);
  ws = new WebSocket(u);
  ws.binaryType = 'blob';
  $('#sc-msg').hidden = false;
  ws.onmessage = e => {
    if (typeof e.data !== 'string') return showFrame(e.data);
    const m = JSON.parse(e.data);
    if (m.t === 'hello' && m.starting) $('#sc-msg').textContent = 'Запускаю браузер, пару секунд…';
    if (m.t === 'nav') onNav(m);
    if (m.t === 'viewers') $('#sc-viewers').textContent = 'Смотрят: ' + m.uids.map(u => u === ctx.me ? 'ты' : ctx.name(u)).join(', ');
    if (m.t === 'error') ctx.toast(m.text);
  };
  ws.onclose = () => {
    $('#sc-msg').hidden = false;
    $('#sc-msg').textContent = 'Связь с общим браузером пропала, переподключаюсь…';
    if (active) retry = setTimeout(connect, 2000);
  };
}

function showFrame(blob) {
  const next = URL.createObjectURL(blob);
  const img = $('#sc-img');
  img.onload = () => { if (frameUrl && frameUrl !== next) URL.revokeObjectURL(frameUrl); frameUrl = next; };
  img.src = next;
  $('#sc-msg').hidden = true;
}

function onNav(m) {
  url = m.url;
  view = {w: m.w, h: m.h};
  if (document.activeElement !== $('#sc-url')) $('#sc-url').value = m.url.startsWith('about:') ? '' : m.url;
  root.querySelector('[data-act="mode"]').textContent = view.w < 600 ? '📱' : '🖥';
  $('#sc-sound').hidden = !videoOf(m.url);
  fit();
}

function videoOf(u) {
  for (const [re, src] of VIDEO_RE) { const x = (u || '').match(re); if (x) return {src, id: x[1]}; }
  return null;
}

function soundTogether() {
  const v = videoOf(url);
  if (!v) return;
  send({t: 'video', act: 'toggle'});
  ctx.send({t: 'watch_set', src: v.src, id: v.id, title: ''});
  document.querySelector('.tabs button[data-go="watch"]')?.click();
}

// размер «экрана» под доступное место, с сохранением пропорций
function fit() {
  const stage = $('.sc-stage');
  if (!stage || root.hidden) return;
  const top = stage.getBoundingClientRect().top;
  const tabs = document.querySelector('.tabs')?.getBoundingClientRect().height || 64;
  const availH = Math.max(240, window.innerHeight - top - tabs - 70);
  const availW = stage.clientWidth;
  const k = Math.min(availW / view.w, availH / view.h);
  const box = $('.sc-screen');
  box.style.width = Math.floor(view.w * k) + 'px';
  box.style.height = Math.floor(view.h * k) + 'px';
}

function rel(e) {
  const r = $('#sc-img').getBoundingClientRect();
  return {x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, r};
}

// тап = клик, протяжка = прокрутка, колесо мыши = прокрутка
function bindPointer() {
  const box = $('.sc-screen');
  let start = null, last = null, moved = false;
  box.addEventListener('pointerdown', e => {
    box.setPointerCapture(e.pointerId);
    start = last = rel(e); moved = false;
  });
  box.addEventListener('pointermove', e => {
    if (!start) return;
    const p = rel(e);
    const dx = (p.x - last.x) * view.w, dy = (p.y - last.y) * view.h;
    if (!moved && Math.hypot((p.x - start.x) * p.r.width, (p.y - start.y) * p.r.height) > 8) moved = true;
    if (moved && (Math.abs(dx) + Math.abs(dy) > 2)) {
      send({t: 'scroll', x: p.x, y: p.y, dx: -dx * 1.6, dy: -dy * 1.6});
      last = p;
    }
  });
  box.addEventListener('pointerup', e => {
    if (start && !moved) { const p = rel(e); send({t: 'tap', x: p.x, y: p.y}); ctx.haptic('light'); }
    start = null;
  });
  box.addEventListener('pointercancel', () => { start = null; });
  box.addEventListener('wheel', e => {
    e.preventDefault();
    const p = rel(e);
    send({t: 'scroll', x: p.x, y: p.y, dx: e.deltaX, dy: e.deltaY});
  }, {passive: false});
}

// скрытое поле: на телефоне поднимает клавиатуру, текст уходит в общий браузер
function bindKeyboard() {
  const k = $('#sc-kbd');
  k.addEventListener('input', e => {
    if (e.data) send({t: 'text', text: e.data});
    else if (e.inputType === 'deleteContentBackward') send({t: 'key', key: 'Backspace'});
    k.value = '';
  });
  k.addEventListener('keydown', e => {
    if (['Enter', 'Backspace', 'Tab', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      if (e.key === 'Backspace' && k.value) return;
      e.preventDefault();
      send({t: 'key', key: e.key});
    }
  });
}
