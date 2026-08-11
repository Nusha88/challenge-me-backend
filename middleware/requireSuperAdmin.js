const { isSuperAdminUserId } = require('../constants/superAdmin');

function requireSuperAdmin(req, res, next) {
  if (!isSuperAdminUserId(req.user?.id)) {
    return res.status(403).json({ message: 'Super admin access required' });
  }
  next();
}

module.exports = requireSuperAdmin;
