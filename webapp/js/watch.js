// Вкладка «Кино вместе»: общий плеер (YouTube / RuTube / VK), реакции и чат.
// Сервер хранит авторитетное состояние {playing, pos, at}; клиент подстраивает под него свой плеер.

const REACTIONS = ['😂', '🔥', '😮', '👍', '❤️', '💀', '🤡', '👏'];
const SRC_NAME = {yt: 'YouTube', rutube: 'RuTube', vk: 'VK Видео'};
const ECHO_MS = 1000;      // после своих команд плееру не принимаем его события за действия человека
const DRIFT = 2;           // расхождение (с), после которого перематываем
const TICK_MS = 500;
const RECONCILE_MS = 5000;
const JOIN_CHECK_MS = 2500;
const SETTLE_MS = 3000;

let ctx, root;
const ui = {};
let shared = null;          // {src, id, title, playing, pos, at, by}
let setBy = null;           // кто включил текущее видео
let player = null, playerKey = '';
let quietUntil = 0, last = null, lastReconcile = 0, lastActivity = 0;
let pendingPlay = false, joinTimer = null;
let srcPref = 'yt', searchOpen = false, searchSeq = 0;

// ---------- мелочи ----------

function h(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
}

const nowMs = () => performance.now();
const quiet = () => { quietUntil = nowMs() + ECHO_MS; last = null; };

function expected() {
  if (!shared) return 0;
  return shared.playing ? shared.pos + Math.max(0, ctx.serverNow() - shared.at) : shared.pos;
}

const scripts = {};
function loadScript(src) {
  return scripts[src] ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = resolve;
    s.onerror = () => { delete scripts[src]; reject(new Error('script ' + src)); };
    document.head.append(s);
  });
}

function makeFrame(src) {
  const fr = document.createElement('iframe');
  fr.src = src;
  fr.allow = 'autoplay; fullscreen; encrypted-media; picture-in-picture; clipboard-write';
  fr.setAttribute('allowfullscreen', '');
  fr.referrerPolicy = 'strict-origin-when-cross-origin';
  return fr;
}

// ---------- адаптеры плееров: load, play, pause, seek, getTime, isPlaying ----------

let ytReady = null;
function ytApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  return ytReady ||= new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(window.YT); };
    loadScript('https://www.youtube.com/iframe_api').catch(e => { ytReady = null; reject(e); });
  });
}

function ytPlayer(box, ev) {
  let p = null, state = -1, alive = true;
  const a = {
    ready: false,
    async load(id) {
      const mount = h('div');
      box.append(mount);
      try {
        const YT = await ytApi();
        if (!alive) return;
        p = new YT.Player(mount, {
          width: '100%', height: '100%', videoId: id,
          playerVars: {playsinline: 1, rel: 0, modestbranding: 1, iv_load_policy: 3},
          events: {
            onReady: () => { a.ready = true; ev.ready(); },
            onStateChange: e => {
              state = e.data;
              ev.activity();
              if (e.data === 1) ev.play();
              else if (e.data === 2) ev.pause();
            },
            onError: () => ev.error('YouTube не отдаёт это видео'),
          },
        });
      } catch (e) {
        ev.error('YouTube-плеер не загрузился');
      }
    },
    play: () => p?.playVideo?.(),
    pause: () => p?.pauseVideo?.(),
    seek: sec => p?.seekTo?.(sec, true),
    getTime: () => p?.getCurrentTime?.() || 0,
    isPlaying: () => state === 1 || state === 3,
    isLive: () => { try { return !!p?.getVideoData?.().isLive; } catch (e) { return false; } },
    title: () => { try { return p?.getVideoData?.().title || ''; } catch (e) { return ''; } },
    destroy() { alive = false; try { p?.destroy(); } catch (e) {} },
  };
  return a;
}

