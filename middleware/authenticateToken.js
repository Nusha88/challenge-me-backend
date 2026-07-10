const jwt = require('jsonwebtoken');

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    // Fail loudly instead of silently signing/verifying with a public fallback.
    throw new Error('JWT_SECRET is not configured');
  }
  return secret;
}

// Requires a valid bearer token. Rejects otherwise.
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Access token required' });
  }

  jwt.verify(token, getJwtSecret(), (err, user) => {
    if (err) {
      return res.status(403).json({ message: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
}

// Populates req.user when a valid token is present, but never rejects.
// Use for endpoints that are public but personalize when authenticated.
function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (token) {
    try {
      req.user = jwt.verify(token, getJwtSecret());
    } catch {
      req.user = null;
    }
  }
  next();
}

// Returns the authenticated user id from a request, or null. Does not reject.
function getOptionalUserId(req) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return null;
  const token = authHeader.split(' ')[1];
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, getJwtSecret());
    return decoded?.id || null;
  } catch {
    return null;
  }
}

module.exports = authenticateToken;
module.exports.authenticateToken = authenticateToken;
module.exports.optionalAuth = optionalAuth;
module.exports.getOptionalUserId = getOptionalUserId;
module.exports.getJwtSecret = getJwtSecret;
