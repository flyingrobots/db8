export function isValidJournalEventPayload(roomId, obj) {
  if (!obj || typeof obj !== 'object') return false;
  if (obj.t !== 'journal') return false;
  if (String(obj.room_id) !== String(roomId)) return false;
  if (!Number.isInteger(obj.idx) || obj.idx < 0) return false;
  if (typeof obj.hash !== 'string' || !/^[0-9a-f]{64}$/.test(obj.hash)) return false;
  return true;
}

const LS_PREFIX = 'db8.lastSeenJournalIdx:';

export function getLastSeenJournalIdx(roomId) {
  try {
    const v = window.sessionStorage.getItem(LS_PREFIX + roomId);
    const n = Number(v);
    return Number.isInteger(n) && n >= 0 ? n : -1;
  } catch {
    return -1;
  }
}

export function setLastSeenJournalIdx(roomId, idx) {
  try {
    if (Number.isInteger(idx) && idx >= 0) {
      window.sessionStorage.setItem(LS_PREFIX + roomId, String(idx));
    }
  } catch {
    /* ignore */
  }
}
