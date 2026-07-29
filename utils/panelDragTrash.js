function measureTrash(page, selector, callback) {
  const q = wx.createSelectorQuery().in(page);
  q.select(selector).boundingClientRect();
  q.exec((res) => {
    callback(res && res[0] ? res[0] : null);
  });
}

function pointInRect(x, y, rect) {
  if (!rect) return false;
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function startDrag(page, e) {
  const id = e.currentTarget.dataset.id;
  const label = e.currentTarget.dataset.label || '';
  if (!id) return;
  const touch = (e.touches && e.touches[0]) || e;
  if (!touch) return;
  page._dragTrashId = id;
  page._dragTrashLabel = label;
  page._dragMoved = false;
  measureTrash(page, '#panel-trash', (rect) => {
    page._trashRect = rect;
  });
  page.setData({
    dragging: true,
    dragId: id,
    dragLabel: label,
    dragX: touch.clientX,
    dragY: touch.clientY,
    trashHighlight: false
  });
}

function moveDrag(page, e) {
  if (!page.data.dragging) return;
  const touch = (e.touches && e.touches[0]) || e;
  if (!touch) return;
  page._dragMoved = true;
  const hot = pointInRect(touch.clientX, touch.clientY, page._trashRect);
  page.setData({
    dragX: touch.clientX,
    dragY: touch.clientY,
    trashHighlight: hot
  });
}

function endDrag(page, onDrop) {
  if (!page.data.dragging) return;
  const id = page._dragTrashId;
  const label = page._dragTrashLabel;
  const hot = page.data.trashHighlight;
  page._dragTrashId = '';
  page._dragTrashLabel = '';
  page._trashRect = null;
  page.setData({
    dragging: false,
    dragId: '',
    dragLabel: '',
    trashHighlight: false
  });
  if (hot && id && onDrop) {
    onDrop(id, label);
  }
}

module.exports = {
  startDrag,
  moveDrag,
  endDrag
};
