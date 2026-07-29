const {

  defaultResult,

  normalizeResult,

  defaultBackground,

  normalizeBackground,

  pad3

} = require('./ocResult.js');

const ocImage = require('./ocImage.js');
const {
  normalizeRelationships,
  normalizeRelationEdges,
  normalizeTimelineEvents,
  normalizeProfileScene
} = require('./ocProfileData.js');



function defaultCatchphrases() {

  return ['', '', ''];

}



function defaultAttitudes() {

  return [

    { event: '', attitude: '' },

    { event: '', attitude: '' },

    { event: '', attitude: '' }

  ];

}



function emptyWork() {

  return {

    result: defaultResult(),

    background: defaultBackground(),

    catchphrases: defaultCatchphrases(),

    attitudes: defaultAttitudes(),

    generatedBio: '',

    ocImages: [],

    ocImagePath: '',

    source: 'notebook'

  };

}



function mergeWork(raw) {

  const r = raw && raw.result ? normalizeResult(raw.result) : defaultResult();

  const bg = raw && raw.background ? normalizeBackground(raw.background) : defaultBackground();

  let cp = (raw && raw.catchphrases) || [];

  cp = cp.slice(0, 3);

  while (cp.length < 3) cp.push('');

  let ad = (raw && raw.attitudes) || [];

  ad = ad.slice(0, 3).map((a) => ({

    event: (a && a.event) || '',

    attitude: (a && a.attitude) || ''

  }));

  while (ad.length < 3) ad.push({ event: '', attitude: '' });

  const ocImages = ocImage.normalizeOcImageList(raw && raw.ocImages);
  const seed = {
    ocAlbums: raw && raw.ocAlbums,
    ocImages,
    ocImagePath: (raw && raw.ocImagePath) || ''
  };
  const ocAlbum = require('./ocAlbum.js');
  ocAlbum.syncWorkImagesFromAlbums(seed);

  return {

    result: r,

    background: bg,

    catchphrases: cp,

    attitudes: ad,

    generatedBio: (raw && raw.generatedBio) || '',

    ocAlbums: seed.ocAlbums,

    ocImages: seed.ocImages,

    ocImagePath: seed.ocImagePath,

    notebookFavoriteId: (raw && raw.notebookFavoriteId) || '',

    relationships: normalizeRelationships(raw && raw.relationships),

    relationEdges: normalizeRelationEdges(raw && raw.relationEdges),

    timelineEvents: normalizeTimelineEvents(raw && raw.timelineEvents),

    profileScene: normalizeProfileScene(raw && raw.profileScene)

  };

}



function workSnapshot(pageData) {

  const ocAlbum = require('./ocAlbum.js');
  const seed = {
    ocAlbums: pageData.ocAlbums,
    ocImages: pageData.ocImages,
    ocImagePath: pageData.ocImagePath || ''
  };
  ocAlbum.syncWorkImagesFromAlbums(seed);

  return {

    result: normalizeResult(pageData.result),

    background: normalizeBackground(pageData.background),

    catchphrases: (pageData.catchphrases || []).slice(),

    attitudes: (pageData.attitudes || []).map((a) => ({ ...a })),

    generatedBio: pageData.generatedBio || '',

    ocAlbums: seed.ocAlbums,

    ocImages: (seed.ocImages || []).map((g) => ({ ...g })),

    ocImagePath: seed.ocImagePath,

    notebookFavoriteId: pageData.favoriteId || '',

    relationships: normalizeRelationships(pageData.relationships),

    relationEdges: normalizeRelationEdges(pageData.relationEdges),

    timelineEvents: normalizeTimelineEvents(pageData.timelineEvents),

    profileScene: normalizeProfileScene(pageData.profileScene)

  };

}



module.exports = {

  defaultResult,

  defaultBackground,

  defaultCatchphrases,

  defaultAttitudes,

  emptyWork,

  mergeWork,

  workSnapshot,

  pad3

};

