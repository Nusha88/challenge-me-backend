const { CAMPAIGN_ROLES } = require('./campaignHelpers');
const { startOfToday } = require('./adminPage');

function daysAgo(days, from = startOfToday()) {
  const date = new Date(from);
  date.setDate(date.getDate() - days);
  return date;
}

function notTemplateMatch() {
  return { campaignRole: { $ne: CAMPAIGN_ROLES.PERSONAL_TEMPLATE } };
}

function buildAdminOverviewQueries(today = startOfToday()) {
  const weekAgo = daysAgo(7, today);
  const excludeEndedResult = {
    $nor: [
      {
        challengeType: 'result',
        resultMissionEndedAt: { $ne: null }
      }
    ]
  };

  return {
    usersTotal: {},
    usersNew7d: { createdAt: { $gte: weekAgo } },
    usersDisabled: { status: 'disabled' },
    missionsActive: {
      ...notTemplateMatch(),
      startDate: { $ne: null, $lte: today },
      endDate: { $ne: null, $gte: today },
      ...excludeEndedResult
    },
    missionsPublicVisible: {
      ...notTemplateMatch(),
      privacy: { $ne: 'private' },
      visibility: { $ne: false }
    },
    campaignsLive: {
      status: { $ne: 'draft' },
      startDate: { $ne: null },
      endDate: { $gte: today }
    }
  };
}

async function fetchAdminOverview({ User, Challenge, Campaign }, today = startOfToday()) {
  const queries = buildAdminOverviewQueries(today);
  const [
    usersTotal,
    usersNew7d,
    usersDisabled,
    missionsActive,
    missionsPublicVisible,
    campaignsLive
  ] = await Promise.all([
    User.countDocuments(queries.usersTotal),
    User.countDocuments(queries.usersNew7d),
    User.countDocuments(queries.usersDisabled),
    Challenge.countDocuments(queries.missionsActive),
    Challenge.countDocuments(queries.missionsPublicVisible),
    Campaign.countDocuments(queries.campaignsLive)
  ]);

  return {
    usersTotal,
    usersNew7d,
    usersDisabled,
    missionsActive,
    missionsPublicVisible,
    campaignsLive
  };
}

module.exports = {
  buildAdminOverviewQueries,
  fetchAdminOverview
};
