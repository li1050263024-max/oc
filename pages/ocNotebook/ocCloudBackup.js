const { listCloudBackup, pushNotebookNow } = require('../../utils/userDataSync.js');
const { getFavorites, restoreFavoriteItem, getFavoriteById } = require('../../utils/favorite.js');
const { daysLeft, getArchive } = require('../../utils/ocDeletedArchive.js');
const { applyPageGradientBg } = require('../../utils/tabPage.js');
const { normalizeResult } = require('../../utils/ocResult.js');
const { getUiThemeClass } = require('../../utils/uiTheme.js');
const ocImage = require('../../utils/ocImage.js');
const staticAssets = require('../../utils/staticAssets.js');
const packPage = require('../../utils/ocPackPage.js');
const { buildNotebookPack, buildNotebookShareText } = require('../../utils/ocPack.js');

Page({
  data: {
    uiThemeClass: '',
    loading: true,
    list: [],
    emptyHint: '',
    portraitPlaceholder: staticAssets.getOcPortraitPlaceholder()
  },

  onShow() {
    applyPageGradientBg();
    this.setData({ uiThemeClass: getUiThemeClass() });
    this.loadBackup();
  },

  _mapRow(item, status) {
    const r = normalizeResult((item && item.result) || {});
    const name = (r.name && String(r.name).trim()) || '未命名';
    const id = String(item.id);
    if (!this._itemMap) this._itemMap = {};
    this._itemMap[id] = item;
    return {
      id: id,
      name: name,
      race: r.race || '—',
      gender: r.gender || '—',
      status: status.kind,
      statusText: status.text,
      deleted: status.kind === 'deleted',
      daysLeft: status.daysLeft || 0,
      ocImagePath: ocImage.getDisplayImagePathQuick(item) || ''
    };
  },

  loadBackup() {
    this.setData({ loading: true, emptyHint: '' });
    this._itemMap = {};
    const localIds = {};
    getFavorites().forEach((f) => {
      if (f && f.id) localIds[String(f.id)] = true;
    });

    const buildRows = (r) => {
      const rows = [];
      const seen = {};
      (r.favorites || []).forEach((item) => {
        if (!item || !item.id) return;
        const id = String(item.id);
        seen[id] = true;
        const onLocal = !!localIds[id];
        rows.push(
          this._mapRow(item, {
            kind: onLocal ? 'active' : 'cloud_only',
            text: onLocal ? '云端备份 · 本地已有' : '云端备份 · 本地没有'
          })
        );
      });
      (r.deletedArchive || []).forEach((entry) => {
        if (!entry || !entry.item || !entry.id) return;
        const id = String(entry.id);
        if (seen[id] || localIds[id]) return;
        seen[id] = true;
        const left = daysLeft(entry.deletedAt);
        rows.push(
          this._mapRow(entry.item, {
            kind: 'deleted',
            text: '已删除 · 还剩 ' + left + ' 天',
            daysLeft: left
          })
        );
      });
      // 本地已删除但尚未同步到云端的，也展示出来
      try {
        getArchive().forEach((entry) => {
          if (!entry || !entry.item || !entry.id) return;
          const id = String(entry.id);
          if (seen[id] || localIds[id]) return;
          seen[id] = true;
          const left = daysLeft(entry.deletedAt);
          rows.push(
            this._mapRow(entry.item, {
              kind: 'deleted',
              text: '已删除 · 本地待同步 · 还剩 ' + left + ' 天',
              daysLeft: left
            })
          );
        });
      } catch (_) {}
      rows.sort((a, b) => {
        if (a.deleted !== b.deleted) return a.deleted ? -1 : 1;
        return String(a.name).localeCompare(String(b.name), 'zh');
      });
      return rows;
    };

    // 先拉云端，再尝试推本地；避免空本地覆盖云端
    Promise.resolve()
      .then(() => listCloudBackup())
      .then((r) => {
        if (!r || !r.ok) {
          const localOnly = buildRows({ favorites: [], deletedArchive: [] });
          this.setData({
            loading: false,
            list: localOnly,
            emptyHint: localOnly.length
              ? ''
              : (r && r.errMsg) || '拉取云端备份失败，请检查网络后重试'
          });
          return;
        }
        const rows = buildRows(r);
        this.setData({
          loading: false,
          list: rows,
          emptyHint: rows.length ? '' : '云端暂无备份。请先在有设定本的设备上登录同步，或点下方导入。'
        });
        // 后台合并本地删除归档（不会空盖）
        pushNotebookNow().catch(() => {});
      })
      .catch((e) => {
        const localOnly = buildRows({ favorites: [], deletedArchive: [] });
        this.setData({
          loading: false,
          list: localOnly,
          emptyHint: localOnly.length
            ? ''
            : String((e && e.message) || e || '加载失败')
        });
      });
  },

  onImportNotebook() {
    packPage.runImportPack({}, () => {
      this.loadBackup();
    });
  },

  onExportNotebook() {
    packPage.runExportMenu({
      baseName: 'oc_notebook',
      getText: () => buildNotebookShareText(),
      getPack: () => buildNotebookPack()
    });
  },

  onRestoreTap(e) {
    const id = String((e.currentTarget.dataset && e.currentTarget.dataset.id) || '');
    if (!id) return;
    const row = (this.data.list || []).find((x) => x && String(x.id) === id);
    const item = this._itemMap && this._itemMap[id];
    if (!row || !item) {
      wx.showToast({ title: '找不到该存档', icon: 'none' });
      return;
    }
    if (!row.deleted && getFavoriteById(id)) {
      wx.showModal({
        title: '恢复到本地',
        content: '本地已有「' + row.name + '」，要用云端版本覆盖吗？',
        confirmText: '覆盖',
        success: (res) => {
          if (!res.confirm) return;
          this._doRestore(item);
        }
      });
      return;
    }
    wx.showModal({
      title: '恢复 OC',
      content: row.deleted
        ? '将「' + row.name + '」从已删除备份恢复到设定本？'
        : '将「' + row.name + '」恢复到本地设定本？',
      confirmText: '恢复',
      success: (res) => {
        if (!res.confirm) return;
        this._doRestore(item);
      }
    });
  },

  _doRestore(item) {
    wx.showLoading({ title: '恢复中…', mask: true });
    try {
      const r = restoreFavoriteItem(item);
      wx.hideLoading();
      if (!r.ok) {
        wx.showToast({ title: r.errMsg || '恢复失败', icon: 'none', duration: 2800 });
        return;
      }
      wx.showToast({ title: '已恢复', icon: 'success' });
      this.loadBackup();
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '恢复失败', icon: 'none' });
    }
  },

  onBack() {
    wx.navigateBack({ fail: () => wx.reLaunch({ url: '/pages/ocNotebook/ocNotebook' }) });
  }
});
