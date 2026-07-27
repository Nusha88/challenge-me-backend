// Escapes user input before using it in a $regex to avoid ReDoS / injection.
function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildUserMatchStage(searchQuery) {
  if (!searchQuery) return {};

  return {
    name: { $regex: escapeRegExp(searchQuery), $options: 'i' }
  };
}

const SORT_OPTIONS = {
  xp: { xp: -1, challengeCount: -1, createdAt: -1 },
  missions: { challengeCount: -1, xp: -1, createdAt: -1 },
  newest: { createdAt: -1, xp: -1 }
};

function resolveSortSpec(sortKey) {
  return SORT_OPTIONS[sortKey] || SORT_OPTIONS.xp;
}

function buildUsersListPipeline({ searchQuery, skip, limit, sort = 'xp' }) {
  const matchStage = buildUserMatchStage(searchQuery);
  const sortSpec = resolveSortSpec(sort);

  return [
    { $match: matchStage },
    {
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
    },
    {
      $addFields: {
        challengeCount: {
          $ifNull: [{ $arrayElemAt: ['$challengeStats.count', 0] }, 0]
        }
      }
    },
    {
      $project: {
        name: 1,
        avatarUrl: 1,
        xp: 1,
        sparks: 1,
        createdAt: 1,
        challengeCount: 1
      }
    },
    { $sort: sortSpec },
    {
      $facet: {
        metadata: [{ $count: 'total' }],
        users: [{ $skip: skip }, { $limit: limit }]
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
  SORT_OPTIONS
};
