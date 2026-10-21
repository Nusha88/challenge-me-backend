const { SYSTEM_TEMPLATE_IDS, isSystemTemplateId } = require('../constants/systemTemplates');
const { normalizeDateLikeToYmd } = require('./dateHelpers');

/**
 * ISO week number. Must match frontend `src/utils/weeklyRitualSchedule.js`.
 */
function getIsoWeekNumber(date = new Date()) {
  const dayKey = normalizeDateLikeToYmd(date) || normalizeDateLikeToYmd(new Date());
  const [year, month, day] = dayKey.split('-').map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  const dayNum = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  return Math.ceil(((utc - yearStart) / 86400000 + 1) / 7);
}

function getWeeklyRitualIdForDate(date = new Date()) {
  if (!SYSTEM_TEMPLATE_IDS.length) return null;
  return SYSTEM_TEMPLATE_IDS[getIsoWeekNumber(date) % SYSTEM_TEMPLATE_IDS.length];
}

function isWeeklyRitualTemplate(templateId, date = new Date()) {
  const id = String(templateId || '').trim();
  return Boolean(id) && id === getWeeklyRitualIdForDate(date);
}

function isWeeklyRitualChallenge(challenge) {
  if (!challenge) return false;
  if (challenge.isWeeklyRitual === true) return true;

  const templateId = String(challenge.templateId || '').trim();
  if (!isSystemTemplateId(templateId)) return false;

  return isWeeklyRitualTemplate(
    templateId,
    challenge.startDate || challenge.createdAt || new Date()
  );
}

module.exports = {
  getIsoWeekNumber,
  getWeeklyRitualIdForDate,
  isWeeklyRitualTemplate,
  isWeeklyRitualChallenge
};
