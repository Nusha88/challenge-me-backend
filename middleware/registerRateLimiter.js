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

module.exports = registerRateLimiter;
