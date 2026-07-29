const colors = require('./colors.js');
const { normalizeResult, normalizeBackground } = require('./ocResult.js');
const { defaultCatchphrases, defaultAttitudes } = require('./ocNotebookData.js');

function pickStr(next, prev) {
  const n = String(next == null ? '' : next).trim();
  if (n) return n;
  return String(prev == null ? '' : prev).trim();
}

function pickArr3(next, prev) {
  const arr = Array.isArray(next) ? next.slice(0, 3).map((x) => String(x || '').trim()) : [];
  if (arr.some(Boolean)) {
    while (arr.length < 3) arr.push('');
    return arr;
  }
  return Array.isArray(prev) ? prev.slice(0, 3) : ['', '', ''];
}

function pickAttitudes(next, prev) {
  const list = Array.isArray(next) ? next.slice(0, 3) : [];
  if (
    list.some(
      (a) => a && (String(a.event || '').trim() || String(a.attitude || '').trim())
    )
  ) {
    return list.map((a) => ({
      event: String((a && a.event) || '').trim(),
      attitude: String((a && a.attitude) || '').trim()
    }));
  }
  return Array.isArray(prev) ? prev.map((a) => ({ ...a })) : defaultAttitudes();
}

function applyParsedSetting(pageData, setting) {
  if (!setting || typeof setting !== 'object') return null;
  const prev = pageData || {};
  const result = normalizeResult(
    Object.assign({}, prev.result, {
      name: pickStr(setting.name, prev.result && prev.result.name),
      race: pickStr(setting.race, prev.result && prev.result.race),
      gender: pickStr(setting.gender, prev.result && prev.result.gender),
      age: pickStr(setting.age, prev.result && prev.result.age),
      hairColor: pickStr(setting.hairColor, prev.result && prev.result.hairColor),
      eyeColor: pickStr(setting.eyeColor, prev.result && prev.result.eyeColor),
      likes: pickStr(setting.likes, prev.result && prev.result.likes),
      personalities: pickArr3(setting.personalities, prev.result && prev.result.personalities),
      quirks: pickArr3(setting.quirks, prev.result && prev.result.quirks)
    })
  );
  const background = normalizeBackground({
    worldview: pickStr(setting.worldview, prev.background && prev.background.worldview),
    origins: pickArr3(setting.origins, prev.background && prev.background.origins),
    lifeEvents: pickArr3(setting.lifeEvents, prev.background && prev.background.lifeEvents)
  });
  const catchphrases = pickArr3(setting.catchphrases, prev.catchphrases).slice(0, 3);
  while (catchphrases.length < 3) catchphrases.push('');
  const attitudes = pickAttitudes(setting.attitudes, prev.attitudes).slice(0, 3);
  while (attitudes.length < 3) attitudes.push({ event: '', attitude: '' });

  return {
    result,
    background,
    catchphrases,
    attitudes,
    hairHex: colors.getHairColor(result.hairColor),
    eyeHex: colors.getEyeColor(result.eyeColor),
    layer3Ready: require('./ocWork.js').isLayer3Ready({ result, catchphrases, attitudes })
  };
}

module.exports = {
  applyParsedSetting
};
