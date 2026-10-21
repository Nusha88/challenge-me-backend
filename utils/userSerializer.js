function serializeInventory(user) {
  if (!user || user.inventory == null) return undefined;

  return {
    freezeTokens: Math.max(0, Number(user.inventory.freezeTokens) || 0),
    secondChanceTokens: Math.max(0, Number(user.inventory.secondChanceTokens) || 0)
  };
}

function serializeUserForClient(user) {
  if (!user) return null;

  const payload = {
    id: user._id,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl,
    xp: user.xp || 0,
    sparks: user.sparks || 0,
    createdAt: user.createdAt
  };

  const inventory = serializeInventory(user);
  if (inventory) {
    payload.inventory = inventory;
  }

  return payload;
}

module.exports = {
  serializeInventory,
  serializeUserForClient
};
