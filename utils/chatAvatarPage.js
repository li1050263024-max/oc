const chatAvatar = require('./chatAvatar.js');
const ocImage = require('./ocImage.js');

/** 设为 false；调试时可改 true */
const AVATAR_DEBUG = false;

function avatarLog(page, step, detail) {
  if (!AVATAR_DEBUG) return;
  const text = detail ? step + ' ' + detail : step;
  if (page && page._avatarDebugLog) {
    page._avatarDebugLog.push(text);
  } else if (page) {
    page._avatarDebugLog = [text];
  }
  console.log('[avatar]', text);
}

function avatarDebug(page, step, detail) {
  avatarLog(page, step, detail);
  if (!AVATAR_DEBUG) return;
  const text = detail ? step + ' ' + detail : step;
  wx.showToast({ title: text, icon: 'none', duration: 2000 });
}

/** toast 显示中会挡住 Modal/ActionSheet，需先 hide 再延迟弹出 */
function scheduleAvatarDialog(fn, delayMs) {
  try {
    wx.hideToast();
  } catch (e) {}
  setTimeout(() => {
    try {
      fn();
    } catch (err) {
      console.error('[avatar] dialog error', err);
    }
  }, typeof delayMs === 'number' ? delayMs : 120);
}

const AVATAR_LONG_PRESS_MS = 380;

function avatarEditDefaults() {
  return {
    avatarEditVisible: false,
    avatarEditRole: '',
    avatarEditOcId: '',
    avatarEditLabel: '',
    avatarEditPreview: '',
    avatarEditCurrent: '',
    avatarEditHasSavedAvatar: false,
    avatarEditPickedNew: false,
    avatarEditCanDelete: false,
    avatarPressKey: '',
    userAvatarUrl: '',
    ocAvatarUrl: '',
    ocAvatarLetter: 'O',
    memberAvatarMap: {}
  };
}

function resolveSavedAvatarUrl(page, role, ocId) {
  if (role === 'user') {
    const p = page.data.userAvatarUrl || chatAvatar.getStoredUserAvatarPath() || '';
    return ocImage.stripDisplayCache(p);
  }
  if (role === 'oc' && ocId) {
    const fromMap = page.data.memberAvatarMap && page.data.memberAvatarMap[ocId];
    if (fromMap) return ocImage.stripDisplayCache(fromMap);
    if (ocId === page.data.selectedId && page.data.ocAvatarUrl) {
      return ocImage.stripDisplayCache(page.data.ocAvatarUrl);
    }
    const pick = (page.data.ocList || []).find((x) => x.id === ocId);
    if (pick && pick.avatarUrl) return ocImage.stripDisplayCache(pick.avatarUrl);
    const member = (page.data.members || []).find((m) => m.id === ocId);
    if (member && member.avatarUrl) return ocImage.stripDisplayCache(member.avatarUrl);
    return chatAvatar.readOcAvatarPathsFromStorage(ocId) || '';
  }
  return '';
}

function resolveCanDeleteAvatar(role, ocId) {
  if (role === 'user') {
    return !!chatAvatar.getStoredUserAvatarPath();
  }
  if (role === 'oc' && ocId) {
    return !!chatAvatar.readChatOnlyAvatarPath(ocId);
  }
  return false;
}

