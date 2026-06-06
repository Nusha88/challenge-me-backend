function mapAwardEvents(results = []) {
  return results.map((item) => ({
    awarded: item.awarded,
    gained: item.sparksGained ?? item.xpGained ?? 0,
    reason: item.reason || null,
    eventKey: item.eventKey || null
  }));
}

function sumGained(results = [], field) {
  return results.reduce((sum, item) => sum + (item?.[field] || 0), 0);
}

function buildRewardPayload({ user, xpResults = [], sparksResults = [] } = {}) {
  const xpGained = sumGained(xpResults, 'xpGained');
  const sparksGained = sumGained(sparksResults, 'sparksGained');

  return {
    xpGained,
    sparksGained,
    xp: user?.xp,
    sparks: user?.sparks,
    user,
    xpAward: {
      gained: xpGained,
      events: mapAwardEvents(xpResults)
    },
    sparksAward: {
      gained: sparksGained,
      events: mapAwardEvents(sparksResults)
    }
  };
}

module.exports = {
  buildRewardPayload,
  mapAwardEvents
};
