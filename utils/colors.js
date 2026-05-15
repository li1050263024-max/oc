/**
 * 发色、瞳色文字 → 实际颜色（用于像素小人展示）
 * 与 data/pools.js 中的选项对应，未列出的使用 default
 */
const hairColorMap = {
  '黑色': '#2c2c2c',
  '棕色': '#5d4037',
  '金色': '#ffc107',
  '银白': '#e0e0e0',
  '红色': '#c62828',
  '蓝色': '#1565c0',
  '绿色': '#2e7d32',
  '紫色': '#6a1b9a',
  '粉色': '#ec407a',
  '薄荷绿': '#80cbc4',
  '渐变粉': '#f8bbd0',
  '挑染蓝': '#64b5f6',
  '亚麻色': '#d7ccc8',
  '深灰': '#616161',
  '雪白': '#fafafa',
  '樱粉': '#f48fb1'
};

const eyeColorMap = {
  '黑色': '#1b1b1b',
  '棕色': '#4e342e',
  '琥珀色': '#ff8f00',
  '异瞳': '#7b1fa2',
  '深红': '#b71c1c',
  '冰蓝': '#4fc3f7',
  '翠绿': '#2e7d32',
  '金色': '#ffb300',
  '紫色': '#4a148c',
  '银灰': '#9e9e9e',
  '赤金': '#e65100',
  '湛蓝': '#0d47a1',
  '墨绿': '#1b5e20',
  '绯红': '#c62828',
  '浅金': '#ffd54f',
  '深紫': '#311b92'
};

function getHairColor(name) {
  return hairColorMap[name] || '#4a4a4a';
}

function getEyeColor(name) {
  return eyeColorMap[name] || '#37474f';
}

module.exports = {
  getHairColor,
  getEyeColor
};
