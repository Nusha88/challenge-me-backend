const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { isGoogleConfigured } = require('./telegramAuth');
const {
  parseOAuthState,
  upsertSocialUser,
  pickGoogleProfile
} = require('./socialAuthService');

function getGoogleCallbackUrl() {
  if (process.env.GOOGLE_CALLBACK_URL) {
    return String(process.env.GOOGLE_CALLBACK_URL).trim();
  }
  const apiBase = (process.env.EMAIL_API_BASE_URL || `http://localhost:${process.env.PORT || 3000}/api`)
    .replace(/\/$/, '');
  return `${apiBase}/auth/google/callback`;
}

function registerGoogleStrategy() {
  if (!isGoogleConfigured()) return false;

  passport.use(new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: getGoogleCallbackUrl(),
      passReqToCallback: true
    },
    async (req, _accessToken, _refreshToken, profile, done) => {
      try {
        const extras = parseOAuthState(req.query.state);
        const google = pickGoogleProfile(profile);
        const result = await upsertSocialUser({
          provider: 'google',
          providerId: google.providerId,
          name: google.name,
          email: google.email,
          emailVerified: google.emailVerified,
          avatarUrl: google.avatarUrl,
          referralCode: extras.referralCode
        });
        done(null, { ...result, redirect: extras.redirect });
      } catch (error) {
        done(error);
      }
    }
  ));

  return true;
}

module.exports = {
  getGoogleCallbackUrl,
  registerGoogleStrategy
};
