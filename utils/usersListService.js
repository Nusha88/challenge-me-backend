// Escapes user input before using it in a $regex to avoid ReDoS / injection.
function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildUserMatchStage(searchQuery) {
  const match = {
    // Legacy docs without status are treated as active.
    status: { $ne: 'disabled' }
  };

  if (searchQuery) {
    match.name = { $regex: escapeRegExp(searchQuery), $options: 'i' };
  }

  return match;
}

const SORT_OPTIONS = {
  xp: { xp: -1, createdAt: -1 },
  missions: { challengeCount: -1, xp: -1, createdAt: -1 },
  newest: { createdAt: -1, xp: -1 }
};

function resolveSortSpec(sortKey) {
  return SORT_OPTIONS[sortKey] || SORT_OPTIONS.xp;
}

function needsChallengeCountForSort(sortKey) {
  return sortKey === 'missions';
}

const USER_LIST_FIELDS = {
  name: 1,
  avatarUrl: 1,
  xp: 1,
  sparks: 1,
  createdAt: 1
};

function challengeCountLookupStage() {
  return {
    $lookup: {
      from: 'challenges',
      let: { userId: '$_id' },
      pipeline: [
        {
          $match: {
            $expr: {
              $or: [
                { $eq: ['$owner', '$$userId'] },
                { $in: ['$$userId', { $ifNull: ['$participants.userId', []] }] }
              ]
            }
          }
        },
        { $count: 'count' }
      ],
      as: 'challengeStats'
    }
  };
}

function challengeCountAddFieldsStage() {
  return {
    $addFields: {
      challengeCount: {
        $ifNull: [{ $arrayElemAt: ['$challengeStats.count', 0] }, 0]
      }
    }
  };
}

function challengeCountProjectStage() {
  return {
    $project: {
      ...USER_LIST_FIELDS,
      challengeCount: 1
    }
  };
}

function buildUsersListPipeline({ searchQuery, skip, limit, sort = 'xp' }) {
  const matchStage = buildUserMatchStage(searchQuery);
  const sortKey = SORT_OPTIONS[sort] ? sort : 'xp';
  const sortSpec = resolveSortSpec(sortKey);
  const countForSort = needsChallengeCountForSort(sortKey);

  const usersPageStages = countForSort
    ? [{ $skip: skip }, { $limit: limit }]
    : [
        { $skip: skip },
        { $limit: limit },
        challengeCountLookupStage(),
        challengeCountAddFieldsStage(),
        challengeCountProjectStage()
      ];

  const beforeFacet = countForSort
    ? [
        { $match: matchStage },
        challengeCountLookupStage(),
        challengeCountAddFieldsStage(),
        challengeCountProjectStage(),
        { $sort: sortSpec }
      ]
    : [
        { $match: matchStage },
        { $project: USER_LIST_FIELDS },
        { $sort: sortSpec }
      ];

  return [
    ...beforeFacet,
    {
      $facet: {
        metadata: [{ $count: 'total' }],
        users: usersPageStages
      }
    }
  ];
}

async function fetchPaginatedUsers(
  UserModel,
  { searchQuery = null, page = 1, limit = 21, sort = 'xp' } = {}
) {
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 21));
  const skip = (safePage - 1) * safeLimit;
  const safeSort = SORT_OPTIONS[sort] ? sort : 'xp';

  const [result] = await UserModel.aggregate(
    buildUsersListPipeline({
      searchQuery,
      skip,
      limit: safeLimit,
      sort: safeSort
    })
  );

  const total = result?.metadata?.[0]?.total || 0;
  const users = result?.users || [];
  const hasMore = skip + users.length < total;

  return {
    users,
    totalUsers: total,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      hasMore
    }
  };
}

module.exports = {
  buildUsersListPipeline,
  fetchPaginatedUsers,
  needsChallengeCountForSort,
  SORT_OPTIONS
};
