const User = require('../models/User');
const {
  XP_AMOUNTS,
  XP_EVENT_TYPES,
  getResultCompletionXp,
  buildHabitDayXpKey,
  buildHabitCompletionXpKey,
  buildResultActionXpKey,
  buildResultCompletionXpKey,
  buildDailyFullCompletionXpKey,
  buildChecklistTaskXpKey,
  buildStreakMilestoneXpKey,
  getStreakMilestoneXp
} = require('../constants/xpRules');

async function awardXpOnce(userId, eventKey, amount, meta = {}) {
  if (!userId || !eventKey || !amount || amount <= 0) {
    return {
      awarded: false,
      xpGained: 0,
      reason: 'invalid_input'
    };
  }

  const updatedUser = await User.findOneAndUpdate(
    {
      _id: userId,
      awardedXpEventKeys: { $ne: eventKey }
    },
    {
      $inc: { xp: amount },
      $addToSet: { awardedXpEventKeys: eventKey }
    },
    {
      new: true
    }
  );

  if (!updatedUser) {
    return {
      awarded: false,
      xpGained: 0,
      reason: 'already_awarded'
    };
  }

  return {
    awarded: true,
    xpGained: amount,
    eventKey,
    user: updatedUser,
    meta
  };
}

async function awardHabitDayXp(userId, challengeId, localDate) {
  return awardXpOnce(
    userId,
    buildHabitDayXpKey(challengeId, localDate),
    XP_AMOUNTS.HABIT_DAY,
    {
      type: XP_EVENT_TYPES.HABIT_DAY,
      challengeId,
      localDate
    }
  );
}

async function awardHabitCompletionXp(userId, challengeId) {
  return awardXpOnce(
    userId,
    buildHabitCompletionXpKey(challengeId),
    XP_AMOUNTS.HABIT_COMPLETION,
    {
      type: XP_EVENT_TYPES.HABIT_COMPLETION,
      challengeId
    }
  );
}

async function awardResultActionXp(userId, challengeId, actionId) {
  return awardXpOnce(
    userId,
    buildResultActionXpKey(challengeId, actionId),
    XP_AMOUNTS.RESULT_ACTION,
    {
      type: XP_EVENT_TYPES.RESULT_ACTION,
      challengeId,
      actionId
    }
  );
}

async function awardResultCompletionXp(userId, challenge) {
  const xp = getResultCompletionXp(challenge);

  return awardXpOnce(
    userId,
    buildResultCompletionXpKey(challenge._id),
    xp,
    {
      type: XP_EVENT_TYPES.RESULT_COMPLETION,
      challengeId: challenge._id,
      difficulty: challenge.difficulty
    }
  );
}

async function awardDailyFullCompletionXp(userId, localDate) {
  return awardXpOnce(
    userId,
    buildDailyFullCompletionXpKey(localDate),
    XP_AMOUNTS.DAILY_FULL_COMPLETION,
    {
      type: XP_EVENT_TYPES.DAILY_FULL_COMPLETION,
      localDate
    }
  );
}

async function awardChecklistTaskXp(userId, localDate, taskIndex) {
  return awardXpOnce(
    userId,
    buildChecklistTaskXpKey(localDate, taskIndex),
    XP_AMOUNTS.CHECKLIST_TASK,
    {
      type: XP_EVENT_TYPES.CHECKLIST_TASK,
      localDate,
      taskIndex
    }
  );
}

async function awardStreakMilestoneXp(userId, milestone) {
  const amount = getStreakMilestoneXp(milestone);
  if (!amount) {
    return {
      awarded: false,
      xpGained: 0,
      reason: 'invalid_input'
    };
  }

  return awardXpOnce(
    userId,
    buildStreakMilestoneXpKey(milestone),
    amount,
    {
      type: XP_EVENT_TYPES.STREAK_MILESTONE,
      milestone
    }
  );
}

module.exports = {
  awardXpOnce,
  awardHabitDayXp,
  awardHabitCompletionXp,
  awardResultActionXp,
  awardResultCompletionXp,
  awardDailyFullCompletionXp,
  awardChecklistTaskXp,
  awardStreakMilestoneXp,
  getResultCompletionXp
};
