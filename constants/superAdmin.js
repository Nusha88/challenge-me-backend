const SUPER_ADMIN_USER_ID = '69484c7fa2adbb4a712a9ea3';

function isSuperAdminUserId(userId) {
  if (userId == null) return false;
  return String(userId) === SUPER_ADMIN_USER_ID;
}

module.exports = {
  SUPER_ADMIN_USER_ID,
  isSuperAdminUserId
};
