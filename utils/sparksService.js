const User = require('../models/User');
const {
  SPARKS_AMOUNTS,
  SPARKS_EVENT_TYPES,
  DAILY_SPARKS_CAP,
  buildChecklistTaskSparksKey,
  buildChecklistTaskAwardKey,
  buildResultActionChecklistTaskKey,
  buildHabitDaySparksKey,
  buildManifestSparksKey,
  buildStreakMilestoneSparksKey,
  buildMissionCompletionSparksKey,
  getStreakMilestoneSparks
} = require('../constants/sparksRules');

function getDailyCapState(user, localDate) {
  const cap = user?.sparksDailyCap || {};
  if (cap.clientDay === localDate) {
    return Number(cap.amount || 0);
  }
  return 0;
}

async function awardSparksOnce(userId, eventKey, amount, meta = {}) {
  if (!userId || !eventKey || !amount || amount <= 0) {
    return {
      awarded: false,
      sparksGained: 0,
      reason: 'invalid_input'
    };
  }

  const updatedUser = await User.findOneAndUpdate(
    {
      _id: userId,
      awardedSparksEventKeys: { $ne: eventKey }
    },
    {
      $inc: { sparks: amount },
      $addToSet: { awardedSparksEventKeys: eventKey }
    },
    { new: true }
  );

  if (!updatedUser) {
    return {
      awarded: false,
      sparksGained: 0,
      reason: 'already_awarded'
    };
  }

  return {
    awarded: true,
    sparksGained: amount,
    eventKey,
    user: updatedUser,
    meta
  };
}

async function awardCappedSparksOnce(userId, eventKey, amount, localDate, meta = {}) {
  if (!userId || !eventKey || !amount || amount <= 0 || !localDate) {
    return {
      awarded: false,
      sparksGained: 0,
      reason: 'invalid_input'
    };
  }

  const user = await User.findById(userId);
  if (!user) {
    return {
      awarded: false,
      sparksGained: 0,
      reason: 'user_not_found'
    };
  }

  if ((user.awardedSparksEventKeys || []).includes(eventKey)) {
    return {
      awarded: false,
      sparksGained: 0,
      reason: 'already_awarded'
    };
  }

  const dailyAmount = getDailyCapState(user, localDate);
  if (dailyAmount >= DAILY_SPARKS_CAP) {
    return {
      awarded: false,
      sparksGained: 0,
      reason: 'daily_cap_reached'
    };
  }

  const sparksToAward = Math.min(amount, DAILY_SPARKS_CAP - dailyAmount);
  if (sparksToAward <= 0) {
    return {
      awarded: false,
      sparksGained: 0,
      reason: 'daily_cap_reached'
    };
  }

  const updatedUser = await User.findOneAndUpdate(
    {
      _id: userId,
      awardedSparksEventKeys: { $ne: eventKey }
    },
    {
      $inc: { sparks: sparksToAward },
      $addToSet: { awardedSparksEventKeys: eventKey },
      $set: {
        'sparksDailyCap.clientDay': localDate,
        'sparksDailyCap.amount': dailyAmount + sparksToAward
      }
    },
    { new: true }
  );

  if (!updatedUser) {
    return {
      awarded: false,
      sparksGained: 0,
      reason: 'already_awarded'
    };
  }

  return {
    awarded: true,
    sparksGained: sparksToAward,
    eventKey,
    user: updatedUser,
    meta
  };
}

async function awardChecklistTaskSparks(userId, localDate, taskKey) {
  return awardCappedSparksOnce(
    userId,
    buildChecklistTaskSparksKey(localDate, taskKey),
    SPARKS_AMOUNTS.TASK_COMPLETION,
    localDate,
    { type: SPARKS_EVENT_TYPES.CHECKLIST_TASK, localDate, taskKey }
  );
}

async function awardHabitDaySparks(userId, challengeId, localDate) {
  return awardCappedSparksOnce(
    userId,
    buildHabitDaySparksKey(challengeId, localDate),
    SPARKS_AMOUNTS.TASK_COMPLETION,
    localDate,
    { type: SPARKS_EVENT_TYPES.HABIT_DAY, challengeId, localDate }
  );
}

async function awardManifestSparks(userId, { type, localDate, challengeId = null }) {
  return awardCappedSparksOnce(
    userId,
    buildManifestSparksKey(type, localDate, challengeId),
    SPARKS_AMOUNTS.MANIFEST,
    localDate,
    { type: SPARKS_EVENT_TYPES.MANIFEST, manifestType: type, localDate, challengeId }
  );
}

async function awardStreakMilestoneSparks(userId, milestone, localDate) {
  const amount = getStreakMilestoneSparks(milestone);
  if (!amount) {
    return {
      awarded: false,
      sparksGained: 0,
      reason: 'invalid_input'
    };
  }

  return awardSparksOnce(
    userId,
    buildStreakMilestoneSparksKey(milestone, localDate),
    amount,
    { type: SPARKS_EVENT_TYPES.STREAK_MILESTONE, milestone, localDate }
  );
}

async function awardMissionCompletionSparks(userId, challengeId) {
  return awardSparksOnce(
    userId,
    buildMissionCompletionSparksKey(challengeId),
    SPARKS_AMOUNTS.MISSION_COMPLETION,
    { type: SPARKS_EVENT_TYPES.MISSION_COMPLETION, challengeId }
  );
}

module.exports = {
  awardSparksOnce,
  awardCappedSparksOnce,
  awardChecklistTaskSparks,
  awardHabitDaySparks,
  awardManifestSparks,
  awardStreakMilestoneSparks,
  awardMissionCompletionSparks,
  DAILY_SPARKS_CAP
};
