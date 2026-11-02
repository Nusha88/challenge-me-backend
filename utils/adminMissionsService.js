const { isChallengeFinished } = require('./challengeHelpers');
const { CAMPAIGN_ROLES } = require('./campaignHelpers');
const { parseAdminPage, startOfToday, escapeRegExp, idString } = require('./adminPage');

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

function startOfTomorrow(today = startOfToday()) {
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow;
}

function buildAdminMissionsMatchStage({
  searchQuery,
  challengeType,
  privacy,
  status,
  today = startOfToday()
} = {}) {
  const match = {
    campaignRole: { $ne: CAMPAIGN_ROLES.PERSONAL_TEMPLATE }
  };

  if (searchQuery) {
    match.title = { $regex: escapeRegExp(searchQuery), $options: 'i' };
  }

  if (challengeType === 'result' || challengeType === 'habit') {
    match.challengeType = challengeType;
  }

  if (privacy === 'private') {
    match.privacy = 'private';
  } else if (privacy === 'public') {
    match.privacy = { $ne: 'private' };
  }

  if (status === 'upcoming') {
    match.startDate = { $gte: startOfTomorrow(today) };
    match.endDate = { $ne: null };
  } else if (status === 'active') {
    match.startDate = { $ne: null, $lt: startOfTomorrow(today) };
    match.endDate = { $ne: null, $gte: today };
    match.$nor = [
      { challengeType: 'result', resultMissionEndedAt: { $ne: null } }
    ];
  } else if (status === 'archived') {
    match.$or = [
      { startDate: null },
      { endDate: null },
      { endDate: { $lt: today } },
      { challengeType: 'result', resultMissionEndedAt: { $ne: null } }
    ];
  }

  return match;
}

function buildAdminMissionsPipeline({
  searchQuery,
  challengeType,
  privacy,
  status,
  skip,
  limit,
  today
}) {
  const matchStage = buildAdminMissionsMatchStage({
    searchQuery,
    challengeType,
    privacy,
    status,
    today
  });

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
        },
        ownerId: {
          $ifNull: [{ $arrayElemAt: ['$ownerDoc._id', 0] }, '$owner']
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
        ownerId: 1,
        visibility: 1,
        campaignRole: 1,
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
  const campaignRole = [
    CAMPAIGN_ROLES.SHARED,
    CAMPAIGN_ROLES.PERSONAL_CLONE
  ].includes(mission.campaignRole)
    ? mission.campaignRole
    : null;

  return {
    id: String(mission._id),
    title: mission.title,
    challengeType: mission.challengeType === 'result' ? 'result' : 'habit',
    privacy: mission.privacy === 'private' ? 'private' : 'public',
    participantsCount: Number(mission.participantsCount || 0),
    ownerName: mission.ownerName || '',
    ownerId: idString(mission.ownerId),
    visibility: mission.visibility !== false,
    campaignRole,
    status: resolveMissionStatus(mission, today),
    lastActivityAt: lastActivitySource ? new Date(lastActivitySource).toISOString() : null
  };
}

async function fetchAdminMissions(
  ChallengeModel,
  {
    searchQuery = null,
    challengeType = null,
    privacy = null,
    status = null,
    page = 1,
    limit = 50
  } = {}
) {
  const { safePage, safeLimit, skip } = parseAdminPage({ page, limit });
  const today = startOfToday();

  const [result] = await ChallengeModel.aggregate(
    buildAdminMissionsPipeline({
      searchQuery,
      challengeType,
      privacy,
      status,
      skip,
      limit: safeLimit,
      today
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
  mapAdminMissionRow,
  buildAdminMissionsMatchStage
};
