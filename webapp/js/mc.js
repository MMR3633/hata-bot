// Вкладка «Майн»: статус сервера на ноуте, запуск, миры, бэкапы.
let ctx, root, timer = null, last = null;

const STATE = {
  running: ['ok', 'Работает'], starting: ['warn', 'Запускается…'], stopping: ['warn', 'Выключается…'],
  stopped: ['', 'Выключен'], crashed: ['', 'Упал'],
};
const CMD = {
  start: 'Запуск', stop: 'Стоп', create_world: 'Новый мир', switch_world: 'Смена мира',
  backup: 'Бэкап', delete_world: 'Удаление мира',
};
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));

export function mount(el, c) {
  ctx = c; root = el;
  root.innerHTML = `
    <div class="card" id="mc-status"><span class="muted">Загружаю…</span></div>
    <div class="card" id="mc-worlds-card">
      <h3>Миры</h3>
      <div class="list" id="mc-worlds"></div>
    </div>
    <div class="card">
      <h3>Новый мир 500×500×512</h3>
      <label class="label" for="mc-name">Название</label>
      <input class="input" id="mc-name" maxlength="32" placeholder="например, дом">
      <label class="label" for="mc-seed">Сид (можно пусто)</label>
      <input class="input" id="mc-seed" maxlength="40" placeholder="случайный">
      <label class="label">Тип</label>
      <div class="row" id="mc-type">
        <button class="btn primary" data-type="normal">Обычный</button>
        <button class="btn" data-type="flat">Плоский</button>
        <button class="btn" data-type="amplified">Горы</button>
      </div>
      <button class="btn primary wide" id="mc-create" style="margin-top:12px">Создать</button>
    </div>
    <div class="card">
      <h3>Последние команды</h3>
      <div class="list" id="mc-log"></div>
    </div>`;
  let type = 'normal';
  root.querySelectorAll('#mc-type .btn').forEach(b => b.addEventListener('click', () => {
    type = b.dataset.type;
    root.querySelectorAll('#mc-type .btn').forEach(x => x.classList.toggle('primary', x === b));
  }));
  root.querySelector('#mc-create').addEventListener('click', async () => {
    const name = root.querySelector('#mc-name').value.trim();
    if (!/^[\p{L}\p{N}_ -]{1,32}$/u.test(name)) return ctx.toast('Название: буквы, цифры, пробел, _ и -');
    await cmd('create_world', {name, seed: root.querySelector('#mc-seed').value.trim(), type});
    root.querySelector('#mc-name').value = '';
  });
  root.addEventListener('click', e => {
    const b = e.target.closest('[data-cmd]');
    if (!b) return;
    const args = b.dataset.world ? {name: b.dataset.world} : {};
    if (b.dataset.cmd === 'delete_world' && !confirm(`Удалить мир «${b.dataset.world}»? Бэкапы останутся.`)) return;
    cmd(b.dataset.cmd, args);
  });
}

export function show() {
  refresh();
  clearInterval(timer);
  timer = setInterval(() => { if (!root.hidden) refresh(); else clearInterval(timer); }, 4000);
}

async function cmd(name, args = {}) {
  try {
    await ctx.api('/api/mc/cmd', {method: 'POST', body: JSON.stringify({cmd: name, args})});
    ctx.haptic('light');
    ctx.toast(last?.laptop === 'awake' ? `${CMD[name]}: отправлено на ноут` : `${CMD[name]}: ноут спит, выполнится, когда проснётся (10 мин)`);
    setTimeout(refresh, 800);
  } catch (e) {
    ctx.toast('Не получилось: ' + e.message);
  }
}

async function refresh() {
  try { last = await ctx.api('/api/mc/status'); } catch (e) { return; }
  render(last);
}

function ago(ts) {
  const s = Math.max(0, Math.round(ctx.serverNow() - ts));
  if (s < 60) return `${s} с назад`;
  if (s < 3600) return `${Math.round(s / 60)} мин назад`;
  return `${Math.round(s / 3600)} ч назад`;
}

