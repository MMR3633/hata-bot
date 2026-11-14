// Логи бота hata из панели bothost. UPDATE=1 — сначала «Обновить из Git».
const fs = require('fs');
const envPath = 'C:/Users/USER/TgMirror/tools/bothost/.env';
if (fs.existsSync(envPath)) for (const l of fs.readFileSync(envPath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
  const i = l.indexOf('='); if (i > 0 && !process.env[l.slice(0, i)]) process.env[l.slice(0, i)] = l.slice(i + 1);
}
const {open} = require('C:/Users/USER/TgMirror/tools/bothost/bhlib.js');
const ID = process.env.BOT_ID || 'bot_1794611302_4543_palfboom';
(async () => {
  const {b, pg} = await open();
  pg.on('dialog', async d => { await d.accept(); });
  if (process.env.UPDATE === '1') {
    await pg.evaluate(i => updateBot(i), ID);
    console.log('updateBot вызван');
    await new Promise(r => setTimeout(r, 60000));
  }
  await pg.goto('https://bothost.ru/bot-manage.php?bot=' + ID, {waitUntil: 'networkidle2', timeout: 60000});
  const t = await pg.evaluate(() => document.body.innerText);
  const li = t.indexOf('Логи');
  const status = (t.match(/(Работает|Деплой|Остановлен|Ошибка[^\n]*)/) || [''])[0];
  console.log('статус:', status);
  console.log(t.slice(li, li + 20000).split('\n').slice(-(+process.env.N || 40)).join('\n')
    .replace(/[0-9]{8,10}:[A-Za-z0-9_-]{30,}/g, '<t>'));
  await b.close();
})();
