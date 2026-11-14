// Логи слота через API панели: node bh_api_logs.js <bot_id> [runtime|build]
const fs = require('fs');
const envPath = 'C:/Users/USER/TgMirror/tools/bothost/.env';
if (fs.existsSync(envPath)) for (const l of fs.readFileSync(envPath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
  const i = l.indexOf('='); if (i > 0 && !process.env[l.slice(0, i)]) process.env[l.slice(0, i)] = l.slice(i + 1);
}
const {open} = require('C:/Users/USER/TgMirror/tools/bothost/bhlib.js');
const [id, mode = 'runtime'] = process.argv.slice(2);
(async () => {
  const {b, pg} = await open();
  const text = await pg.evaluate(async (i, m) => {
    const r = await fetch(`/api/bots.php?path=logs&id=${i}&mode=${m}&_t=${Date.now()}`, {credentials: 'include'});
    return r.text();
  }, id, mode);
  let logs = text;
  try { logs = JSON.parse(text).logs ?? text; } catch (e) {}
  console.log(String(logs).replace(/[0-9]{8,10}:[A-Za-z0-9_-]{30,}/g, '<t>').slice(-(+process.env.LEN || 6000)));
  await b.close();
})();
