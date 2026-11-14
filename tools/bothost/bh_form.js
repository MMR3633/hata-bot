// Показывает поля формы создания бота bothost (имена, значения, подписи)
const fs = require('fs');
const envPath = 'C:/Users/USER/TgMirror/tools/bothost/.env';
if (fs.existsSync(envPath)) for (const l of fs.readFileSync(envPath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
  const i = l.indexOf('='); if (i > 0 && !process.env[l.slice(0, i)]) process.env[l.slice(0, i)] = l.slice(i + 1);
}
const {open} = require('C:/Users/USER/TgMirror/tools/bothost/bhlib.js');
(async () => {
  const {b, pg} = await open();
  await pg.goto('https://bothost.ru/create-bot.php', {waitUntil: 'networkidle2', timeout: 60000});
  const fields = await pg.evaluate(() => [...document.querySelectorAll('input,select,textarea')].map(e => {
    const lab = e.closest('label')?.innerText || document.querySelector(`label[for="${e.id}"]`)?.innerText || '';
    const opts = e.tagName === 'SELECT' ? [...e.options].map(o => o.value).join('/') : '';
    return `${e.tagName.toLowerCase()} ${e.type || ''} name=${e.name} value=${(e.value || '').slice(0, 30)} ${opts} | ${lab.replace(/\s+/g, ' ').slice(0, 60)}`;
  }));
  console.log(fields.filter(f => !/env_|bot_token|csrf/.test(f)).join('\n'));
  await b.close();
})();
