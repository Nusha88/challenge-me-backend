const rateLimit = require('express-rate-limit');

const windowMs = Number.parseInt(process.env.REGISTER_RATE_LIMIT_WINDOW_MS || '3600000', 10);
const max = Number.parseInt(process.env.REGISTER_RATE_LIMIT_MAX || '3', 10);

const registerRateLimiter = rateLimit({
  windowMs: Number.isFinite(windowMs) && windowMs > 0 ? windowMs : 3600000,
  max: Number.isFinite(max) && max > 0 ? max : 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: 'Too many registration attempts from this IP. Please try again later.'
  }
});

// Protects credential-guessing / abuse endpoints (login, forgot/reset password).
const loginWindowMs = Number.parseInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS || '900000', 10); // 15 min
const loginMax = Number.parseInt(process.env.AUTH_RATE_LIMIT_MAX || '10', 10);

const authRateLimiter = rateLimit({
  windowMs: Number.isFinite(loginWindowMs) && loginWindowMs > 0 ? loginWindowMs : 900000,
  max: Number.isFinite(loginMax) && loginMax > 0 ? loginMax : 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: 'Too many attempts from this IP. Please try again later.'
  }
});

module.exports = registerRateLimiter;
module.exports.registerRateLimiter = registerRateLimiter;
module.exports.authRateLimiter = authRateLimiter;
