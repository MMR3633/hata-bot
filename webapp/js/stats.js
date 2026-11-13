// Вкладка «Счёт»: победы в дуэлях, рекорды, последние игры.
let ctx, root;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));

export function mount(el, c) {
  ctx = c; root = el;
  root.innerHTML = '<div class="muted">Загружаю…</div>';
  ctx.on('duel_end', () => { if (!root.hidden) show(); });
}

export async function show() {
  let st;
  try { st = await ctx.api('/api/stats'); } catch (e) { root.innerHTML = '<div class="muted">Не загрузилось</div>'; return; }
  const me = ctx.me, fr = ctx.friend();
  const w = uid => st.wins[String(uid)] || 0;
  const best = uid => st.best[String(uid)] || 0;
  const date = ts => new Date(ts * 1000).toLocaleString('ru-RU', {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'});
  root.innerHTML = `
    <div class="card">
      <h3>🧩 Блок-дуэль · сыграно ${st.duels}</h3>
      <div class="grid2" style="text-align:center;margin-top:6px">
        <div><div class="muted">Ты</div><div class="big-num" style="color:var(--accent)">${w(me)}</div><div class="muted" style="font-size:12px">рекорд ${best(me)}</div></div>
        <div><div class="muted">${esc(ctx.name(fr))}</div><div class="big-num">${fr ? w(fr) : 0}</div><div class="muted" style="font-size:12px">рекорд ${fr ? best(fr) : 0}</div></div>
      </div>
    </div>
    <div class="card">
      <h3>Последние игры</h3>
      <div class="list">${st.last.map(r => {
        const solo = !r.p2;
        const mine = r.p1 === me ? r.s1 : r.s2, theirs = r.p1 === me ? r.s2 : r.s1;
        const res = solo ? (r.p1 === me ? 'Тренировка' : `Тренировка ${esc(ctx.name(r.p1))}`)
          : r.winner === me ? '🏆 Победа' : r.winner ? 'Поражение' : 'Ничья';
        const score = solo ? r.s1 : `${mine} : ${theirs}`;
        return `<div class="list-item"><span>${res}</span><b>${score}</b><span class="muted" style="font-size:12px">${date(r.finished)}</span></div>`;
      }).join('') || '<div class="muted">Ещё не играли</div>'}</div>
    </div>`;
}
