const { isChallengeFinished } = require('./challengeHelpers');

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function startOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function resolveMissionStatus(challenge, today = startOfToday()) {
  if (!challenge?.startDate || !challenge?.endDate) {
    return 'archived';
  }

  const startDate = new Date(challenge.startDate);
  startDate.setHours(0, 0, 0, 0);

  if (startDate > today) {
    return 'upcoming';
  }

  if (isChallengeFinished(challenge)) {
    return 'archived';
  }

  return 'active';
}

function buildAdminMissionsMatchStage(searchQuery) {
  if (!searchQuery) return {};

  return {
    title: { $regex: escapeRegExp(searchQuery), $options: 'i' }
  };
}

function buildAdminMissionsPipeline({ searchQuery, skip, limit }) {
  const matchStage = buildAdminMissionsMatchStage(searchQuery);

  return [
    { $match: matchStage },
    {
      $lookup: {
        from: 'users',
        localField: 'owner',
        foreignField: '_id',
        as: 'ownerDoc'
      }
    },
    {
      $addFields: {
        participantsCount: { $size: { $ifNull: ['$participants', []] } },
        visibility: { $ifNull: ['$visibility', true] },
        ownerName: {
          $ifNull: [{ $arrayElemAt: ['$ownerDoc.name', 0] }, '']
        }
      }
    },
    {
      $project: {
        title: 1,
        challengeType: 1,
        privacy: 1,
        participantsCount: 1,
        ownerName: 1,
        visibility: 1,
        startDate: 1,
        endDate: 1,
        resultMissionEndedAt: 1,
        createdAt: 1,
        updatedAt: 1
      }
    },
    { $sort: { createdAt: -1, title: 1 } },
    {
      $facet: {
        metadata: [{ $count: 'total' }],
        missions: [{ $skip: skip }, { $limit: limit }]
      }
    }
  ];
}

function mapAdminMissionRow(mission, today = startOfToday()) {
  const lastActivitySource = mission.updatedAt || mission.createdAt || null;
  return {
    id: String(mission._id),
    title: mission.title,
    challengeType: mission.challengeType === 'result' ? 'result' : 'habit',
    privacy: mission.privacy === 'private' ? 'private' : 'public',
    participantsCount: Number(mission.participantsCount || 0),
    ownerName: mission.ownerName || '',
    visibility: mission.visibility !== false,
    status: resolveMissionStatus(mission, today),
    lastActivityAt: lastActivitySource ? new Date(lastActivitySource).toISOString() : null
  };
}

async function fetchAdminMissions(
  ChallengeModel,
  { searchQuery = null, page = 1, limit = 50 } = {}
) {
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safeLimit = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
  const skip = (safePage - 1) * safeLimit;
  const today = startOfToday();

  const [result] = await ChallengeModel.aggregate(
    buildAdminMissionsPipeline({
      searchQuery,
      skip,
      limit: safeLimit
    })
  );

  const total = result?.metadata?.[0]?.total || 0;
  const missions = (result?.missions || []).map((mission) => mapAdminMissionRow(mission, today));
  const hasMore = skip + missions.length < total;

  return {
    missions,
    totalMissions: total,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      hasMore
    }
  };
}

module.exports = {
  fetchAdminMissions,
  resolveMissionStatus,
  mapAdminMissionRow
};
