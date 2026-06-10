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

/**
 * Returns the most popular active public habit challenge (main ritual), or null.
 * Uses aggregation so only one document is loaded with full population.
 */
async function findMainRitualChallenge(ChallengeModel, { today = new Date() } = {}) {
  const dayStart = new Date(today);
  dayStart.setHours(0, 0, 0, 0);

  const [top] = await ChallengeModel.aggregate([
    {
      $match: {
        challengeType: 'habit',
        privacy: { $ne: 'private' },
        endDate: { $gte: dayStart }
      }
    },
    {
      $addFields: {
        participantCount: { $size: { $ifNull: ['$participants', []] } }
      }
    },
    { $sort: { participantCount: -1, createdAt: -1 } },
    { $limit: 1 },
    { $project: { _id: 1 } }
  ]);

  if (!top?._id) {
    return null;
  }

  return ChallengeModel.findById(top._id)
    .populate('owner', 'name avatarUrl')
    .populate('participants.userId', 'name avatarUrl');
}

const { normalizeDateLikeToYmd } = require('./dateHelpers');

function countScheduledMissionDays(startDate, endDate, frequency = 'daily') {
  const startKey = normalizeDateLikeToYmd(startDate);
  const endKey = normalizeDateLikeToYmd(endDate);
  if (!startKey || !endKey) return 0;

  const start = new Date(`${startKey}T00:00:00Z`);
  const end = new Date(`${endKey}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 0;

  let count = 0;
  const current = new Date(start);
  let dayIndex = 0;

  while (current <= end) {
    const isScheduled = frequency !== 'everyOtherDay' || (dayIndex % 2 === 0);
    if (isScheduled) count += 1;
    current.setUTCDate(current.getUTCDate() + 1);
    dayIndex += 1;
  }

  return count;
}

function isHabitChallengeCompleted(challenge, participant) {
  if (!challenge || !participant) return false;

  const totalScheduled = countScheduledMissionDays(
    challenge.startDate,
    challenge.endDate,
    challenge.frequency
  );
  if (totalScheduled <= 0) return false;

  const completedDayKeys = new Set(
    (participant.completedDays || [])
      .map((day) => normalizeDateLikeToYmd(day))
      .filter(Boolean)
  );

  return completedDayKeys.size >= totalScheduled;
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function isPastEndDate(endDate) {
  if (!endDate) return false;

  try {
    const end = new Date(endDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);
    return end < today;
  } catch {
    return false;
  }
}

function isChallengeFinished(challenge) {
  if (!challenge) return false;

  if (isPastEndDate(challenge.endDate)) {
    return true;
  }

  if (challenge.challengeType === 'result') {
    return isResultChallengeCompleted(challenge.actions);
  }

  return false;
}

function findChallengeParticipant(challenge, userId) {
  if (!challenge || !userId) return null;

  return (challenge.participants || []).find((participant) => {
    const participantId = participant.userId?._id || participant.userId;
    return participantId && participantId.toString() === userId.toString();
  }) || null;
}

function isChallengeSuccessful(challenge, userId) {
  if (!isChallengeFinished(challenge)) {
    return false;
  }

  if (challenge.challengeType === 'result') {
    return isResultChallengeCompleted(challenge.actions);
  }

  if (challenge.challengeType === 'habit') {
    const participant = findChallengeParticipant(challenge, userId);
    if (!participant) return false;
    return isHabitChallengeCompleted(challenge, participant);
  }

  return false;
}

function getInclusiveDaysBetween(startValue, endValue) {
  const startKey = normalizeDateLikeToYmd(startValue);
  const endKey = normalizeDateLikeToYmd(endValue);
  if (!startKey || !endKey) return 0;

  const start = new Date(`${startKey}T00:00:00Z`);
  const end = new Date(`${endKey}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;

  return Math.ceil((end - start) / MS_PER_DAY) + 1;
}

function resetActionsChecked(actions) {
  if (!Array.isArray(actions)) return;

  for (const action of actions) {
    action.checked = false;
    if (Array.isArray(action.children)) {
      for (const child of action.children) {
        child.checked = false;
      }
    }
  }
}

module.exports = {
  countCompletedActionItems,
  isResultChallengeCompleted,
  isHabitChallengeCompleted,
  countScheduledMissionDays,
  collectNewlyCheckedActionIds,
  enrichChallengesWithWatchState,
  findMainRitualChallenge,
  isChallengeFinished,
  isChallengeSuccessful,
  findChallengeParticipant,
  getInclusiveDaysBetween,
  resetActionsChecked
};
