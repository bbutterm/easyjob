'use strict';
// Session consent is not microphone permission. A fresh UI action arms one short window.
function create(isControl) {
  let until = 0, networkUntil = 0;
  const network = permission => ['loopback-network', 'local-network-access'].includes(permission);
  return {
    arm(sender, consent) { if (!isControl(sender) || consent !== true) return false; until = Date.now() + 35000; networkUntil = Date.now() + 120000; return true; },
    revoke() { until = 0; networkUntil = 0; },
    check(sender, permission, details = {}) {
      if (details.isMainFrame === false) return false;
      if (network(permission)) return isControl(sender) && Date.now() < networkUntil;
      return isControl(sender) && Date.now() < until && permission === 'media' && details.mediaType === 'audio';
    },
    request(sender, permission, details = {}) {
      if (details.isMainFrame === false) return false;
      if (network(permission)) return isControl(sender) && Date.now() < networkUntil;
      return isControl(sender) && Date.now() < until && permission === 'media'
        && Array.isArray(details.mediaTypes) && details.mediaTypes.length === 1 && details.mediaTypes[0] === 'audio';
    }
  };
}
module.exports = { create };