function pickAvatarImage(page, onPicked, opts) {
  if (page._pickingAvatar) return;
  const app = getApp();
  if (app && app.globalData) app.globalData.skipNextRelaunch = true;
  page._pickingAvatar = true;
  const sourceType =
    opts && opts.sourceType ? opts.sourceType : ['album', 'camera'];

  const deliverPickedPath = (tempPath) => {
    if (!tempPath) {
      page._pickingAvatar = false;
      wx.showToast({ title: '未获取到图片', icon: 'none' });
      return;
    }
    ocImage
      .captureTempImagePath(tempPath)
      .then((stablePath) => {
        page._pickingAvatar = false;
        if (typeof onPicked === 'function') onPicked(stablePath);
      })
      .catch((err) => {
        page._pickingAvatar = false;
        console.error('[avatar] stabilize temp failed', err);
        const msg = String((err && (err.errMsg || err.message)) || '');
        const devHint = /tmp\//i.test(msg) || /no such file/i.test(msg);
        wx.showToast({
          title: devHint ? '模拟器选图受限，请真机预览' : '图片读取失败',
          icon: 'none',
          duration: 2500
        });
      });
  };

  const fail = (err) => {
    page._pickingAvatar = false;
    const msg = (err && err.errMsg) || '';
    if (/cancel/i.test(msg)) return;
    wx.showToast({ title: '无法打开相册', icon: 'none' });
  };

  const chooseWithMedia = () => {
    if (typeof wx.chooseMedia !== 'function') {
      fail({ errMsg: 'chooseMedia unavailable' });
      return;
    }
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType,
      sizeType: ['compressed'],
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0];
        deliverPickedPath(file && file.tempFilePath);
      },
      fail: (err) => {
        const msg = (err && err.errMsg) || '';
        if (/cancel/i.test(msg)) {
          page._pickingAvatar = false;
          return;
        }
        fail(err);
      }
    });
  };

  try {
    if (typeof wx.chooseImage !== 'function') {
      chooseWithMedia();
      return;
    }
    wx.chooseImage({
      count: 1,
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (res) => {
        const path =
          (res.tempFilePaths && res.tempFilePaths[0]) ||
          (res.tempFiles && res.tempFiles[0] && res.tempFiles[0].path) ||
          '';
        deliverPickedPath(path);
      },
      fail: (err) => {
        const msg = (err && err.errMsg) || '';
        if (/cancel/i.test(msg)) {
          page._pickingAvatar = false;
          return;
        }
        chooseWithMedia();
      }
    });
  } catch (err) {
    page._pickingAvatar = false;
    chooseWithMedia();
  }
}

async function refreshOcChatAvatars(page) {
  const userAvatarUrl = await chatAvatar.resolveUserAvatar();
  const selectedId = page.data.selectedId;
  const pick = (page.data.ocList || []).find((x) => x.id === selectedId);
  const rawOc = selectedId
    ? await chatAvatar.resolveOcAvatar(selectedId, pick && pick.avatarUrl)
    : '';
  const name = page.data.selectedName || '';
  await ocImage.setPageImageField(page, 'userAvatarUrl', userAvatarUrl);
  await ocImage.setPageImageField(page, 'ocAvatarUrl', rawOc);
  page.setData({
    ocAvatarLetter: name ? name.slice(0, 1) : 'O'
  });
}

async function refreshGroupChatAvatars(page) {
  const userAvatarUrl = await chatAvatar.resolveUserAvatar();
  const memberAvatarMap = await chatAvatar.buildMemberAvatarMap(page.data.members || []);
  await ocImage.setPageImageField(page, 'userAvatarUrl', userAvatarUrl);
  page.setData({ memberAvatarMap });
}

function getAvatarRefreshFn(page) {
  if (page.data && page.data.roomId) {
    return refreshGroupChatAvatars;
  }
  return refreshOcChatAvatars;
}

async function applySavedAvatar(page, role, ocId, savedPath) {
  if (role === 'user') {
    await ocImage.setPageImageField(page, 'userAvatarUrl', savedPath);
    return;
  }
  if (!savedPath || !ocId) return;
  if (ocId === page.data.selectedId) {
    await ocImage.setPageImageField(page, 'ocAvatarUrl', savedPath);
    return;
  }
  if (page.data.memberAvatarMap) {
    page.setData({
      memberAvatarMap: Object.assign({}, page.data.memberAvatarMap, {
        [ocId]: savedPath
      })
    });
  }
}

