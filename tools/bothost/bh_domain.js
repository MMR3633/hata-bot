// Меняет домен слота настоящим вводом: node bh_domain.js <bot_id> <новый.bothost.tech>
const fs = require('fs');
const envPath = 'C:/Users/USER/TgMirror/tools/bothost/.env';
if (fs.existsSync(envPath)) for (const l of fs.readFileSync(envPath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
  const i = l.indexOf('='); if (i > 0 && !process.env[l.slice(0, i)]) process.env[l.slice(0, i)] = l.slice(i + 1);
}
const {open} = require('C:/Users/USER/TgMirror/tools/bothost/bhlib.js');
const [id, domain] = process.argv.slice(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const {b, pg} = await open();
  pg.on('dialog', async d => { console.log('dialog:', d.message().slice(0, 200)); await d.accept(); });
  pg.on('request', r => { if (r.method() !== 'GET') console.log('->', r.method(), r.url().slice(0, 100), (r.postData() || '').slice(0, 400)); });
  pg.on('response', async r => { if (r.request().method() !== 'GET') { try { console.log('<-', r.status(), (await r.text()).slice(0, 300)); } catch (e) {} } });
  await pg.goto('https://bothost.ru/bot-manage.php?bot=' + id, {waitUntil: 'networkidle2', timeout: 60000});
  const tab = await pg.evaluateHandle(() => [...document.querySelectorAll('[onclick]')].find(x => /switchTab\('domain'/.test(x.getAttribute('onclick'))));
  await tab.click();
  await sleep(800);
  const inputs = await pg.$$('input[type=text]');
  let target = null;
  for (const h of inputs) {
    if (/\.bothost\.tech$/.test(await h.evaluate(e => e.value)) && await h.isVisible()) { target = h; break; }
  }
  if (!target) { console.log('поле домена не видно'); await b.close(); return; }
  await target.click({clickCount: 3});
  await pg.keyboard.press('Backspace');
  await target.type(domain);
  await sleep(300);
  const save = await pg.$('#saveBtn');
  console.log('saveBtn видна:', await save.isVisible());
  await save.click();
  await sleep(8000);
  await pg.goto('https://bothost.ru/bot-manage.php?bot=' + id, {waitUntil: 'networkidle2', timeout: 60000});
  console.log('домен теперь:', await pg.evaluate(() => [...document.querySelectorAll('input[type=text]')].find(e => /\.bothost\.tech$/.test(e.value))?.value));
  await b.close();
})();
