// Создаёт слот в панели bothost (аккаунт palfboom). SUBMIT=1 — реально создать, иначе только заполнить форму.
// BH_NAME=hata (хаб, репозиторий hata-bot) или BH_NAME=hata-screen (общий браузер, репозиторий hata-screen).
const fs = require('fs');
const envPath = 'C:/Users/USER/TgMirror/tools/bothost/.env';
if (fs.existsSync(envPath)) for (const l of fs.readFileSync(envPath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
  const i = l.indexOf('='); if (i > 0 && !process.env[l.slice(0, i)]) process.env[l.slice(0, i)] = l.slice(i + 1);
}
const {open} = require('C:/Users/USER/TgMirror/tools/bothost/bhlib.js');
const E = Object.fromEntries(fs.readFileSync('C:/Users/USER/Hata/.env', 'utf8').split(/\r?\n/).filter(l => l.includes('='))
  .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));

const PRESETS = {
  'hata': {
    git: 'https://github.com/MMR3633/hata-bot.git', branch: 'dev',
    envs: [['ALLOWED_IDS', E.ALLOWED_IDS], ['AGENT_TOKEN', E.AGENT_TOKEN], ['DATA_DIR', '/app/data'],
      ['PORT', '8080'], ['PUBLIC_URL', 'https://hata.bothost.tech']],
  },
  'hata-screen': {
    git: 'https://github.com/MMR3633/hata-screen.git', branch: 'main', docker: true,
    envs: [['ALLOWED_IDS', E.ALLOWED_IDS], ['PORT', '8080']],
  },
};
const NAME = process.env.BH_NAME || 'hata';
const P = PRESETS[NAME];
if (!P) { console.log('нет пресета', NAME); process.exit(1); }
const DOMAIN = NAME + '.bothost.tech';

(async () => {
  const {b, pg} = await open();
  console.log('logged', !pg.url().includes('login'));
  await pg.goto('https://bothost.ru/create-bot.php', {waitUntil: 'networkidle2', timeout: 60000});
  await pg.type('input[name=name]', NAME);
  await pg.evaluate(() => {
    for (const [n, v] of [['platform', 'telegram'], ['library', 'aiogram'], ['location', 'eu']]) {
      const r = document.querySelector(`input[name=${n}][value=${v}]`);
      if (r) { r.checked = true; r.dispatchEvent(new Event('change', {bubbles: true})); r.click(); }
    }
    const s = document.querySelector('select[name=python_version]');
    if (s) { s.value = '3.13'; s.dispatchEvent(new Event('change', {bubbles: true})); }
  });
  await pg.type('input[name=bot_token]', E.BOT_TOKEN);
  for (let i = 0; i < P.envs.length; i++) {
    let keys = await pg.$$('input[name="env_keys[]"]');
    if (keys.length <= i) {
      const add = await pg.evaluateHandle(() => [...document.querySelectorAll('button,a')].find(x => /Добавить переменную/.test(x.innerText)));
      await add.click(); await new Promise(r => setTimeout(r, 300));
      keys = await pg.$$('input[name="env_keys[]"]');
    }
    const vals = await pg.$$('input[name="env_values[]"]');
    await keys[i].type(P.envs[i][0]);
    await vals[i].evaluate((el, v) => { el.value = v; el.dispatchEvent(new Event('input', {bubbles: true})); }, P.envs[i][1]);
  }
  await pg.type('input[name=git_url]', P.git);
  await pg.evaluate(b => { const br = document.querySelector('[name=branch]'); if (br) { br.value = b; br.dispatchEvent(new Event('change', {bubbles: true})); } }, P.branch);
  const adv = await pg.evaluateHandle(() => [...document.querySelectorAll('button,a,summary,div')]
    .find(x => x.children.length < 4 && /Дополнительные настройки/.test(x.innerText || '')));
  if (adv) { try { await adv.click(); } catch (e) {} await new Promise(r => setTimeout(r, 500)); }
  await pg.evaluate(() => { const w = document.querySelector('input[name=has_web_interface]'); if (w && !w.checked) w.click(); });
  await new Promise(r => setTimeout(r, 500));
  await pg.evaluate(d => {
    const set = (n, v) => { const e = document.querySelector(`input[name=${n}]`); if (e) { e.value = v; e.dispatchEvent(new Event('input', {bubbles: true})); } };
    set('internal_port', '8080'); set('custom_domain', d); set('main_file', 'main.py');
  }, DOMAIN);
  if (P.docker) {
    await pg.evaluate(() => { const c = document.querySelector('input[name=use_custom_dockerfile]'); if (c && !c.checked) c.click(); });
  }
  const state = await pg.evaluate(() => ({
    docker: document.querySelector('input[name=use_custom_dockerfile]')?.checked,
    name: document.querySelector('input[name=name]')?.value,
    env: [...document.querySelectorAll('input[name="env_keys[]"]')].map(x => x.value),
    vals: [...document.querySelectorAll('input[name="env_values[]"]')].map(x => x.value.length),
    git: document.querySelector('input[name=git_url]')?.value,
    branch: document.querySelector('[name=branch]')?.value,
    web: document.querySelector('input[name=has_web_interface]')?.checked,
    port: document.querySelector('input[name=internal_port]')?.value,
    domain: document.querySelector('input[name=custom_domain]')?.value,
    main: document.querySelector('input[name=main_file]')?.value,
  }));
  console.log(JSON.stringify(state));
  if (process.env.SUBMIT === '1') {
    await Promise.all([
      pg.waitForNavigation({waitUntil: 'networkidle2', timeout: 120000}).catch(() => {}),
      pg.evaluate(() => [...document.querySelectorAll('button')].find(x => /Создать бота/.test(x.innerText)).click()),
    ]);
    const text = await pg.evaluate(() => document.body.innerText);
    console.log('after', pg.url(), /успешно создан/.test(text) ? 'СОЗДАН' : 'не видно подтверждения');
    const m = text.match(new RegExp(NAME.replace('-', '\\-') + '\\s*\\n(bot_\\d+_\\d+_palfboom)'));
    console.log('id:', m ? m[1] : '?');
  }
  await b.close();
})();