function pickAndSaveAvatar(page, role, ocId, refreshFn, wasUpdate) {
  pickAvatarImage(page, (tempPath) => {
    if (!tempPath) {
      wx.showToast({ title: '未获取到图片', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '保存中…', mask: true });
    Promise.resolve()
      .then(async () => {
        let savedPath = '';
        if (role === 'user') {
          savedPath = await chatAvatar.saveUserAvatarFromTemp(tempPath);
        } else if (ocId) {
          savedPath = await chatAvatar.saveOcAvatarFromTemp(tempPath, ocId);
        }
        if (!savedPath) throw new Error('保存图片失败');
        await applySavedAvatar(page, role, ocId, savedPath);
        if (typeof refreshFn === 'function') {
          await refreshFn(page);
        }
        wx.showToast({
          title: wasUpdate ? '头像已更新' : '头像已保存',
          icon: 'success'
        });
      })
      .catch((err) => {
        console.error('[avatar] save failed', err);
        const msg = String((err && (err.message || err.errMsg)) || '').trim();
        wx.showToast({
          title: msg && msg.length <= 18 ? msg : '保存失败，请重试',
          icon: 'none'
        });
      })
      .finally(() => {
        try {
          wx.hideLoading();
        } catch (e) {}
      });
  });
}

function confirmDeleteAvatar(page, role, ocId, refreshFn) {
  wx.showModal({
    title: '删除头像',
    content: '确定删除当前对话头像？',
    confirmColor: '#c62828',
    success: async (res) => {
      if (!res.confirm) return;
      wx.showLoading({ title: '删除中…', mask: true });
      try {
        if (role === 'user') {
          await chatAvatar.removeUserAvatar();
        } else if (role === 'oc' && ocId) {
          await chatAvatar.removeOcChatAvatar(ocId);
        }
        if (typeof refreshFn === 'function') {
          await refreshFn(page);
        }
        wx.showToast({ title: '已删除头像', icon: 'none' });
      } catch (err) {
        wx.showToast({ title: '删除失败', icon: 'none' });
      } finally {
        wx.hideLoading();
      }
    }
  });
}

function resolveAvatarPressKey(e) {
  const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
  if (ds.pressKey) return String(ds.pressKey);
  const target = String(ds.avatarTarget || 'avatar');
  if (ds.msgIndex !== undefined && ds.msgIndex !== '') {
    return target + '-' + ds.msgIndex;
  }
  if (ds.ocId) return target + '-' + ds.ocId;
  return target;
}

function setAvatarPressVisual(page, e) {
  const key = resolveAvatarPressKey(e);
  if (page.data.avatarPressKey !== key) {
    page.setData({ avatarPressKey: key });
  }
}

function clearAvatarPressVisual(page) {
  if (page.data.avatarPressKey) {
    page.setData({ avatarPressKey: '' });
  }
}

function openAvatarEditForInfo(page, info) {
  if (!info) {
    avatarDebug(page, '⑥失败', '无头像信息');
    return;
  }

  const role = normalizeAvatarRole(info.role);
  if (!role) {
    avatarDebug(page, '⑥失败', '角色无效');
    return;
  }
  const ocId = role === 'oc' ? resolveAvatarOcId(page, info) : '';
  if (role === 'oc' && !ocId) {
    avatarDebug(page, '⑥失败', '无OC id');
    wx.showToast({ title: '请先选择 OC', icon: 'none' });
    return;
  }
  avatarLog(page, '⑥OK', role + (ocId ? ':' + ocId.slice(0, 6) : ''));

  const label =
    role === 'user'
      ? '我的头像'
      : info.label ||
        ((page.data.members || []).find((m) => m.id === ocId) || {}).name ||
        page.data.selectedName ||
        'OC 头像';
  const canDelete = resolveCanDeleteAvatar(role, ocId);
  const refreshFn = getAvatarRefreshFn(page);
  const startPick = () => pickAndSaveAvatar(page, role, ocId, refreshFn, canDelete);

  scheduleAvatarDialog(() => {
    avatarLog(page, '⑦', canDelete ? 'ActionSheet' : 'Modal');
    if (canDelete) {
      wx.showActionSheet({
        itemList: ['从相册选图', '删除对话头像'],
        success: (res) => {
          if (res.tapIndex === 0) startPick();
          else if (res.tapIndex === 1) {
            confirmDeleteAvatar(page, role, ocId, refreshFn);
          }
        },
        fail: (err) => {
          avatarDebug(page, '⑦失败', (err && err.errMsg) || 'ActionSheet');
        }
      });
      return;
    }

    wx.showModal({
      title: '设置' + label,
      content: '从相册选择一张图片，作为本对话专用头像',
      confirmText: '选图',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) startPick();
      },
      fail: (err) => {
        avatarDebug(page, '⑦失败', (err && err.errMsg) || 'Modal');
      }
    });
  });
}

function clearAvatarLongPressTimer(page) {
  if (page._avatarLongPressTimer) {
    clearTimeout(page._avatarLongPressTimer);
    page._avatarLongPressTimer = null;
  }
}

function clearAvatarLongPressFallbackTimer(page) {
  if (page._avatarLongPressFallbackTimer) {
    clearTimeout(page._avatarLongPressFallbackTimer);
    page._avatarLongPressFallbackTimer = null;
  }
}

