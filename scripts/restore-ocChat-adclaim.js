const fs = require('fs');
const path = require('path');
const vm = require('vm');

const file = path.join(__dirname, '../pages/ocChat/ocChat.js');
let s = fs.readFileSync(file, 'utf8');

function rep(label, a, b) {
  if (!s.includes(a)) throw new Error('missing ' + label);
  s = s.replace(a, b);
}

rep(
  'import onQuotaSheetAd',
  `  onQuotaSheetShare,
  onQuotaSheetRedeem,`,
  `  onQuotaSheetShare,
  onQuotaSheetAd,
  onQuotaSheetRedeem,`
);

rep(
  'adClaim data',
  `    quotaOaQrVisible: false,
    diceRolling: false,`,
  `    quotaOaQrVisible: false,
    adClaimSheetVisible: false,
    adClaimDetectedClick: false,
    adClaimMakeupDone: false,
    adClaimMakeupBusy: false,
    adClaimRounds: 30,
    diceRolling: false,`
);

rep(
  'handlers',
  `  onQuotaSheetShareTap() {
    onQuotaSheetShare(this);
  },
  onQuotaSheetRedeemTap() {
    onQuotaSheetRedeem(this);
  },
  onQuotaSheetFollowOaTap() {
    onQuotaSheetFollowOa(this);
  },
  onQuotaSheetCloseOaTap() {
    onQuotaSheetCloseOa(this);
  },
  onQuotaSheetCloseTap() {
    onQuotaSheetClose(this);
  }
});`,
  `  onQuotaSheetShareTap() {
    onQuotaSheetShare(this);
  },
  onQuotaSheetAdTap() {
    onQuotaSheetAd(this);
  },
  onQuotaSheetRedeemTap() {
    onQuotaSheetRedeem(this);
  },
  onQuotaSheetFollowOaTap() {
    onQuotaSheetFollowOa(this);
  },
  onQuotaSheetCloseOaTap() {
    onQuotaSheetCloseOa(this);
  },
  onQuotaSheetCloseTap() {
    onQuotaSheetClose(this);
  },
  onAdClaimMakeup() {
    require('../../utils/adClaimDrawer.js').onAdClaimMakeup(this);
  },
  onAdClaimConfirm() {
    require('../../utils/adClaimDrawer.js').onAdClaimConfirm(this);
  },
  onAdClaimClose() {
    require('../../utils/adClaimDrawer.js').onAdClaimClose(this);
  }
});`
);

new vm.Script(s, { filename: 'ocChat.js' });
fs.writeFileSync(file, s, 'utf8');
console.log('OK');
