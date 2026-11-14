// Управление слотом bothost: node bh_ctl.js <bot_id> <list|stop|start|restart|update>
const fs = require('fs');
const envPath = 'C:/Users/USER/TgMirror/tools/bothost/.env';
if (fs.existsSync(envPath)) for (const l of fs.readFileSync(envPath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
  const i = l.indexOf('='); if (i > 0 && !process.env[l.slice(0, i)]) process.env[l.slice(0, i)] = l.slice(i + 1);
}
const {open} = require('C:/Users/USER/TgMirror/tools/bothost/bhlib.js');
const [id, act] = process.argv.slice(2);
(async () => {
  const {b, pg} = await open();
  pg.on('dialog', async d => { await d.accept(); });
  await pg.goto('https://bothost.ru/dashboard.php', {waitUntil: 'networkidle2', timeout: 60000});
  if (act === 'list') {
    console.log(await pg.evaluate(() => Object.keys(window).filter(k => typeof window[k] === 'function' && /bot|Bot/.test(k)).join(' ')));
  } else {
    const fn = {stop: 'stopBot', start: 'startBot', restart: 'restartBot', update: 'updateBot'}[act];
    console.log(await pg.evaluate((f, i) => { if (typeof window[f] !== 'function') return 'нет функции ' + f; window[f](i); return 'вызвано ' + f; }, fn, id));
    await new Promise(r => setTimeout(r, 8000));
  }
  await b.close();
})();