function openAvatarFromPending(page, pending, tag) {
  if (!pending || page._avatarOpenScheduled) return;
  page._avatarOpenScheduled = true;
  clearAvatarLongPressTimer(page);
  clearAvatarLongPressFallbackTimer(page);
  page._avatarTapPending = null;
  page._avatarTapAt = 0;
  page._avatarLongPressFired = false;
  page._avatarTouchEndHandled = true;
  clearAvatarPressVisual(page);
  avatarLog(page, '②→打开', tag);
  scheduleAvatarDialog(() => {
    page._avatarOpenScheduled = false;
    try {
      openAvatarEditForInfo(page, pending);
    } catch (err) {
      console.error('[avatar] open error', err);
      avatarDebug(page, '打开失败', (err && err.message) || '未知错误');
    }
  });
}

function scheduleAvatarLongPress(page) {
  clearAvatarLongPressTimer(page);
  clearAvatarLongPressFallbackTimer(page);
  if (!page._avatarTapPending) return;
  page._avatarLongPressTimer = setTimeout(() => {
    page._avatarLongPressTimer = null;
    if (!page._avatarTapAt || page._avatarTouchMoved || page._avatarLongPressFired) return;
    page._avatarLongPressFired = true;
    avatarLog(page, '④长按', AVATAR_LONG_PRESS_MS + 'ms');
    // scroll-view 有时收不到 touchend，延迟兜底（等手指抬起后再弹）
    page._avatarLongPressFallbackTimer = setTimeout(() => {
      page._avatarLongPressFallbackTimer = null;
      const pending = page._avatarTapPending;
      if (!pending || page._avatarTouchMoved || page._avatarOpenScheduled) return;
      openAvatarFromPending(page, pending, 'fallback');
    }, 320);
  }, AVATAR_LONG_PRESS_MS);
}

function openAvatarEditSheet(page, patch) {
  const role = patch.avatarEditRole || page.data.avatarEditRole;
  const ocId = patch.avatarEditOcId || page.data.avatarEditOcId;
  page.setData(
    Object.assign(
      {
        avatarEditVisible: true,
        avatarEditPickedNew: false,
        avatarEditCanDelete: resolveCanDeleteAvatar(role, ocId)
      },
      patch
    )
  );
}

function normalizeAvatarRole(raw) {
  const s = String(raw || '').toLowerCase();
  if (s === 'user') return 'user';
  if (s === 'oc' || s === 'char' || s === 'character') return 'oc';
  return '';
}

function resolveAvatarOcId(page, opts) {
  const fromOpts = String((opts && opts.ocId) || '').trim();
  if (fromOpts) return fromOpts;
  const label = String((opts && opts.label) || '').trim();
  if (label) {
    const mem = (page.data.members || []).find((m) => m && m.name === label);
    if (mem && mem.id) return mem.id;
    const pick = (page.data.ocList || []).find((x) => x && x.name === label);
    if (pick && pick.id) return pick.id;
  }
  if (page.data.selectedId) return page.data.selectedId;
  const members = page.data.members || [];
  if (members.length === 1 && members[0].id) return members[0].id;
  return '';
}

function normalizeGroupMessages(members, messages) {
  const { sanitizeSocialMessageContent } = require('./ocGroupProactive.js');
  const list = Array.isArray(messages) ? messages : [];
  const mems = members || [];
  return list.map((m) => {
    if (!m) return m;
    const patch = {};
    if (m.content) {
      patch.content = sanitizeSocialMessageContent(m.content);
    }
    if (m.role === 'user') {
      return Object.keys(patch).length ? Object.assign({}, m, patch) : m;
    }
    if (m.ocId) {
      return Object.keys(patch).length ? Object.assign({}, m, patch) : m;
    }
    const name = String(m.name || '').trim();
    if (!name) {
      return Object.keys(patch).length ? Object.assign({}, m, patch) : m;
    }
    const mem = mems.find((x) => x && x.name === name);
    if (!mem || !mem.id) {
      return Object.keys(patch).length ? Object.assign({}, m, patch) : m;
    }
    return Object.assign({}, m, patch, { ocId: mem.id });
  });
}

