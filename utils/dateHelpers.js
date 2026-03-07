/**
 * Converts a UTC date to the client's local day string 'YYYY-MM-DD'.
 * @param {Date|string|number} date - The UTC date to convert
 * @param {number|null} tzOffsetMin - Client's timezone offset in minutes (Date.getTimezoneOffset())
 * @returns {string|null} 'YYYY-MM-DD' or null if invalid
 */
function toClientDayKey(date, tzOffsetMin) {
  const ms = new Date(date).getTime();
  if (!Number.isFinite(ms)) return null;
  // Formula: localMs = ms - tzOffsetMin * 60 * 1000
  const localMs = tzOffsetMin === null ? ms : (ms - tzOffsetMin * 60 * 1000);
  const d = new Date(localMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Helper to calculate UTC start/end for a client-local day window.
 * @param {Object} reqOrHeaders - The request object or headers object
 * @param {number} dayOffset - Relative offset from the client's current day (0=today, 1=tomorrow, -1=yesterday)
 * @returns {Object} { startUtc, endUtc, clientDayStr }
 */
function getClientDayRange(reqOrHeaders, dayOffset = 0) {
  const headers = reqOrHeaders.headers || reqOrHeaders;
  const rawDay = headers['x-client-day'];
  const rawOffset = headers['x-client-tz-offset'];
  const tzOffsetMin = Number.isFinite(Number(rawOffset)) ? Number(rawOffset) : null;
  const dayStr = typeof rawDay === 'string' ? rawDay : null;

  // Fallback: UTC day if headers are missing/invalid
  if (!dayStr || !/^\d{4}-\d{2}-\d{2}$/.test(dayStr) || tzOffsetMin === null) {
    const startUtc = new Date();
    startUtc.setUTCHours(0, 0, 0, 0);
    startUtc.setUTCMilliseconds(0);
    startUtc.setUTCDate(startUtc.getUTCDate() + dayOffset);
    const endUtc = new Date(startUtc);
    endUtc.setUTCDate(endUtc.getUTCDate() + 1);
    return { startUtc, endUtc, clientDayStr: startUtc.toISOString().slice(0, 10) };
  }

  const [y, m, d] = dayStr.split('-').map(Number);
  const baseStartMs = Date.UTC(y, m - 1, d, 0, 0, 0, 0) + tzOffsetMin * 60 * 1000;
  const offsetMs = dayOffset * 24 * 60 * 60 * 1000;
  const startMs = baseStartMs + offsetMs;
  const startUtc = new Date(startMs);
  const endUtc = new Date(startMs + 24 * 60 * 60 * 1000);
  
  const clientDayStr = toClientDayKey(startUtc, tzOffsetMin);
  
  return { startUtc, endUtc, clientDayStr };
}

/**
 * Finds the latest checklist within a given UTC range.
 * @param {Array} checklists - The array of checklist objects
 * @param {Date} startUtc - Start of the range (inclusive)
 * @param {Date} endUtc - End of the range (exclusive)
 * @returns {Object|null} The latest checklist object or null if none found
 */
function findLatestChecklistInRange(checklists = [], startUtc, endUtc) {
  if (!Array.isArray(checklists)) return null;
  const startMs = startUtc.getTime();
  const endMs = endUtc.getTime();

  const filtered = checklists.filter(c => {
    if (!c.date) return false;
    const t = new Date(c.date).getTime();
    return t >= startMs && t < endMs;
  });

  if (filtered.length === 0) return null;

  // Sort by date descending to get the latest one
  return filtered.sort((a, b) => new Date(b.date) - new Date(a.date))[0];
}

/**
 * Prepares a checklist for the client by mapping its date to the client's local day.
 * @param {Object} checklist - The raw checklist object from Mongo
 * @param {string} clientDayStr - The 'YYYY-MM-DD' string for the client's day
 * @returns {Object} Serialized checklist
 */
function serializeChecklistForClientDay(checklist, clientDayStr) {
  if (!checklist) return null;
  const obj = checklist.toObject?.() || checklist;
  return {
    ...obj,
    date: clientDayStr,
    clientDay: clientDayStr
  };
}

module.exports = {
  toClientDayKey,
  getClientDayRange,
  findLatestChecklistInRange,
  serializeChecklistForClientDay
};
