// Печатает текст страницы панели bothost: node bh_page.js <путь>, например tariffs.php
const fs = require('fs');
const envPath = 'C:/Users/USER/TgMirror/tools/bothost/.env';
if (fs.existsSync(envPath)) for (const l of fs.readFileSync(envPath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
  const i = l.indexOf('='); if (i > 0 && !process.env[l.slice(0, i)]) process.env[l.slice(0, i)] = l.slice(i + 1);
}
const {open} = require('C:/Users/USER/TgMirror/tools/bothost/bhlib.js');
(async () => {
  const {b, pg} = await open();
  await pg.goto('https://bothost.ru/' + (process.argv[2] || 'tariffs.php'), {waitUntil: 'networkidle2', timeout: 60000});
  const t = await pg.evaluate(() => document.body.innerText);
  console.log(t.replace(/[0-9]{8,10}:[A-Za-z0-9_-]{30,}/g, '<t>').slice(0, +process.env.LEN || 4000));
  await b.close();
})();
