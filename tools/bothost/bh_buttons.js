// Кнопки страницы bothost с текстом и onclick: node bh_buttons.js <путь>
const fs = require('fs');
const envPath = 'C:/Users/USER/TgMirror/tools/bothost/.env';
if (fs.existsSync(envPath)) for (const l of fs.readFileSync(envPath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
  const i = l.indexOf('='); if (i > 0 && !process.env[l.slice(0, i)]) process.env[l.slice(0, i)] = l.slice(i + 1);
}
const {open} = require('C:/Users/USER/TgMirror/tools/bothost/bhlib.js');
(async () => {
  const {b, pg} = await open();
  await pg.goto('https://bothost.ru/' + process.argv[2], {waitUntil: 'networkidle2', timeout: 60000});
  console.log((await pg.evaluate(() => [...document.querySelectorAll('button,[onclick]')].map((x, i) =>
    `${i}: ${(x.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 40)} | onclick=${(x.getAttribute('onclick') || '').slice(0, 80)} | id=${x.id}`))).join('\n'));
  await b.close();
})();
