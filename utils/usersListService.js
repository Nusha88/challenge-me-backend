function buildUserMatchStage(searchQuery) {
  if (!searchQuery) return {};

  return {
    name: { $regex: searchQuery, $options: 'i' }
  };
}

function buildUsersListPipeline({ searchQuery, skip, limit }) {
  const matchStage = buildUserMatchStage(searchQuery);

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
                $and: [
                  { $ne: ['$privacy', 'private'] },
                  {
                    $or: [
                      { $eq: ['$owner', '$$userId'] },
                      { $in: ['$$userId', { $ifNull: ['$participants.userId', []] }] }
                    ]
                  }
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
    { $sort: { challengeCount: -1, createdAt: -1 } },
    {
      $facet: {
        metadata: [{ $count: 'total' }],
        users: [{ $skip: skip }, { $limit: limit }]
      }
    }
  ];
}

async function fetchPaginatedUsers(UserModel, { searchQuery = null, page = 1, limit = 21 } = {}) {
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 21));
  const skip = (safePage - 1) * safeLimit;

  const [result] = await UserModel.aggregate(buildUsersListPipeline({ searchQuery, skip, limit: safeLimit }));

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
  fetchPaginatedUsers
};
