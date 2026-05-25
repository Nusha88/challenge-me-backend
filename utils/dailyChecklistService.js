const DailyChecklist = require('../models/DailyChecklist');
const { findLatestChecklistInRange, serializeChecklistForClientDay, toClientDayKey } = require('./dateHelpers');
const { toLocalDateKey } = require('./dateHelpers');

function normalizeTasks(tasks) {
  if (!Array.isArray(tasks)) return [];

  return tasks.map((task) => {
    const plain = task?.toObject ? task.toObject() : { ...task };
    const normalized = {
      title: plain.title,
      done: !!plain.done
    };

    if (plain.source?.kind) {
      normalized.source = {
        kind: plain.source.kind,
        challengeId: plain.source.challengeId,
        actionId: plain.source.actionId != null ? String(plain.source.actionId) : undefined
      };
    }

    return normalized;
  });
}

function getChecklistProgress(checklist) {
  const tasks = Array.isArray(checklist?.tasks) ? checklist.tasks : [];
  const total = tasks.length;
  const completed = tasks.filter((task) => !!task?.done).length;

  return { total, completed };
}

function hasCompletedChecklistTask(checklist) {
  if (!checklist?.tasks?.length) return false;
  return checklist.tasks.some((task) => task?.done === true);
}

async function findByUserAndLocalDate(userId, localDate) {
  if (!userId || !localDate) return null;
  return DailyChecklist.findOne({ userId, localDate }).lean();
}

async function findByClientDay(userId, clientDayStr, legacyChecklists, startUtc, endUtc) {
  const stored = await findByUserAndLocalDate(userId, clientDayStr);
  if (stored) return stored;

  return findLatestChecklistInRange(legacyChecklists, startUtc, endUtc);
}

async function upsertChecklist({ userId, localDate, timeZone, tasks, anchorDate }) {
  return DailyChecklist.findOneAndUpdate(
    { userId, localDate },
    {
      $set: {
        tasks: normalizeTasks(tasks),
        timeZone: timeZone || 'UTC',
        date: anchorDate,
        updatedAt: new Date()
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

async function findManyByLocalDates(userId, localDates) {
  if (!userId || !Array.isArray(localDates) || localDates.length === 0) {
    return new Map();
  }

  const uniqueDates = [...new Set(localDates.filter(Boolean))];
  const docs = await DailyChecklist.find({
    userId,
    localDate: { $in: uniqueDates }
  }).lean();

  return new Map(docs.map((doc) => [doc.localDate, doc]));
}

async function findForRecapBatch(dueUsers, now) {
  if (!Array.isArray(dueUsers) || dueUsers.length === 0) {
    return new Map();
  }

  const query = {
    $or: dueUsers.map((user) => ({
      userId: user._id,
      localDate: toLocalDateKey(now, user.dailyRecapTimezone || 'UTC')
    }))
  };

  const docs = await DailyChecklist.find(query).select('userId localDate tasks').lean();
  const map = new Map();

  for (const doc of docs) {
    map.set(`${doc.userId}:${doc.localDate}`, doc);
  }

  return map;
}

async function getChecklistHistory(userId, legacyChecklists = [], tzOffsetMin = null) {
  const docs = await DailyChecklist.find({ userId })
    .sort({ localDate: -1 })
    .limit(500)
    .lean();

  const byDay = new Map(docs.map((doc) => [doc.localDate, doc]));

  for (const checklist of legacyChecklists || []) {
    if (!checklist?.date) continue;

    const key = toClientDayKey(checklist.date, tzOffsetMin);
    if (!key || byDay.has(key)) continue;

    byDay.set(key, checklist);
  }

  return Array.from(byDay.entries())
    .map(([clientDay, checklist]) => serializeChecklistForClientDay(checklist, clientDay))
    .sort((a, b) => (a.clientDay < b.clientDay ? 1 : a.clientDay > b.clientDay ? -1 : 0));
}

module.exports = {
  normalizeTasks,
  getChecklistProgress,
  hasCompletedChecklistTask,
  findByUserAndLocalDate,
  findByClientDay,
  upsertChecklist,
  findManyByLocalDates,
  findForRecapBatch,
  getChecklistHistory
};
