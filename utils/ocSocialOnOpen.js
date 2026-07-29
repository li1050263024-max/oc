const { maybeGenerateMomentsOnAppOpen } = require('./ocMomentsGen.js');
const { maybeInjectFakeMessagesOnAppOpen } = require('./ocFakeNotify.js');
const { beginDedupeSession, endDedupeSession } = require('./ocSocialDedupe.js');

async function runOcSocialOnAppOpen(openTime, options) {
  const t = Number(openTime) || Date.now();
  beginDedupeSession();
  try {
    const fakeChat = await maybeInjectFakeMessagesOnAppOpen(t, options);
    const moments = await maybeGenerateMomentsOnAppOpen({ openTime: t, context: 'app' });
    return { fakeChat, moments };
  } finally {
    endDedupeSession();
  }
}

module.exports = {
  runOcSocialOnAppOpen
};
