function lcsTable(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array(m + 1)
    .fill(0)
    .map(() => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1;
      else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp;
}

function backtrackLcs(a, b, dp) {
  const seq = [];
  let i = a.length;
  let j = b.length;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      seq.unshift(a[i - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) i--;
    else j--;
  }
  return seq;
}

function isEmptyLine(text) {
  return !String(text || '').trim();
}

function buildLineDiff(before, after) {
  const oldLines = String(before || '').split('\n');
  const newLines = String(after || '').split('\n');
  if (!oldLines.length && !newLines.length) return [];
  const dp = lcsTable(oldLines, newLines);
  const lcs = backtrackLcs(oldLines, newLines, dp);
  const rows = [];
  let i = 0;
  let j = 0;
  let k = 0;
  while (i < oldLines.length || j < newLines.length) {
    const matched =
      k < lcs.length &&
      i < oldLines.length &&
      j < newLines.length &&
      oldLines[i] === lcs[k] &&
      newLines[j] === lcs[k];
    if (matched) {
      rows.push({ type: 'same', before: oldLines[i], after: newLines[j] });
      i++;
      j++;
      k++;
      continue;
    }
    const oldRemain = i < oldLines.length;
    const newRemain = j < newLines.length;
    if (oldRemain && newRemain) {
      rows.push({ type: 'change', before: oldLines[i], after: newLines[j] });
      i++;
      j++;
    } else if (oldRemain) {
      rows.push({ type: 'remove', before: oldLines[i], after: '' });
      i++;
    } else if (newRemain) {
      rows.push({ type: 'add', before: '', after: newLines[j] });
      j++;
    }
  }
  return rows.filter((row) => {
    if (row.type === 'same') return !isEmptyLine(row.after);
    if (row.type === 'remove') return !isEmptyLine(row.before);
    if (row.type === 'add') return !isEmptyLine(row.after);
    if (row.type === 'change') {
      return !isEmptyLine(row.before) || !isEmptyLine(row.after);
    }
    return true;
  });
}

function hasDiff(before, after) {
  return String(before || '') !== String(after || '');
}

module.exports = {
  buildLineDiff,
  hasDiff
};