function normalizeOcChatMessages(ocId, messages) {
  const id = String(ocId || '').trim();
  return (messages || []).map((m) => {
    if (!m || m.role === 'user') return m;
    if (m.ocId) return m;
    if (!id) return m;
    return Object.assign({}, m, { ocId: id });
  });
}

function readAvatarEvent(page, e) {
  const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
  const type = String(
    ds.avatarTarget ||
      ds.kind ||
      ds.avatarKind ||
      ds.avt ||
      ds.avatarType ||
      ds.at ||
      ds.k ||
      ''
  ).toLowerCase();
  if (type === 'user') {
    return { role: 'user', ocId: '', label: '我的头像' };
  }
  if (type === 'character' || type === 'oc' || type === 'char') {
    const ocId =
      ds.ocId ||
      ds.avid ||
      ds.avatarId ||
      ds.aid ||
      page.data.selectedId ||
      '';
    const label =
      ds.label ||
      ds.avlabel ||
      ds.avatarLabel ||
      ds.alabel ||
      page.data.selectedName ||
      'OC 头像';
    return { role: 'oc', ocId, label };
  }
  return null;
}

function resolveAvatarFromEvent(page, e) {
  const info = readAvatarEvent(page, e);
  if (info) {
    if (info.role === 'oc') {
      const ocId = String(info.ocId || resolveAvatarOcId(page, info) || '').trim();
      if (!ocId) return null;
      return Object.assign({}, info, { ocId });
    }
    return info;
  }

  const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
  const target = String(ds.avatarTarget || ds.target || '').toLowerCase();

  if (target === 'user') {
    return { role: 'user', ocId: '', label: '我的头像' };
  }

  if (target === 'oc' || target === 'composer-oc') {
    const ocId = String(ds.ocId || page.data.selectedId || '').trim();
    if (!ocId) return null;
    return {
      role: 'oc',
      ocId,
      label: ds.label || page.data.selectedName || 'OC 头像'
    };
  }

  if (target === 'group-member') {
    const ocId = String(ds.ocId || ds.memberId || '').trim();
    if (!ocId) return null;
    return { role: 'oc', ocId, label: ds.label || 'OC 头像' };
  }

  if (ds.msgIndex !== undefined && ds.msgIndex !== '') {
    const idx = Number(ds.msgIndex);
    const list = page.data.messages || [];
    if (!Number.isNaN(idx) && list[idx]) {
      const m = list[idx];
      if (m.role === 'user') {
        return { role: 'user', ocId: '', label: '我的头像' };
      }
      const ocId = String(m.ocId || page.data.selectedId || '').trim();
      if (!ocId) return null;
      return {
        role: 'oc',
        ocId,
        label: m.name || page.data.selectedName || 'OC 头像'
      };
    }
  }

  return null;
}

function onAvatarTouchStart(page, e) {
  clearAvatarLongPressTimer(page);
  clearAvatarLongPressFallbackTimer(page);
  page._avatarOpenScheduled = false;
  page._avatarLongPressFired = false;
  page._avatarTapAt = Date.now();
  page._avatarTouchMoved = false;
  page._avatarTouchEndHandled = false;
  page._avatarTouchStartX = null;
  page._avatarTouchStartY = null;
  page._avatarTapPending = resolveAvatarFromEvent(page, e);
  setAvatarPressVisual(page, e);
  const hint = page._avatarTapPending
    ? page._avatarTapPending.role +
      (page._avatarTapPending.ocId
        ? ':' + String(page._avatarTapPending.ocId).slice(0, 6)
        : '')
    : '未识别';
  avatarLog(page, '①按下', hint);
  if (!page._avatarTapPending) {
    avatarDebug(page, '①失败', '未识别头像');
    return;
  }
  scheduleAvatarLongPress(page);
}

function onAvatarTouchMoveBlock(page, e) {
  if (!page._avatarTapAt) return;
  const touch = e.touches && e.touches[0];
  if (!touch) return;
  if (typeof page._avatarTouchStartX !== 'number') {
    page._avatarTouchStartX = touch.clientX;
    page._avatarTouchStartY = touch.clientY;
    return;
  }
  const dx = Math.abs(touch.clientX - page._avatarTouchStartX);
  const dy = Math.abs(touch.clientY - page._avatarTouchStartY);
  if (dx > 12 || dy > 12) {
    page._avatarTouchMoved = true;
    clearAvatarLongPressTimer(page);
  }
}

