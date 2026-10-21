const { SPARKS_AMOUNTS } = require('./sparksRules');

const SHOP_TOKEN_TYPES = Object.freeze({
  FREEZE: 'freeze',
  SECOND_CHANCE: 'secondChance'
});

const SHOP_DEFENSE_CATALOG = Object.freeze([
  Object.freeze({
    type: SHOP_TOKEN_TYPES.FREEZE,
    cost: SPARKS_AMOUNTS.FREEZE_DAY,
    inventoryField: 'freezeTokens'
  }),
  Object.freeze({
    type: SHOP_TOKEN_TYPES.SECOND_CHANCE,
    cost: SPARKS_AMOUNTS.SECOND_CHANCE,
    inventoryField: 'secondChanceTokens'
  })
]);

const WISH_LIMITS = Object.freeze({
  MAX_ITEMS: 20,
  TITLE_MAX_LENGTH: 80,
  COST_MIN: 10,
  COST_MAX: 9999
});

function getDefenseCatalogItem(type) {
  return SHOP_DEFENSE_CATALOG.find((item) => item.type === type) || null;
}

function buildShopWishSpendKey(wishId, nonce) {
  return `shop-wish:${wishId}:${nonce}`;
}

function buildShopTokenSpendKey(type, nonce) {
  return `shop-token:${type}:${nonce}`;
}

module.exports = {
  SHOP_TOKEN_TYPES,
  SHOP_DEFENSE_CATALOG,
  WISH_LIMITS,
  getDefenseCatalogItem,
  buildShopWishSpendKey,
  buildShopTokenSpendKey
};
