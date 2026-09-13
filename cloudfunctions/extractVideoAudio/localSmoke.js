/**
 * 本地冒烟：不依赖 wx-server-sdk 也能跑 hello
 *   node localSmoke.js
 */
const mod = require('./index.js');

async function run(action) {
  const r = await mod.main({ action: action });
  console.log('\n===', action, '===');
  console.log(JSON.stringify(r, null, 2));
  return r;
}

(async () => {
  const h = await run('hello');
  if (!h || !h.ok) process.exit(1);
  await run('ping');
  await run('pingFfmpeg');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