// RuTube: управление через postMessage, ответы — JSON-строки {type, data}.
// Перед роликом бывает реклама (state 'advert'): в это время позицию не трогаем.
function rutubePlayer(box, ev) {
  let fr = null, state = '', want = false, ad = false, afterAd = false, t = 0, tAt = 0, fallback = null;
  const post = (type, data = {}) => fr?.contentWindow?.postMessage(JSON.stringify({type, data}), '*');
  const markReady = () => { if (!a.ready) { a.ready = true; clearTimeout(fallback); ev.ready(); } };
  const onMsg = e => {
    if (!fr || e.source !== fr.contentWindow) return;
    let m = e.data;
    if (typeof m === 'string') { try { m = JSON.parse(m); } catch (err) { return; } }
    if (!m || typeof m.type !== 'string') return;
    const d = m.data || {};
    if (m.type === 'player:ready' || m.type === 'player:init') markReady();
    else if (m.type === 'player:currentTime') {
      const v = Number(d.time ?? d.currentTime);
      if (Number.isFinite(v) && !ad) { t = v; tAt = nowMs(); }
    } else if (m.type === 'player:changeState') {
      const st = d.state || d.status;
      ev.activity();
      if (st === 'advert') {
        ad = !['end', 'complete', 'completed', 'skip'].includes(d.phase);
        afterAd = true;
        if (d.isPlaying) want = true;
        return;
      }
      if (ad && (st === 'pause' || st === 'paused')) return;   // ролик ждёт конца рекламы
      const prev = state;
      t = a.getTime(); tAt = nowMs();
      state = st;
      if (state === 'playing') {
        ad = false; want = true;
        // после рекламы ролик надо догнать до общего места
        if (prev !== 'playing' || afterAd) ev.play(afterAd);
        afterAd = false;
      }
      else if (state === 'pause' || state === 'paused') { want = false; ev.pause(); }
      else if (state === 'completed' || state === 'stopped') want = false;
    } else if (m.type === 'player:error') ev.error('RuTube: ' + (d.message || 'ошибка плеера'));
  };
  const a = {
    ready: false,
    load(id) {
      fr = makeFrame(`https://rutube.ru/play/embed/${encodeURIComponent(id)}`);
      window.addEventListener('message', onMsg);
      // старые версии плеера могут не прислать ready — пробуем управлять после загрузки
      fr.addEventListener('load', () => { fallback = setTimeout(markReady, 4000); });
      box.append(fr);
    },
    play() { post('player:play'); },
    pause() { post('player:pause'); },
    // время не подменяем: плеер может проигнорировать команду, правду скажет player:currentTime
    seek(sec) { post('player:setCurrentTime', {time: sec}); },
    getTime: () => t + (state === 'playing' && !ad ? (nowMs() - tAt) / 1000 : 0),
    isPlaying: () => want,
    busy: () => ad,
    title: () => '',
    destroy() { clearTimeout(fallback); window.removeEventListener('message', onMsg); },
  };
  return a;
}

// VK Видео: iframe + официальный videoplayer.js; если API не поднялся — просто показываем видео
function vkPlayer(box, ev) {
  let api = null, state = '', t = 0, tAt = 0, timer = null;
  const limit = () => { if (a.limited) return; a.limited = true; a.ready = true; clearTimeout(timer); ev.limited(); };
  const a = {
    ready: false,
    limited: false,
    load(id) {
      const m = /^(-?\d+)_(\d+)$/.exec(id);
      if (!m) { ev.error('Не понял ссылку VK'); return; }
      const fr = makeFrame(`https://vkvideo.ru/video_ext.php?oid=${m[1]}&id=${m[2]}&hd=2&js_api=1`);
      box.append(fr);
      timer = setTimeout(limit, 8000);
      loadScript('https://vk.com/js/api/videoplayer.js').then(() => {
        if (a.limited) return;
        api = window.VK?.VideoPlayer?.(fr);
        if (!api) throw new Error('VK.VideoPlayer');
        api.on('inited', () => { clearTimeout(timer); a.ready = true; ev.ready(); });
        api.on('started', () => { state = 'playing'; ev.activity(); ev.play(); });
        api.on('resumed', () => { state = 'playing'; ev.activity(); ev.play(); });
        api.on('paused', () => { state = 'paused'; ev.activity(); ev.pause(); });
        api.on('ended', () => { state = 'ended'; });
        api.on('timeupdate', d => { const v = Number(d?.time); if (Number.isFinite(v)) { t = v; tAt = nowMs(); } });
      }).catch(limit);
    },
    play() { try { api?.play(); } catch (e) {} },
    pause() { try { api?.pause(); } catch (e) {} },
    seek(sec) { try { api?.seek(sec); } catch (e) {} },
    getTime() {
      try { const v = Number(api?.getCurrentTime()); if (Number.isFinite(v)) return v; } catch (e) {}
      return t + (state === 'playing' ? (nowMs() - tAt) / 1000 : 0);
    },
    isPlaying: () => state === 'playing',
    title: () => '',
    destroy() { clearTimeout(timer); try { api?.destroy?.(); } catch (e) {} },
  };
  return a;
}