function onAvatarTouchEnd(page) {
  clearAvatarLongPressTimer(page);
  clearAvatarLongPressFallbackTimer(page);
  const pending = page._avatarTapPending;
  const elapsed = Date.now() - (page._avatarTapAt || 0);
  const longPress = page._avatarLongPressFired;
  page._avatarTapPending = null;
  page._avatarTapAt = 0;
  page._avatarTouchStartX = null;
  page._avatarTouchStartY = null;
  clearAvatarPressVisual(page);

  if (longPress) {
    page._avatarLongPressFired = false;
    avatarLog(page, '②抬起', '长按 ' + elapsed + 'ms');
    if (pending && !page._avatarTouchMoved) {
      openAvatarFromPending(page, pending, 'longpress-' + elapsed + 'ms');
    }
    return;
  }

  avatarLog(page, '②抬起', elapsed + 'ms');

  if (!pending) {
    avatarDebug(page, '②跳过', '未识别头像');
    return;
  }
  if (page._avatarTouchMoved) {
    avatarDebug(page, '②跳过', '手指滑动了');
    return;
  }

  openAvatarFromPending(page, pending, 'tap-' + elapsed + 'ms');
}

function onAvatarTouchMove() {}

function onAvatarPressTouchStart(page, e) {
  onAvatarTouchStart(page, e);
}

function onAvatarPressTouchEnd(page) {
  onAvatarTouchEnd(page);
}

function onAvatarTap(page, e) {
  if (page._avatarTouchEndHandled) {
    page._avatarTouchEndHandled = false;
    return;
  }
  clearAvatarLongPressTimer(page);
  avatarLog(page, '③点击', '备用');
  clearAvatarPressVisual(page);
  const info = resolveAvatarFromEvent(page, e);
  if (!info) {
    avatarDebug(page, '⑤失败', '无法识别头像');
    wx.showToast({ title: '无法更换该头像', icon: 'none' });
    return;
  }
  avatarLog(page, '⑤OK', info.role + (info.ocId ? ':' + String(info.ocId).slice(0, 6) : ''));
  page._avatarTapPending = null;
  openAvatarEditForInfo(page, info);
}

function onAvatarLongPress(page, e) {
  clearAvatarLongPressTimer(page);
  clearAvatarLongPressFallbackTimer(page);
  page._avatarLongPressFired = true;
  page._avatarTapPending = null;
  page._avatarTapAt = 0;
  clearAvatarPressVisual(page);
  avatarLog(page, '④长按', 'event');
  const info = resolveAvatarFromEvent(page, e);
  if (!info) {
    avatarDebug(page, '⑤失败', '无法识别头像');
    return;
  }
  scheduleAvatarDialog(() => {
    try {
      openAvatarEditForInfo(page, info);
    } catch (err) {
      console.error('[avatar] longpress event error', err);
      avatarDebug(page, '打开失败', (err && err.message) || '未知错误');
    }
  }, 280);
}

function onComposerOcAvatarTap(page) {
  avatarLog(page, '③composer', '');
  clearAvatarPressVisual(page);
  if (!page.data.selectedId) {
    avatarDebug(page, '⑤失败', '无 selectedId');
    wx.showToast({ title: '请先选择 OC', icon: 'none' });
    return;
  }
  if (page._avatarTouchEndHandled) {
    page._avatarTouchEndHandled = false;
    return;
  }
  openAvatarEditForInfo(page, {
    role: 'oc',
    ocId: page.data.selectedId,
    label: page.data.selectedName || 'OC 头像'
  });
}

function onComposerGroupAvatarTap(page) {
  const members = page.data.members || [];
  if (!page.data.roomId) {
    wx.showToast({ title: '请先选择群聊', icon: 'none' });
    return;
  }
  const itemList = ['我的头像'].concat(
    members.map((m) => (m.name || 'OC') + ' 的头像')
  );
  wx.showActionSheet({
    itemList,
    success: (res) => {
      const idx = res.tapIndex;
      if (idx === 0) {
        openAvatarEditForInfo(page, { role: 'user' });
        return;
      }
      const mem = members[idx - 1];
      if (mem && mem.id) {
        openAvatarEditForInfo(page, {
          role: 'oc',
          ocId: mem.id,
          label: mem.name || 'OC 头像'
        });
      }
    }
  });
}

