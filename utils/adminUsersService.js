const { getLevelFromXp } = require('./levelSystem');

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildAdminUserMatchStage(searchQuery) {
  if (!searchQuery) return {};

  const escaped = escapeRegExp(searchQuery);
  return {
    $or: [
      { name: { $regex: escaped, $options: 'i' } },
      { email: { $regex: escaped, $options: 'i' } }
    ]
  };
}

function startOfTodayUtc() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function buildAdminUsersListPipeline({ searchQuery, skip, limit, today }) {
  const matchStage = buildAdminUserMatchStage(searchQuery);

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
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              active: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $ne: ['$startDate', null] },
                        { $ne: ['$endDate', null] },
                        { $lte: ['$startDate', today] },
                        { $gte: ['$endDate', today] }
                      ]
                    },
                    1,
                    0
                  ]
                }
              }
            }
          }
        ],
        as: 'missionStats'
      }
    },
    {
      $addFields: {
        missionsTotal: {
          $ifNull: [{ $arrayElemAt: ['$missionStats.total', 0] }, 0]
        },
        missionsActive: {
          $ifNull: [{ $arrayElemAt: ['$missionStats.active', 0] }, 0]
        },
        status: { $ifNull: ['$status', 'active'] },
        xp: { $ifNull: ['$xp', 0] },
        sparks: { $ifNull: ['$sparks', 0] }
      }
    },
    {
      $project: {
        name: 1,
        email: 1,
        xp: 1,
        sparks: 1,
        status: 1,
        missionsTotal: 1,
        missionsActive: 1,
        createdAt: 1
      }
    },
    { $sort: { createdAt: -1, name: 1 } },
    {
      $facet: {
        metadata: [{ $count: 'total' }],
        users: [{ $skip: skip }, { $limit: limit }]
      }
    }
  ];
}

function mapAdminUserRow(user) {
  const xp = Number(user.xp || 0);
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    xp,
    sparks: Number(user.sparks || 0),
    level: getLevelFromXp(xp),
    missionsTotal: Number(user.missionsTotal || 0),
    missionsActive: Number(user.missionsActive || 0),
    status: user.status === 'disabled' ? 'disabled' : 'active'
  };
}

async function fetchAdminUsers(
  UserModel,
  { searchQuery = null, page = 1, limit = 50 } = {}
) {
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safeLimit = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
  const skip = (safePage - 1) * safeLimit;
  const today = startOfTodayUtc();

  const [result] = await UserModel.aggregate(
    buildAdminUsersListPipeline({
      searchQuery,
      skip,
      limit: safeLimit,
      today
    })
  );

  const total = result?.metadata?.[0]?.total || 0;
  const users = (result?.users || []).map(mapAdminUserRow);
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
  fetchAdminUsers,
  mapAdminUserRow
};