const ADAPTERS = {yt: ytPlayer, rutube: rutubePlayer, vk: vkPlayer};

// ---------- синхронизация ----------

function openPlayer(w) {
  player?.destroy();
  player = null; last = null; pendingPlay = false;
  clearTimeout(joinTimer);
  ui.frame.replaceChildren();
  ui.overlay.hidden = true;
  ui.limited.hidden = true;
  ui.stage.classList.remove('err');
  playerKey = w?.id ? `${w.src}:${w.id}` : '';
  root.classList.toggle('has-video', !!playerKey);
  const make = playerKey && ADAPTERS[w.src];
  if (!make) return;
  const p = make(ui.frame, {
    ready: () => { if (p === player) { renderInfo(); sync(); } },
    play: afterAd => {
      if (p !== player) return;
      const joining = pendingPlay || afterAd;
      pendingPlay = false;
      ui.overlay.hidden = true;
      renderInfo();
      onLocal('play', joining);
    },
    pause: () => { if (p === player) onLocal('pause'); },
    error: text => { if (p === player) { ui.stage.classList.add('err'); ui.loading.textContent = text; } },
    limited: () => { if (p === player) { ui.limited.hidden = false; } },
    activity: () => { if (p === player) lastActivity = nowMs(); },
  });
  player = p;
  ui.loading.textContent = 'Загружаю плеер…';
  p.load(w.id);
}

function applyWatch(w, fromState) {
  if (!w) return;
  const key = w.id ? `${w.src}:${w.id}` : '';
  const isNew = key !== playerKey;
  shared = w;
  if (isNew) {
    setBy = w.by;
    openPlayer(w);
    if (key && !fromState && w.by !== ctx.me && root.hidden) ctx.toast(`🎬 ${ctx.name(w.by)} включил(а) кино`);
  } else sync();
  renderInfo();
}

// привести свой плеер к общему состоянию
async function sync() {
  const p = player;
  if (!p?.ready || p.limited || !shared?.id) return;
  if (p.busy?.()) { if (!shared.playing) { quiet(); p.pause(); } return; }
  const exp = expected();
  const t = await p.getTime();
  if (p !== player) return;
  quiet();
  if (!p.isLive?.() && Math.abs(t - exp) > (shared.playing ? DRIFT : 1)) p.seek(exp);
  if (shared.playing) {
    if (!p.isPlaying()) { p.play(); pendingPlay = true; checkJoin(p); }
  } else p.pause();
}

// браузер мог не дать стартовать без касания — тогда большая кнопка
function checkJoin(p, tries = 4) {
  clearTimeout(joinTimer);
  joinTimer = setTimeout(() => {
    if (p !== player || !shared?.playing || p.isPlaying()) return;
    if (p.busy?.() && tries > 1) checkJoin(p, tries - 1);   // реклама ещё грузится
    else ui.overlay.hidden = false;
  }, JOIN_CHECK_MS);
}

function joinNow() {
  const p = player;
  ui.overlay.hidden = true;
  if (!p) return;
  ctx.haptic('medium');
  quiet();
  p.play();
  if (!p.isLive?.()) p.seek(expected());
  pendingPlay = true;
  setTimeout(() => {
    if (p === player && shared?.playing && !p.isPlaying()) ctx.toast('Нажми ▶ в самом плеере');
  }, JOIN_CHECK_MS);
}

function control(playing, pos) {
  shared = {...shared, playing, pos, at: ctx.serverNow(), by: ctx.me};
  ctx.send({t: 'watch_ctl', playing, pos: Math.round(pos * 10) / 10});
  last = {t: pos, now: nowMs(), playing};
  renderInfo();
}

