const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'cloudfunctions');
const files = [
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
  const next = s.replace(
    /model: 'deepseek-v4-flash',\r?\n(\s*)messages:/g,
    "model: 'deepseek-v4-flash',\n$1thinking: { type: 'disabled' },\n$1messages:"
  );
  fs.writeFileSync(p, next, 'utf8');
  console.log(
    rel,
    'thinking',
    (next.match(/thinking:\s*\{\s*type:\s*'disabled'\s*\}/g) || []).length
  );
}