function openOcAvatarEdit(page) {
  if (!page.data.selectedId) {
    wx.showToast({ title: '请先选择 OC', icon: 'none' });
    return;
  }
  openAvatarEditForInfo(page, {
    role: 'oc',
    ocId: page.data.selectedId,
    label: page.data.selectedName || 'OC 头像'
  });
}

function openMemberAvatarEdit(page, ocId, label) {
  if (!ocId) {
    wx.showToast({ title: '未找到 OC', icon: 'none' });
    return;
  }
  openAvatarEditForInfo(page, {
    role: 'oc',
    ocId,
    label: label || 'OC 头像'
  });
}

function openUserAvatarEdit(page) {
  openAvatarEditForInfo(page, { role: 'user' });
}

function triggerAvatarEdit(page, info) {
  openAvatarEditForInfo(page, info);
}

function onCancelAvatarEdit(page) {
  page.setData({
    avatarEditVisible: false,
    avatarEditRole: '',
    avatarEditOcId: '',
    avatarEditLabel: '',
    avatarEditPreview: '',
    avatarEditCurrent: '',
    avatarEditHasSavedAvatar: false,
    avatarEditPickedNew: false,
    avatarEditCanDelete: false
  });
}

function onAvatarModify(page) {
  pickAvatarImage(page, (tempPath) => {
    page.setData({
      avatarEditPreview: tempPath,
      avatarEditPickedNew: true
    });
  });
}

async function onAvatarSave(page, refreshFn) {
  const hasSavedAvatar = page.data.avatarEditHasSavedAvatar;
  const pickedNew = page.data.avatarEditPickedNew;
  const preview = ocImage.stripDisplayCache(page.data.avatarEditPreview);

  if (hasSavedAvatar && !pickedNew) {
    wx.showToast({ title: '请先点「修改」选图', icon: 'none' });
    return;
  }
  if (!preview) {
    wx.showToast({ title: '暂无头像可保存', icon: 'none' });
    return;
  }

  wx.showLoading({ title: '保存中…', mask: true });
  const role = page.data.avatarEditRole;
  const ocId = page.data.avatarEditOcId;
  try {
    let savedPath = '';
    if (role === 'user') {
      savedPath = await chatAvatar.saveUserAvatarFromTemp(preview);
    } else if (role === 'oc' && ocId) {
      savedPath = await chatAvatar.saveOcAvatarFromTemp(preview, ocId);
    }
    const wasUpdate = hasSavedAvatar;
    onCancelAvatarEdit(page);
    await applySavedAvatar(page, role, ocId, savedPath);
    if (typeof refreshFn === 'function') {
      await refreshFn(page);
    }
    if (!savedPath && role === 'oc') {
      wx.showToast({ title: '保存失败，请重试', icon: 'none' });
      return;
    }
    wx.showToast({
      title: wasUpdate ? '头像已更新' : '头像已保存',
      icon: 'success'
    });
  } catch (err) {
    const msg = (err && (err.errMsg || err.message)) || '保存失败';
    wx.showToast({
      title: msg.length > 20 ? '保存失败，请重试' : msg,
      icon: 'none'
    });
  } finally {
    wx.hideLoading();
  }
}

function onAvatarDelete(page, refreshFn) {
  if (!page.data.avatarEditCanDelete) {
    wx.showToast({ title: '当前无对话专用头像', icon: 'none' });
    return;
  }
  confirmDeleteAvatar(
    page,
    page.data.avatarEditRole,
    page.data.avatarEditOcId,
    refreshFn
  );
}

module.exports = {
  avatarEditDefaults,
  refreshOcChatAvatars,
  refreshGroupChatAvatars,
  onAvatarTouchStart,
  onAvatarTouchMove,
  onAvatarTouchMoveBlock,
  onAvatarTouchEnd,
  onAvatarPressTouchStart,
  onAvatarPressTouchEnd,
  onAvatarTap,
  onAvatarLongPress,
  triggerAvatarEdit,
  normalizeGroupMessages,
  normalizeOcChatMessages,
  onComposerOcAvatarTap,
  onComposerGroupAvatarTap,
  openOcAvatarEdit,
  openUserAvatarEdit,
  openMemberAvatarEdit,
  onCancelAvatarEdit,
  onAvatarModify,
  onAvatarSave,
  onAvatarDelete
};
