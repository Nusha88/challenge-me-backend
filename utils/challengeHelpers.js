/**
 * Считает количество выполненных пунктов (actions и children).
 * @param {Array} actions - Массив действий челленджа
 * @returns {number} Количество выполненных пунктов
 */
function countCompletedActionItems(actions) {
  if (!actions || !Array.isArray(actions)) return 0;
  let count = 0;
  actions.forEach(action => {
    if (action.checked) count++;
    if (action.children && Array.isArray(action.children)) {
      action.children.forEach(child => {
        if (child.checked) count++;
      });
    }
  });
  return count;
}

/**
 * Проверяет, завершен ли result челлендж (все actions и children выполнены).
 * @param {Array} actions - Массив действий челленджа
 * @returns {boolean} true, если всё выполнено
 */
function isResultChallengeCompleted(actions) {
  if (!actions || !Array.isArray(actions) || actions.length === 0) return false;
  return actions.every(action => {
    if (!action.checked) return false;
    if (action.children && Array.isArray(action.children) && action.children.length > 0) {
      return action.children.every(child => child.checked);
    }
    return true;
  });
}

/**
 * Считает XP за новые выполненные пункты.
 * @param {string} challengeId - ID челленджа
 * @param {Array} prevActions - Состояние действий до обновления
 * @param {Array} nextActions - Новое состояние действий
 * @param {Array} awardedActionIds - Список ID пунктов, за которые уже начислен XP
 * @returns {object} { xpGained: number, newlyAwardedIds: string[] }
 */
function calculateResultProgressXp(challengeId, prevActions, nextActions, awardedActionIds) {
  let xpGained = 0;
  const newlyAwardedIds = [];
  const awardedSet = new Set(awardedActionIds || []);

  if (!nextActions || !Array.isArray(nextActions)) return { xpGained, newlyAwardedIds };

  // Helper function to find action status in prevActions
  const findInPrev = (id, children = false, parentId = null) => {
    if (!prevActions || !Array.isArray(prevActions)) return null;
    if (!children) {
      return prevActions.find(a => a._id && a._id.toString() === id.toString());
    } else {
      const parent = prevActions.find(a => a._id && a._id.toString() === parentId.toString());
      if (!parent || !parent.children) return null;
      return parent.children.find(c => c._id && c._id.toString() === id.toString());
    }
  };

  nextActions.forEach(action => {
    const actionKey = `${challengeId}:${action._id}`;
    const prevAction = findInPrev(action._id);
    const wasChecked = prevAction ? !!prevAction.checked : false;

    // Award XP ONLY if transition from false -> true AND not awarded before
    if (action.checked && !wasChecked && !awardedSet.has(actionKey)) {
      xpGained += 10;
      newlyAwardedIds.push(actionKey);
      awardedSet.add(actionKey);
    }

    if (action.children && Array.isArray(action.children)) {
      action.children.forEach(child => {
        const childKey = `${challengeId}:${child._id}`;
        const prevChild = findInPrev(child._id, true, action._id);
        const wasChildChecked = prevChild ? !!prevChild.checked : false;

        if (child.checked && !wasChildChecked && !awardedSet.has(childKey)) {
          xpGained += 10;
          newlyAwardedIds.push(childKey);
          awardedSet.add(childKey);
        }
      });
    }
  });

  return { xpGained, newlyAwardedIds };
}

/**
 * Возвращает бонус XP за полное завершение result челленджа на основе сложности.
 * @param {object} challenge - Объект челленджа
 * @returns {number} XP бонус
 */
function getResultCompletionXp(challenge) {
  if (!challenge) return 0;
  
  const difficultyMap = {
    'easy': 50,
    'medium': 100,
    'hard': 200
  };

  if (typeof challenge.difficulty === 'number') {
    return challenge.difficulty;
  }

  if (typeof challenge.difficulty === 'string') {
    return difficultyMap[challenge.difficulty] || 0;
  }

  return 0;
}

module.exports = {
  countCompletedActionItems,
  isResultChallengeCompleted,
  calculateResultProgressXp,
  getResultCompletionXp
};
