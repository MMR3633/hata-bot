// Создаёт бота «hata» в панели bothost (аккаунт palfboom). SUBMIT=1 — реально создать, иначе только заполнить форму.
const fs = require('fs');
const envPath = 'C:/Users/USER/TgMirror/tools/bothost/.env';
if (fs.existsSync(envPath)) for (const l of fs.readFileSync(envPath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
  const i = l.indexOf('='); if (i > 0 && !process.env[l.slice(0, i)]) process.env[l.slice(0, i)] = l.slice(i + 1);
}
const {open} = require('C:/Users/USER/TgMirror/tools/bothost/bhlib.js');
const E = Object.fromEntries(fs.readFileSync('C:/Users/USER/Hata/.env', 'utf8').split(/\r?\n/).filter(l => l.includes('='))
  .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const envs = [['ALLOWED_IDS', E.ALLOWED_IDS], ['AGENT_TOKEN', E.AGENT_TOKEN], ['DATA_DIR', '/app/data'],
  ['PORT', '8080'], ['PUBLIC_URL', 'https://hata.bothost.tech']];

(async () => {
  const {b, pg} = await open();
  console.log('logged', !pg.url().includes('login'));
  await pg.goto('https://bothost.ru/create-bot.php', {waitUntil: 'networkidle2', timeout: 60000});
  await pg.type('input[name=name]', 'hata');
  await pg.evaluate(() => {
    for (const [n, v] of [['platform', 'telegram'], ['library', 'aiogram'], ['location', 'eu']]) {
      const r = document.querySelector(`input[name=${n}][value=${v}]`);
      if (r) { r.checked = true; r.dispatchEvent(new Event('change', {bubbles: true})); r.click(); }
    }
    const s = document.querySelector('select[name=python_version]');
    if (s) { s.value = '3.13'; s.dispatchEvent(new Event('change', {bubbles: true})); }
  });
  await pg.type('input[name=bot_token]', E.BOT_TOKEN);
  for (let i = 0; i < envs.length; i++) {
    let keys = await pg.$$('input[name="env_keys[]"]');
    if (keys.length <= i) {
      const add = await pg.evaluateHandle(() => [...document.querySelectorAll('button,a')].find(x => /Добавить переменную/.test(x.innerText)));
      await add.click(); await new Promise(r => setTimeout(r, 300));
      keys = await pg.$$('input[name="env_keys[]"]');
    }
    const vals = await pg.$$('input[name="env_values[]"]');
    await keys[i].type(envs[i][0]);
    await vals[i].evaluate((el, v) => { el.value = v; el.dispatchEvent(new Event('input', {bubbles: true})); }, envs[i][1]);
  }
  await pg.type('input[name=git_url]', 'https://github.com/MMR3633/hata-bot.git');
  await pg.evaluate(() => { const br = document.querySelector('input[name=branch]'); if (br) br.value = 'dev'; });
  const adv = await pg.evaluateHandle(() => [...document.querySelectorAll('button,a,summary,div')]
    .find(x => x.children.length < 4 && /Дополнительные настройки/.test(x.innerText || '')));
  if (adv) { try { await adv.click(); } catch (e) {} await new Promise(r => setTimeout(r, 500)); }
  await pg.evaluate(() => { const w = document.querySelector('input[name=has_web_interface]'); if (w && !w.checked) w.click(); });
  await new Promise(r => setTimeout(r, 500));
  await pg.evaluate(() => {
    const set = (n, v) => { const e = document.querySelector(`input[name=${n}]`); if (e) { e.value = v; e.dispatchEvent(new Event('input', {bubbles: true})); } };
    set('internal_port', '8080'); set('custom_domain', 'hata.bothost.tech'); set('main_file', 'main.py');
  });
  const state = await pg.evaluate(() => ({
    env: [...document.querySelectorAll('input[name="env_keys[]"]')].map(x => x.value),
    vals: [...document.querySelectorAll('input[name="env_values[]"]')].map(x => x.value.length),
    web: document.querySelector('input[name=has_web_interface]')?.checked,
    port: document.querySelector('input[name=internal_port]')?.value,
    loc: document.querySelector('input[name=location]:checked')?.value,
    py: document.querySelector('select[name=python_version]')?.value,
    main: document.querySelector('input[name=main_file]')?.value,
    branch: document.querySelector('input[name=branch]')?.value,
    domain: document.querySelector('input[name=custom_domain]')?.value,
  }));
  console.log(JSON.stringify(state));
  if (process.env.SUBMIT === '1') {
    await Promise.all([
      pg.waitForNavigation({waitUntil: 'networkidle2', timeout: 120000}).catch(() => {}),
      pg.evaluate(() => [...document.querySelectorAll('button')].find(x => /Создать бота/.test(x.innerText)).click()),
    ]);
    console.log('after', pg.url());
    console.log((await pg.evaluate(() => document.body.innerText)).replace(/[0-9]{8,10}:[A-Za-z0-9_-]{30,}/g, '<t>').slice(0, 1500));
  }
  await b.close();
})();
