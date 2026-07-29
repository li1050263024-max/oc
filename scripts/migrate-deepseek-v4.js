/**
 * deepseek-chat 已于 2026-07-24 下线，迁移为 deepseek-v4-flash
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'cloudfunctions');
const files = [
  'ocChat/index.js',
  'generateOcBio/index.js',
  'generateOcStory/index.js',
  'generateOcMoments/index.js',
  'generateOcFakeChat/index.js',
  'generatePoolItem/index.js',
  'expandOcPool/index.js',
  'parseOcSetting/index.js',
  'drawOcCoherent/index.js'
];

for (const rel of files) {
  const p = path.join(root, rel);
  let s = fs.readFileSync(p, 'utf8');
  const before = (s.match(/deepseek-chat/g) || []).length;
  s = s.replace(/model:\s*'deepseek-chat'/g, "model: 'deepseek-v4-flash'");
  s = s.replace(/model:\s*"deepseek-chat"/g, 'model: "deepseek-v4-flash"');
  s = s.replace(
    /model: 'deepseek-v4-flash',\r?\n(\s*)messages,/g,
    "model: 'deepseek-v4-flash',\n$1thinking: { type: 'disabled' },\n$1messages,"
  );
  s = s.replace(
    /model: "deepseek-v4-flash",\r?\n(\s*)messages,/g,
    'model: "deepseek-v4-flash",\n$1thinking: { type: "disabled" },\n$1messages,'
  );
  fs.writeFileSync(p, s, 'utf8');
  console.log(
    rel,
    'old->',
    before,
    'flash',
    (s.match(/deepseek-v4-flash/g) || []).length,
    'left',
    (s.match(/deepseek-chat/g) || []).length,
    'thinking',
    (s.match(/thinking:\s*\{\s*type:\s*['"]disabled['"]\s*\}/g) || []).length
  );
}
