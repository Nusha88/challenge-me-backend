function parseAdminPage({ page = 1, limit = 50 } = {}) {
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safeLimit = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
  const skip = (safePage - 1) * safeLimit;
  return { safePage, safeLimit, skip };
}

function startOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function idString(value) {
  if (value == null) return '';
  if (typeof value === 'object') return String(value._id || value.id || '');
  return String(value);
}

module.exports = {
  parseAdminPage,
  startOfToday,
  escapeRegExp,
  idString
};