// событие плеера: отличаем действия человека от наших собственных команд
// joining: старт, который запросили мы сами (автозапуск, кнопка, конец рекламы)
async function onLocal(kind, joining = false) {
  const p = player;
  if (!shared?.id || document.hidden) return;
  if (nowMs() < quietUntil && !joining) return;
  const t = await p.getTime();
  if (p !== player) return;
  if (kind === 'play') {
    if (shared.playing) {
      // перемотку во время просмотра ловит tick(); здесь только догоняем общий просмотр
      if (joining && !p.isLive?.() && Math.abs(t - expected()) > DRIFT) {
        quiet();
        p.seek(expected());
        setTimeout(sync, 1500);   // RuTube сразу после рекламы может проглотить перемотку
      }
      return;
    }
    if (nowMs() < quietUntil) return;
    control(true, t);
  } else if (kind === 'pause') {
    // pendingPlay: автозапуск не удался — это не пауза человека
    if (nowMs() < quietUntil || pendingPlay || !shared.playing) return;
    control(false, t);
  }
}

// раз в полсекунды: ловим перемотку и мягко правим расхождение
async function tick() {
  const p = player;
  if (!p?.ready || p.limited || !shared?.id || document.hidden || p.busy?.()) { last = null; return; }
  const t = await p.getTime();
  if (p !== player) return;
  const now = nowMs(), playing = p.isPlaying(), live = !!p.isLive?.();
  if (now < quietUntil) { last = {t, now, playing}; return; }
  // в прямом эфире перемотки нет — синхронизируем только паузу
  if (!live && last && now - last.now < 2000) {
    const predicted = last.t + (last.playing ? (now - last.now) / 1000 : 0);
    // скачок туда, где и так должен быть общий просмотр, — это наша же подстройка
    if (Math.abs(t - predicted) > DRIFT && Math.abs(t - expected()) > DRIFT) {
      control(playing, t);
      last = {t, now, playing};
      return;
    }
  }
  // плеер только что сменил состояние (например, буферизуется после нажатия ▶) — не мешаем
  if (now - lastReconcile > RECONCILE_MS && now - lastActivity > SETTLE_MS) {
    lastReconcile = now;
    const exp = expected();
    if (!live && shared.playing && playing && Math.abs(t - exp) > DRIFT + 1) { quiet(); p.seek(exp); }
    else if (!shared.playing && playing) { quiet(); p.pause(); }
  }
  last = {t, now, playing};
}

// ---------- отрисовка ----------

function renderInfo() {
  if (!shared?.id) return;
  let title = shared.title || '';
  if (!title || /^https?:\/\/|^[\w.-]+\.[a-z]{2,}\//i.test(title)) {
    title = player?.title?.() || `Видео по ссылке · ${SRC_NAME[shared.src] || ''}`;
  }
  ui.title.textContent = title;
  const who = setBy === ctx.me ? 'ты' : ctx.name(setBy);
  ui.by.textContent = `включил(а) ${who} · ${SRC_NAME[shared.src] || ''}` +
    (shared.playing ? '' : ` · ⏸ пауза${shared.by && shared.by !== ctx.me ? ` (${ctx.name(shared.by)})` : ''}`);
}

function renderSearchVisibility() {
  const hasVideo = root.classList.contains('has-video');
  const open = !hasVideo || searchOpen;
  ui.search.hidden = !open;
  ui.results.hidden = !open || !ui.results.childElementCount;
  ui.find.textContent = searchOpen ? '✕ Скрыть поиск' : '🔎 Найти другое';
}

function setStatus(text) {
  ui.results.replaceChildren(h('div', 'wt-status muted', text));
  ui.results.hidden = false;
}

async function runSearch() {
  const q = ui.q.value.trim();
  if (!q) { ui.q.focus(); return; }
  const seq = ++searchSeq;
  ui.q.blur();
  ui.go.disabled = true;
  ui.results.replaceChildren(h('div', 'wt-status muted', 'Ищу…'));
  ui.results.firstChild.prepend(h('span', 'wt-spin'));
  ui.results.hidden = false;
  try {
    const data = await ctx.api(`/api/search?q=${encodeURIComponent(q)}&src=${srcPref}`);
    if (seq !== searchSeq) return;
    if (data.error) { setStatus('Поиск не ответил. Попробуй ещё раз или вставь ссылку'); return; }
    const items = data.items || [];
    if (data.link && items[0]) { ui.q.value = ''; ui.results.replaceChildren(); pick(items[0]); return; }
    if (!items.length) { setStatus('Ничего не нашлось'); return; }
    ui.results.replaceChildren(...items.map(resultCard));
  } catch (e) {
    if (seq === searchSeq) setStatus('Поиск не ответил. Попробуй ещё раз или вставь ссылку');
  } finally {
    if (seq === searchSeq) ui.go.disabled = false;
  }
}

