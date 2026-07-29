const chatBackground = require('./chatBackground.js');
const ocImage = require('./ocImage.js');

function bgEditDefaults() {
  return {
    bgEditVisible: false,
    bgEditPreview: '',
    bgEditCurrent: '',
    bgEditHasSaved: false,
    bgEditPickedNew: false,
    bgEditCanDelete: false,
    chatBackgroundUrl: ''
  };
}

function isGroupContext(page) {
  return page._bgContext === 'group';
}

function getContextId(page) {
  return isGroupContext(page) ? page.data.roomId || '' : page.data.selectedId || '';
}

function readStoredPath(page, id) {
  return isGroupContext(page)
    ? chatBackground.readGroupChatBackgroundPath(id)
    : chatBackground.readChatBackgroundPathFromStorage(id);
}

function hasStoredBackground(page, id) {
  return isGroupContext(page)
    ? chatBackground.hasGroupChatBackground(id)
    : chatBackground.hasChatBackground(id);
}

function resolveBackground(page, id) {
  return isGroupContext(page)
    ? chatBackground.resolveGroupChatBackground(id)
    : chatBackground.resolveChatBackground(id);
}

function pickBackgroundImage(page, onPicked) {
  const app = getApp();
  if (app && app.globalData) app.globalData.skipNextRelaunch = true;
  page._pickingBackground = true;
  wx.chooseMedia({
    count: 1,
    mediaType: ['image'],
    sourceType: ['album', 'camera'],
    sizeType: ['compressed'],
    success: (res) => {
      page._pickingBackground = false;
      const file = res.tempFiles && res.tempFiles[0];
      if (!file || !file.tempFilePath) return;
      if (typeof onPicked === 'function') onPicked(file.tempFilePath);
    },
    fail: (err) => {
      page._pickingBackground = false;
      if (err.errMsg && err.errMsg.indexOf('cancel') !== -1) return;
      wx.showToast({ title: '未选择图片', icon: 'none' });
    }
  });
}

async function refreshChatBackground(page) {
  const id = getContextId(page);
  const raw = id ? await resolveBackground(page, id) : '';
  await ocImage.setPageImageField(page, 'chatBackgroundUrl', raw || '');
}

function openBgEditSheet(page, patch) {
  const id = getContextId(page);
  page.setData(
    Object.assign(
      {
        bgEditVisible: true,
        bgEditPickedNew: false,
        bgEditCanDelete: hasStoredBackground(page, id)
      },
      patch
    )
  );
}

function onOpenBackgroundEdit(page) {
  const id = getContextId(page);
  if (!id) {
    wx.showToast({
      title: isGroupContext(page) ? '请先选择群聊' : '请先选择 OC',
      icon: 'none'
    });
    return;
  }
  const saved = readStoredPath(page, id);
  if (!saved) {
    pickBackgroundImage(page, (tempPath) => {
      openBgEditSheet(page, {
        bgEditPreview: tempPath,
        bgEditCurrent: '',
        bgEditHasSaved: false,
        bgEditPickedNew: true,
        bgEditCanDelete: false
      });
    });
    return;
  }
  openBgEditSheet(page, {
    bgEditPreview: saved,
    bgEditCurrent: saved,
    bgEditHasSaved: true,
    bgEditPickedNew: false
  });
}

function onCancelBgEdit(page) {
  page.setData({
    bgEditVisible: false,
    bgEditPreview: '',
    bgEditCurrent: '',
    bgEditHasSaved: false,
    bgEditPickedNew: false,
    bgEditCanDelete: false
  });
}

function onBgModify(page) {
  pickBackgroundImage(page, (tempPath) => {
    page.setData({
      bgEditPreview: tempPath,
      bgEditPickedNew: true
    });
  });
}

async function onBgSave(page) {
  const hasSaved = page.data.bgEditHasSaved;
  const pickedNew = page.data.bgEditPickedNew;
  const preview = ocImage.stripDisplayCache(page.data.bgEditPreview);
  const id = getContextId(page);

  if (hasSaved && !pickedNew) {
    wx.showToast({ title: '请先点「修改」选图', icon: 'none' });
    return;
  }
  if (!preview || !id) {
    wx.showToast({ title: '暂无背景可保存', icon: 'none' });
    return;
  }

  wx.showLoading({ title: '保存中…', mask: true });
  try {
    let savedPath = '';
    if (isGroupContext(page)) {
      savedPath = await chatBackground.saveGroupChatBackgroundFromTemp(preview, id);
    } else {
      savedPath = await chatBackground.saveChatBackgroundFromTemp(preview, id);
    }
    onCancelBgEdit(page);
    await ocImage.setPageImageField(page, 'chatBackgroundUrl', savedPath);
    await refreshChatBackground(page);
    wx.showToast({ title: hasSaved ? '背景已更新' : '背景已保存', icon: 'success' });
  } catch (err) {
    const msg = (err && (err.errMsg || err.message)) || '保存失败';
    wx.showToast({
      title: msg.length > 18 ? '保存失败，请重试' : msg,
      icon: 'none'
    });
  } finally {
    wx.hideLoading();
  }
}

function onBgDelete(page) {
  if (!page.data.bgEditCanDelete) {
    wx.showToast({ title: '当前无聊天背景', icon: 'none' });
    return;
  }
  wx.showModal({
    title: '删除背景',
    content: '确定删除当前聊天背景？',
    confirmColor: '#c62828',
    success: async (res) => {
      if (!res.confirm) return;
      wx.showLoading({ title: '删除中…', mask: true });
      try {
        const id = getContextId(page);
        if (isGroupContext(page)) {
          await chatBackground.removeGroupChatBackground(id);
        } else {
          await chatBackground.removeChatBackground(id);
        }
        onCancelBgEdit(page);
        await refreshChatBackground(page);
        wx.showToast({ title: '已删除背景', icon: 'none' });
      } catch (err) {
        wx.showToast({ title: '删除失败', icon: 'none' });
      } finally {
        wx.hideLoading();
      }
    }
  });
}

module.exports = {
  bgEditDefaults,
  refreshChatBackground,
  onOpenBackgroundEdit,
  onCancelBgEdit,
  onBgModify,
  onBgSave,
  onBgDelete
};
