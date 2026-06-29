const { XP_AMOUNTS, getResultCompletionXp } = require('../constants/xpRules');
const { SPARKS_AMOUNTS } = require('../constants/sparksRules');

function countResultActionNodes(actions) {
  let count = 0;

  function walk(items) {
    for (const action of items || []) {
      count += 1;
      if (Array.isArray(action.children) && action.children.length) {
        walk(action.children);
      }
    }
  }

  walk(actions);
  return count;
}

function buildMissionRewardSummary(challenge) {
  const actionCount = countResultActionNodes(challenge?.actions);
  const completionXp = getResultCompletionXp(challenge);
  const actionXp = actionCount * XP_AMOUNTS.RESULT_ACTION;
  const totalXp = actionXp + completionXp;
  const sparksPerAction =
    SPARKS_AMOUNTS.TASK_COMPLETION + SPARKS_AMOUNTS.QUEST_ACTION_CHECK;
  const totalSparks =
    actionCount * sparksPerAction + SPARKS_AMOUNTS.MISSION_COMPLETION;

  return {
    actionCount,
    actionXp,
    completionXp,
    totalXp,
    totalSparks
  };
}

module.exports = {
  buildMissionRewardSummary,
  countResultActionNodes
};
