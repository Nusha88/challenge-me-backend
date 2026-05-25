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

function collectNewlyCheckedActionIds(prevActions = [], nextActions = []) {
  const prevCheckedById = new Map();

  function walkPrev(actions) {
    for (const action of actions || []) {
      if (action?._id) {
        prevCheckedById.set(String(action._id), !!action.checked);
      }

      if (Array.isArray(action.children)) {
        walkPrev(action.children);
      }
    }
  }

  const newlyCheckedIds = [];

  function walkNext(actions) {
    for (const action of actions || []) {
      if (action?._id) {
        const id = String(action._id);
        const wasChecked = prevCheckedById.get(id) === true;
        const isChecked = action.checked === true;

        if (!wasChecked && isChecked) {
          newlyCheckedIds.push(id);
        }
      }

      if (Array.isArray(action.children)) {
        walkNext(action.children);
      }
    }
  }

  walkPrev(prevActions);
  walkNext(nextActions);

  return newlyCheckedIds;
}

/**
 * Adds watchersCount and isWatched (for the viewing user) to each challenge.
 * @param {Array} challenges - Mongoose docs or plain objects
 * @param {string|null} viewerUserId - Authenticated user id, if any
 * @param {import('mongoose').Model} UserModel
 */
async function enrichChallengesWithWatchState(challenges, viewerUserId, UserModel) {
  let watchedIdSet = null

  if (viewerUserId) {
    const viewer = await UserModel.findById(viewerUserId).select('watchedChallenges').lean()
    watchedIdSet = new Set((viewer?.watchedChallenges || []).map((id) => String(id)))
  }

  return Promise.all(
    challenges.map(async (challenge) => {
      const challengeObj =
        typeof challenge.toObject === 'function' ? challenge.toObject() : { ...challenge }
      const challengeId = challengeObj._id

      challengeObj.watchersCount = await UserModel.countDocuments({
        watchedChallenges: challengeId
      })
      challengeObj.isWatched = watchedIdSet
        ? watchedIdSet.has(String(challengeId))
        : false

      return challengeObj
    })
  )
}

module.exports = {
  countCompletedActionItems,
  isResultChallengeCompleted,
  collectNewlyCheckedActionIds,
  enrichChallengesWithWatchState
};
