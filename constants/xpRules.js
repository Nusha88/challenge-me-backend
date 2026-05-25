const XP_EVENT_TYPES = Object.freeze({
  HABIT_DAY: 'habit_day',
  HABIT_COMPLETION: 'habit_completion',
  RESULT_ACTION: 'result_action',
  RESULT_COMPLETION: 'result_completion',
  FIRST_COMMENT: 'first_comment',
  DAILY_FULL_COMPLETION: 'daily_full_completion',
  CHECKLIST_TASK: 'checklist_task',
  STREAK_MILESTONE: 'streak_milestone'
});

const XP_AMOUNTS = Object.freeze({
  HABIT_DAY: 5,
  HABIT_COMPLETION: 100,
  RESULT_ACTION: 10,
  FIRST_COMMENT: 5,
  CHECKLIST_TASK: 5,
  DAILY_FULL_COMPLETION: 50,
  RESULT_COMPLETION_BY_DIFFICULTY: Object.freeze({
    easy: 50,
    medium: 100,
    heroic: 200
  }),
  STREAK_MILESTONE_BY_DAY: Object.freeze({
    7: 50
  })
});

const XP_EVENT_KEY_PREFIXES = Object.freeze({
  HABIT_DAY: 'habit-day',
  HABIT_COMPLETION: 'habit-complete',
  RESULT_ACTION: 'result-action',
  RESULT_COMPLETION: 'result-complete',
  FIRST_COMMENT: 'comment',
  DAILY_FULL_COMPLETION: 'daily-full',
  CHECKLIST_TASK: 'checklist-task',
  STREAK_MILESTONE: 'streak'
});

function getResultCompletionXp(challenge) {
  return XP_AMOUNTS.RESULT_COMPLETION_BY_DIFFICULTY[challenge?.difficulty] || 0;
}

function buildHabitDayXpKey(challengeId, localDate) {
  return `${XP_EVENT_KEY_PREFIXES.HABIT_DAY}:${challengeId}:${localDate}`;
}

function buildHabitCompletionXpKey(challengeId) {
  return `${XP_EVENT_KEY_PREFIXES.HABIT_COMPLETION}:${challengeId}`;
}

function buildResultActionXpKey(challengeId, actionId) {
  return `${XP_EVENT_KEY_PREFIXES.RESULT_ACTION}:${challengeId}:${actionId}`;
}

function buildResultCompletionXpKey(challengeId) {
  return `${XP_EVENT_KEY_PREFIXES.RESULT_COMPLETION}:${challengeId}`;
}

function buildFirstCommentXpKey(challengeId) {
  return `${XP_EVENT_KEY_PREFIXES.FIRST_COMMENT}:${challengeId}`;
}

function buildDailyFullCompletionXpKey(localDate) {
  return `${XP_EVENT_KEY_PREFIXES.DAILY_FULL_COMPLETION}:${localDate}`;
}

function buildChecklistTaskXpKey(localDate, taskIndex) {
  return `${XP_EVENT_KEY_PREFIXES.CHECKLIST_TASK}:${localDate}:${taskIndex}`;
}

function getStreakMilestoneXp(milestone) {
  return XP_AMOUNTS.STREAK_MILESTONE_BY_DAY[milestone] || 0;
}

function buildStreakMilestoneXpKey(milestone) {
  return `${XP_EVENT_KEY_PREFIXES.STREAK_MILESTONE}:${milestone}`;
}

module.exports = {
  XP_EVENT_TYPES,
  XP_AMOUNTS,
  XP_EVENT_KEY_PREFIXES,
  getResultCompletionXp,
  buildHabitDayXpKey,
  buildHabitCompletionXpKey,
  buildResultActionXpKey,
  buildResultCompletionXpKey,
  buildFirstCommentXpKey,
  buildDailyFullCompletionXpKey,
  buildChecklistTaskXpKey,
  buildStreakMilestoneXpKey,
  getStreakMilestoneXp
};