function resultCard(it) {
  const b = h('button', 'wt-item');
  b.type = 'button';
  const th = h('div', 'wt-thumb');
  if (/^https:\/\//.test(it.thumb || '')) {
    const img = h('img');
    img.loading = 'lazy'; img.alt = ''; img.referrerPolicy = 'no-referrer';
    img.src = it.thumb;
    img.onerror = () => img.remove();
    th.append(img);
  }
  th.append(h('span', 'wt-thumb-src', SRC_NAME[it.src] || ''));
  if (it.duration) th.append(h('span', 'wt-dur', it.duration));
  const body = h('div', 'wt-item-body');
  body.append(h('div', 'wt-item-title', it.title || 'Без названия'));
  if (it.author) body.append(h('div', 'wt-item-meta muted', it.author));
  b.append(th, body);
  b.addEventListener('click', () => pick(it));
  return b;
}

function pick(it) {
  if (!ctx.send({t: 'watch_set', src: it.src, id: it.id, title: it.title || ''})) {
    ctx.toast('Нет связи с Хатой');
    return;
  }
  ctx.haptic('success');
  searchOpen = false;
  renderSearchVisibility();
  window.scrollTo({top: 0, behavior: 'smooth'});
}

function fmtTime(at) {
  const d = new Date(at * 1000);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function chatItem(m, prev) {
  const mine = m.uid === ctx.me;
  const row = h('div', 'wt-msg' + (mine ? ' mine' : ''));
  if (!mine && (!prev || prev.uid !== m.uid)) row.append(h('div', 'wt-msg-name', ctx.name(m.uid)));
  const bub = h('div', 'wt-bubble', m.text);
  bub.append(h('span', 'wt-msg-time', fmtTime(m.at)));
  row.append(bub);
  return row;
}

let chatLog = [];
function renderChat(list) {
  chatLog = list.slice(-50);
  ui.msgs.replaceChildren(...chatLog.map((m, i) => chatItem(m, chatLog[i - 1])));
  ui.empty.hidden = chatLog.length > 0;
  ui.msgs.scrollTop = ui.msgs.scrollHeight;
}

function addChat(m) {
  const box = ui.msgs;
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  box.append(chatItem(m, chatLog[chatLog.length - 1]));
  chatLog.push(m);
  if (chatLog.length > 50) { chatLog.shift(); box.firstElementChild?.remove(); }
  ui.empty.hidden = true;
  if (nearBottom || m.uid === ctx.me) box.scrollTop = box.scrollHeight;
  if (m.uid !== ctx.me) ctx.haptic('light');
}

function flyReaction(m) {
  const host = root.classList.contains('has-video') ? ui.stage : ui.chat;
  if (host.querySelectorAll('.wt-fly').length > 24) return;
  const el = h('div', 'wt-fly');
  el.append(h('span', 'wt-fly-emoji', m.emoji));
  if (m.uid !== ctx.me) el.append(h('span', 'wt-fly-name', ctx.name(m.uid)));
  el.style.left = `${8 + Math.random() * 76}%`;
  el.style.setProperty('--sway', `${Math.round((Math.random() - 0.5) * 60)}px`);
  el.addEventListener('animationend', () => el.remove());
  host.append(el);
  if (m.uid !== ctx.me) ctx.haptic('light');
}

// ---------- разметка ----------

function build() {
  root.classList.add('wt');

  ui.stage = h('div', 'wt-stage');
  ui.loading = h('div', 'wt-loading muted', 'Загружаю плеер…');
  ui.frame = h('div', 'wt-frame');
  ui.overlay = h('div', 'wt-overlay');
  const join = h('button', 'btn primary wt-join', '▶ Подключиться к просмотру');
  join.type = 'button';
  join.addEventListener('click', joinNow);
  ui.overlay.append(join);
  ui.overlay.hidden = true;
  ui.stage.append(ui.loading, ui.frame, ui.overlay);

  ui.info = h('div', 'wt-info');
  const txt = h('div', 'wt-info-text');
  ui.title = h('div', 'wt-title');
  ui.by = h('div', 'wt-by muted');
  ui.limited = h('div', 'wt-limited', 'Синхронизация VK ограничена, паузу ставьте вручную');
  ui.limited.hidden = true;
  txt.append(ui.title, ui.by, ui.limited);
  ui.find = h('button', 'wt-find', '🔎 Найти другое');
  ui.find.type = 'button';
  ui.find.addEventListener('click', () => {
    searchOpen = !searchOpen;
    renderSearchVisibility();
    if (searchOpen) ui.q.focus();
  });
  ui.info.append(txt, ui.find);

  ui.hero = h('div', 'wt-hero');
  ui.hero.append(h('div', 'wt-hero-title', '🎬 Кино вместе'),
    h('div', 'muted', 'Найди видео или вставь ссылку, и оно включится у обоих одновременно'));

  ui.search = h('form', 'wt-search');
  const bar = h('div', 'wt-sbar');
  ui.q = h('input', 'input');
  ui.q.type = 'search';
  ui.q.placeholder = 'Поиск или ссылка YouTube / RuTube / VK';
  ui.q.enterKeyHint = 'search';
  ui.q.autocomplete = 'off';
  ui.q.maxLength = 200;
  ui.go = h('button', 'btn primary', 'Найти');
  bar.append(ui.q, ui.go);
  const seg = h('div', 'wt-seg');
  for (const [src, label] of [['yt', 'YouTube'], ['rutube', 'RuTube']]) {
    const b = h('button', src === srcPref ? 'on' : '', label);
    b.type = 'button';
    b.dataset.src = src;
    b.addEventListener('click', () => {
      if (srcPref === src) return;
      srcPref = src;
      seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.src === src));
      ctx.haptic('light');
      if (ui.q.value.trim()) runSearch();
    });
    seg.append(b);
  }
  ui.search.append(bar, seg);
  ui.search.addEventListener('submit', e => { e.preventDefault(); runSearch(); });

  ui.results = h('div', 'wt-results');
  ui.results.hidden = true;

  ui.react = h('div', 'wt-react');
  for (const emoji of REACTIONS) {
    const b = h('button', '', emoji);
    b.type = 'button';
    b.addEventListener('click', () => {
      if (!ctx.send({t: 'react', emoji})) { ctx.toast('Нет связи с Хатой'); return; }
      ctx.haptic('light');
    });
    ui.react.append(b);
  }

  ui.chat = h('div', 'card wt-chat');
  ui.chat.append(h('div', 'wt-chat-head', '💬 Чат'));
  ui.msgs = h('div', 'wt-msgs');
  ui.empty = h('div', 'wt-empty muted', 'Пока тихо. Напиши первым 🙂');
  const form = h('form', 'wt-send');
  ui.text = h('input', 'input');
  ui.text.placeholder = 'Сообщение…';
  ui.text.maxLength = 500;
  ui.text.enterKeyHint = 'send';
  ui.text.autocomplete = 'off';
  const send = h('button', 'btn primary', '➤');
  send.setAttribute('aria-label', 'Отправить');
  form.append(ui.text, send);
  form.addEventListener('submit', e => {
    e.preventDefault();
    const text = ui.text.value.trim();
    if (!text) return;
    if (!ctx.send({t: 'chat', text})) { ctx.toast('Нет связи с Хатой'); return; }
    ui.text.value = '';
    ui.text.focus();
  });
  ui.chat.append(ui.msgs, ui.empty, form);

  root.append(ui.stage, ui.info, ui.hero, ui.react, ui.search, ui.results, ui.chat);
}

export function mount(el, c) {
  root = el; ctx = c;
  build();
  renderSearchVisibility();

  ctx.on('state', msg => {
    applyWatch(msg.watch, true);
    renderSearchVisibility();
    renderChat(msg.chat || []);
  });
  ctx.on('watch', msg => { applyWatch(msg.watch, false); renderSearchVisibility(); });
  ctx.on('chat', addChat);
  ctx.on('react', flyReaction);
  ctx.on('presence', renderInfo);

  setInterval(tick, TICK_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
}

export function show() {
  ui.msgs.scrollTop = ui.msgs.scrollHeight;
  if (player && shared?.playing) sync();
}
