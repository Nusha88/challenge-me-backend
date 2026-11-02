const { resolveCampaignStatus } = require('./campaignHelpers');
const { parseAdminPage, escapeRegExp, idString } = require('./adminPage');

function buildAdminCampaignsMatchStage(searchQuery) {
  if (!searchQuery) return {};
  return {
    title: { $regex: escapeRegExp(searchQuery), $options: 'i' }
  };
}

function buildAdminCampaignsPipeline({ searchQuery, skip, limit }) {
  return [
    { $match: buildAdminCampaignsMatchStage(searchQuery) },
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
        membersCount: { $size: { $ifNull: ['$members', []] } },
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
        status: 1,
        membersCount: 1,
        ownerName: 1,
        ownerId: 1,
        sharedChallengeId: 1,
        startDate: 1,
        endDate: 1,
        createdAt: 1
      }
    },
    { $sort: { createdAt: -1, title: 1 } },
    {
      $facet: {
        metadata: [{ $count: 'total' }],
        campaigns: [{ $skip: skip }, { $limit: limit }]
      }
    }
  ];
}

function mapAdminCampaignRow(campaign, today = new Date()) {
  return {
    id: idString(campaign._id),
    title: campaign.title || '',
    status: resolveCampaignStatus(campaign, today),
    membersCount: Number(campaign.membersCount || 0),
    ownerName: campaign.ownerName || '',
    ownerId: idString(campaign.ownerId),
    sharedChallengeId: idString(campaign.sharedChallengeId) || null,
    startDate: campaign.startDate ? new Date(campaign.startDate).toISOString() : null,
    endDate: campaign.endDate ? new Date(campaign.endDate).toISOString() : null
  };
}

async function fetchAdminCampaigns(
  CampaignModel,
  { searchQuery = null, page = 1, limit = 50 } = {}
) {
  const { safePage, safeLimit, skip } = parseAdminPage({ page, limit });
  const [result] = await CampaignModel.aggregate(
    buildAdminCampaignsPipeline({
      searchQuery,
      skip,
      limit: safeLimit
    })
  );

  const total = result?.metadata?.[0]?.total || 0;
  const campaigns = (result?.campaigns || []).map((row) => mapAdminCampaignRow(row));
  const hasMore = skip + campaigns.length < total;

  return {
    campaigns,
    totalCampaigns: total,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      hasMore
    }
  };
}

module.exports = {
  buildAdminCampaignsMatchStage,
  mapAdminCampaignRow,
  fetchAdminCampaigns
};