function render(st) {
  const s = st.status || {};
  const box = root.querySelector('#mc-status');
  if (st.laptop === 'sleeping') {
    box.innerHTML = `
      <h3><span class="status-dot"></span>Ноут спит</h3>
      <div class="muted">Агент на ноуте не на связи${st.seen ? ' · был ' + ago(st.seen) : ''}.
      Майнкрафт живёт на ноуте Расула — когда ноут включён, сервер можно запустить отсюда.</div>`;
  } else {
    const [dot, label] = STATE[s.server] || ['', s.server || '?'];
    const running = s.server === 'running';
    const busy = s.server === 'starting' || s.server === 'stopping' || s.busy;
    box.innerHTML = `
      <h3><span class="status-dot ${dot}"></span>Сервер: ${esc(label)}</h3>
      <div class="kv">
        <span class="muted">Мир</span><b>${esc(s.world || '—')}</b>
        <span class="muted">Онлайн</span><b>${s.players?.length ? s.players.map(esc).join(', ') : 'никого'}</b>
        ${running && s.tps ? `<span class="muted">TPS</span><b>${esc(s.tps)}</b>` : ''}
        <span class="muted">Адрес</span><b><span class="code">${esc(s.address || '—')}</span></b>
        ${s.version ? `<span class="muted">Версия</span><b>${esc(s.version)}</b>` : ''}
      </div>
      ${s.busy ? `<div class="muted" style="margin-top:8px">⏳ ${esc(CMD[s.busy] || s.busy)}…</div>` : ''}
      <div class="row" style="margin-top:12px">
        ${running ? `<button class="btn danger" data-cmd="stop" ${busy ? 'disabled' : ''}>Выключить</button>`
                  : `<button class="btn primary" data-cmd="start" ${busy ? 'disabled' : ''}>▶ Запустить</button>`}
        <button class="btn" data-cmd="backup" ${busy || !s.world ? 'disabled' : ''}>💾 Бэкап</button>
      </div>
      <div class="muted" style="margin-top:10px;font-size:13px">Подключение: Radmin VPN, сеть «Хата» → в Майнкрафте «Сетевая игра» → адрес выше.</div>`;
  }

  const worlds = s.worlds || [];
  root.querySelector('#mc-worlds').innerHTML = worlds.length ? worlds.map(w => `
    <div class="list-item ${w.name === s.world ? 'current' : ''}">
      <div><b>${esc(w.name)}</b><div class="muted" style="font-size:12px">${esc(w.type || '')} · ${w.size_mb ?? '?'} МБ${w.backups ? ` · бэкапов ${w.backups}` : ''}</div></div>
      <div class="row">
        ${w.name === s.world ? '<span class="muted" style="font-size:12px">текущий</span>'
          : `<button class="btn" data-cmd="switch_world" data-world="${esc(w.name)}">Играть</button>
             <button class="btn danger" data-cmd="delete_world" data-world="${esc(w.name)}" aria-label="Удалить">✕</button>`}
      </div>
    </div>`).join('') : `<div class="muted">${st.laptop === 'sleeping' ? 'Список появится, когда ноут проснётся' : 'Пока ни одного мира — создай ниже'}</div>`;

  root.querySelector('#mc-log').innerHTML = (st.recent || []).map(r => {
    const res = r.result;
    const mark = res ? (res.ok ? '✅' : '❌') : (r.taken ? '⏳' : '🕓');
    const note = res && !res.ok ? ` — ${esc(res.error || 'ошибка')}` : '';
    return `<div class="list-item"><span>${mark} ${esc(CMD[r.cmd] || r.cmd)}${r.args?.name ? ' «' + esc(r.args.name) + '»' : ''}${note}</span><span class="muted" style="font-size:12px">${ago(r.created)}</span></div>`;
  }).join('') || '<div class="muted">Пусто</div>';
}
