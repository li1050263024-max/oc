const {
  buildStoryPromptParts,
  upsertStoryToFavorite,
  newStoryId,
  getStoriesFromItem,
  buildNextChapterTitle
} = require('./storyStore.js');
const { getFavoriteById } = require('./favorite.js');

function noop() {}

function endWritingAnim(page, done) {
  const busy =
    page.data.continuing || page.data.polishing || page.data.storyWritingExiting;
  if (!busy) {
    if (typeof done === 'function') done();
    return;
  }
  page.setData({ storyWritingExiting: true });
  setTimeout(() => {
    page.setData({
      continuing: false,
      polishing: false,
      storyWritingExiting: false,
      storyWritingTip: ''
    });
    if (typeof done === 'function') done();
  }, 680);
}

function startContinueGeneration(page, options) {
  const {
    favId,
    previousStory,
    sourceTitle,
    prevPrompt,
    direction,
    onSuccess,
    onFail
  } = options || {};

  const storyText = String(previousStory || '').trim();
  const titleText = String(sourceTitle || '').trim();
  const dir = String(direction || '').trim();

  if (!favId || !storyText || !titleText) {
    if (typeof onFail === 'function') onFail('缺少故事内容');
    return;
  }
  if (!dir) {
    wx.showToast({ title: '请输入续写方向', icon: 'none' });
    return;
  }
  const parts = buildStoryPromptParts(favId);
  if (!parts) {
    wx.showToast({ title: '缺少 OC 小传', icon: 'none' });
    if (typeof onFail === 'function') onFail('缺少 OC 小传');
    return;
  }
  if (!wx.cloud) {
    wx.showToast({ title: '请使用云开发基础库', icon: 'none' });
    if (typeof onFail === 'function') onFail('无云开发');
    return;
  }

  page.setData({
    continuing: true,
    continueSheetVisible: false,
    storyWritingTip: '正在续写故事…'
  });

  wx.cloud
    .callFunction({
      name: 'generateOcStory',
      data: {
        mode: 'continue',
        ocSetting: parts.ocSetting,
        ocBio: parts.ocBio,
        previousStory: storyText,
        continueDirection: dir
      },
      timeout: 60000
    })
    .then((res) => {
      const r = res.result || {};
      if (!r.ok || !r.story) {
        wx.showToast({ title: r.errMsg || '续写失败', icon: 'none', duration: 3000 });
        endWritingAnim(page, () => {
          if (typeof onFail === 'function') onFail(r.errMsg || '续写失败');
        });
        return;
      }

      const item = getFavoriteById(favId);
      const stories = getStoriesFromItem(item);
      const chapterTitle = buildNextChapterTitle(titleText, stories);
      const newId = newStoryId();
      const userPrompt = prevPrompt
        ? prevPrompt + '\n[续写] ' + dir
        : '[续写] ' + dir;
      const ok = upsertStoryToFavorite(favId, {
        id: newId,
        title: chapterTitle,
        userPrompt,
        content: String(r.story).trim(),
        time: Date.now(),
        parentStoryId: options.parentStoryId || ''
      });

      if (!ok) {
        wx.showToast({ title: '保存失败', icon: 'none' });
        endWritingAnim(page, () => {
          if (typeof onFail === 'function') onFail('保存失败');
        });
        return;
      }

      endWritingAnim(page, () => {
        if (typeof onSuccess === 'function') onSuccess(newId, chapterTitle);
      });
    })
    .catch((err) => {
      const msg = (err && (err.errMsg || err.message)) || '';
      wx.showToast({
        title: /timeout|超时/i.test(msg) ? '请求超时，请重试' : msg || '调用失败',
        icon: 'none',
        duration: 3000
      });
      endWritingAnim(page, () => {
        if (typeof onFail === 'function') onFail(msg || '调用失败');
      });
    });
}

function startStoryRevision(page, options) {
  const { favId, storyBody, direction, onSuccess, onFail } = options || {};
  const body = String(storyBody || '').trim();
  const dir = String(direction || '').trim();

  if (!favId || !body) {
    if (typeof onFail === 'function') onFail('缺少故事正文');
    return;
  }
  if (!dir) {
    wx.showToast({ title: '请输入修改意见', icon: 'none' });
    return;
  }
  const parts = buildStoryPromptParts(favId);
  if (!parts) {
    wx.showToast({ title: '缺少 OC 小传', icon: 'none' });
    if (typeof onFail === 'function') onFail('缺少 OC 小传');
    return;
  }
  if (!wx.cloud) {
    wx.showToast({ title: '请使用云开发基础库', icon: 'none' });
    if (typeof onFail === 'function') onFail('无云开发');
    return;
  }

  page.setData({
    polishing: true,
    polishSheetVisible: false,
    storyWritingTip: '正在润色…'
  });

  wx.cloud
    .callFunction({
      name: 'generateOcStory',
      data: {
        mode: 'revise',
        ocSetting: parts.ocSetting,
        ocBio: parts.ocBio,
        storyBody: body,
        reviseDirection: dir
      },
      timeout: 60000
    })
    .then((res) => {
      const r = res.result || {};
      if (!r.ok || !r.story) {
        wx.showToast({ title: r.errMsg || '润色失败', icon: 'none', duration: 3000 });
        endWritingAnim(page, () => {
          if (typeof onFail === 'function') onFail(r.errMsg || '润色失败');
        });
        return;
      }
      endWritingAnim(page, () => {
        if (typeof onSuccess === 'function') onSuccess(String(r.story).trim());
      });
    })
    .catch((err) => {
      const msg = (err && (err.errMsg || err.message)) || '';
      wx.showToast({
        title: /timeout|超时/i.test(msg) ? '请求超时，请重试' : msg || '调用失败',
        icon: 'none',
        duration: 3000
      });
      endWritingAnim(page, () => {
        if (typeof onFail === 'function') onFail(msg || '调用失败');
      });
    });
}

function openChapter(favId, storyId, redirect, edit) {
  let url =
    '/pages/ocStoryChapter/ocStoryChapter?ocId=' +
    encodeURIComponent(favId) +
    '&storyId=' +
    encodeURIComponent(storyId);
  if (edit) url += '&edit=1';
  if (redirect) {
    wx.redirectTo({ url });
  } else {
    wx.navigateTo({ url });
  }
}

module.exports = {
  noop,
  endWritingAnim,
  startContinueGeneration,
  startStoryRevision,
  openChapter
};
