const { getLevelFromXp } = require('./levelSystem');
const { parseAdminPage, startOfToday, escapeRegExp } = require('./adminPage');

function buildAdminUserMatchStage(searchQuery, status) {
  const clauses = [];

  if (searchQuery) {
    const escaped = escapeRegExp(searchQuery);
    clauses.push({
      $or: [
        { name: { $regex: escaped, $options: 'i' } },
        { email: { $regex: escaped, $options: 'i' } }
      ]
    });
  }

  if (status === 'disabled') {
    clauses.push({ status: 'disabled' });
  } else if (status === 'active') {
    clauses.push({ status: { $ne: 'disabled' } });
  }

  if (clauses.length === 0) return {};
  if (clauses.length === 1) return clauses[0];
  return { $and: clauses };
}

function pickIdentity(user) {
  const providers = (user?.identities || [])
    .map((row) => row?.provider)
    .filter(Boolean);
  if (providers.includes('telegram')) return 'telegram';
  if (providers.includes('google')) return 'google';
  return null;
}

function buildAdminUsersListPipeline({ searchQuery, status, skip, limit, today }) {
  const matchStage = buildAdminUserMatchStage(searchQuery, status);

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
        createdAt: 1,
        identities: 1
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
    email: user.email || '',
    identity: pickIdentity(user),
    xp,
    sparks: Number(user.sparks || 0),
    level: getLevelFromXp(xp),
    missionsTotal: Number(user.missionsTotal || 0),
    missionsActive: Number(user.missionsActive || 0),
    status: user.status === 'disabled' ? 'disabled' : 'active',
    createdAt: user.createdAt ? new Date(user.createdAt).toISOString() : null
  };
}

async function fetchAdminUsers(
  UserModel,
  { searchQuery = null, status = null, page = 1, limit = 50 } = {}
) {
  const { safePage, safeLimit, skip } = parseAdminPage({ page, limit });
  const today = startOfToday();

  const [result] = await UserModel.aggregate(
    buildAdminUsersListPipeline({
      searchQuery,
      status,
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
  mapAdminUserRow,
  buildAdminUserMatchStage,
  pickIdentity
};
