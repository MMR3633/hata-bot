// Логи конкретного слота через окно «Логи» на дашборде: node bh_showlogs.js <bot_id>
const fs = require('fs');
const envPath = 'C:/Users/USER/TgMirror/tools/bothost/.env';
if (fs.existsSync(envPath)) for (const l of fs.readFileSync(envPath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
  const i = l.indexOf('='); if (i > 0 && !process.env[l.slice(0, i)]) process.env[l.slice(0, i)] = l.slice(i + 1);
}
const {open} = require('C:/Users/USER/TgMirror/tools/bothost/bhlib.js');
const id = process.argv[2];
(async () => {
  const {b, pg} = await open();
  const before = await pg.evaluate(() => document.body.innerText.length);
  const resp = [];
  pg.on('response', async r => { if (/log/i.test(r.url())) { try { resp.push(r.url() + '\n' + (await r.text()).slice(-6000)); } catch (e) {} } });
  await pg.evaluate(i => showBotLogs(i), id);
  await new Promise(r => setTimeout(r, 6000));
  console.log(resp.join('\n-----\n').replace(/[0-9]{8,10}:[A-Za-z0-9_-]{30,}/g, '<t>').slice(-7000) || 'нет ответов с log в url');
  await b.close();
})();
