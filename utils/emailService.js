const { Resend } = require('resend');
const { getPasswordResetEmailContent, getPasswordResetSuccessEmailContent } = require('./passwordResetEmailMessages');
const { getNewUserRegistrationNotifyEmailContent } = require('./registrationNotifyEmailMessages');
const { getWeeklyChronicleEmailContent } = require('./weeklyChronicleEmailMessages');
const { getReactivationEmailContent } = require('./reactivationEmailMessages');
const {
  buildUnsubscribeUrl,
  EMAIL_UNSUBSCRIBE_TYPES
} = require('./emailUnsubscribe');

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || 'Ignite <noreply@ignite-me.app>';
const REGISTRATION_NOTIFY_EMAIL = process.env.REGISTRATION_NOTIFY_EMAIL;
const PRODUCTION_FRONTEND_URL = process.env.FRONTEND_URL || 'https://ignite-me.app';
const LOCAL_FRONTEND_URL = 'http://localhost:5173';

// Email is optional for local development: if no key is configured we warn and
// no-op instead of crashing the whole server at import time (mirrors the push
// service's graceful degradation).
const isEmailConfigured = Boolean(RESEND_API_KEY);

if (!isEmailConfigured) {
  console.warn('[Email] RESEND_API_KEY is not set — transactional emails are disabled.');
}

const resend = isEmailConfigured
  ? new Resend(RESEND_API_KEY)
  : { emails: { send: async () => ({ data: null, error: null }) } };

/**
 * Determine the frontend URL based on request origin
 * @param {string} origin - Request origin header
 * @returns {string} Frontend URL
 */
function getFrontendUrl(origin) {
  if (process.env.FRONTEND_URL) {
    return process.env.FRONTEND_URL;
  }
  
  // Check if request is from localhost
  if (origin && (
    origin.includes('localhost') || 
    origin.includes('127.0.0.1') ||
    origin.includes('.local')
  )) {
    return LOCAL_FRONTEND_URL;
  }
  
  return PRODUCTION_FRONTEND_URL;
}

/**
 * Send password reset email
 * @param {string} email - Recipient email address
 * @param {string} resetToken - Password reset token
 * @param {string} userName - User's name (optional)
 * @param {string} origin - Request origin header (optional)
 * @param {string} language - App UI language ('en' | 'ru', optional)
 * @returns {Promise<Object>} Resend API response
 */
async function sendPasswordResetEmail(email, resetToken, userName = 'User', origin = null, language = null) {
  const frontendUrl = getFrontendUrl(origin);
  const resetLink = `${frontendUrl}/reset-password?token=${resetToken}`;
  const { subject, html, text } = getPasswordResetEmailContent({
    userName,
    resetLink,
    year: new Date().getFullYear(),
    language
  });

  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: [email],
      subject,
      html,
      text
    });

    if (error) {
      console.error('Resend API error:', error);
      throw new Error(`Failed to send email: ${error.message}`);
    }

    return data;
  } catch (error) {
    console.error('Error sending password reset email:', error);
    throw error;
  }
}

/**
 * Send password reset success confirmation email
 * @param {string} email - Recipient email address
 * @param {string} userName - User's name (optional)
 * @param {string} origin - Request origin header (optional)
 * @param {string} language - App UI language ('en' | 'ru', optional)
 * @returns {Promise<Object>} Resend API response
 */
async function sendPasswordResetSuccessEmail(email, userName = 'User', origin = null, language = null) {
  const frontendUrl = getFrontendUrl(origin);
  const loginLink = `${frontendUrl}/login`;
  const { subject, html, text } = getPasswordResetSuccessEmailContent({
    userName,
    loginLink,
    year: new Date().getFullYear(),
    language
  });

  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: [email],
      subject,
      html,
      text
    });

    if (error) {
      console.error('Resend API error:', error);
      throw new Error(`Failed to send email: ${error.message}`);
    }

    return data;
  } catch (error) {
    console.error('Error sending password reset success email:', error);
    throw error;
  }
}

/**
 * Notify admin when a new user registers.
 * Skips silently when REGISTRATION_NOTIFY_EMAIL is not configured.
 * @param {{ userName: string, userEmail: string, registeredAt: Date|string }} params
 * @returns {Promise<Object|null>} Resend API response or null if skipped
 */
async function sendNewUserRegistrationNotifyEmail({ userName, userEmail, registeredAt }) {
  if (!REGISTRATION_NOTIFY_EMAIL) {
    console.warn('REGISTRATION_NOTIFY_EMAIL is not set; skipping registration notify email');
    return null;
  }

  const { subject, html, text } = getNewUserRegistrationNotifyEmailContent({
    userName,
    userEmail,
    registeredAt
  });

  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: [REGISTRATION_NOTIFY_EMAIL],
      subject,
      html,
      text
    });

    if (error) {
      console.error('Resend API error:', error);
      throw new Error(`Failed to send email: ${error.message}`);
    }

    return data;
  } catch (error) {
    console.error('Error sending registration notify email:', error);
    throw error;
  }
}

/**
 * Send weekly chronicle summary email to a user.
 * @param {string} email - Recipient email address
 * @param {Object} report - Report from buildWeeklyChronicleReport()
 * @returns {Promise<Object>} Resend API response
 */
function getEmailFrontendUrl() {
  return (
    process.env.EMAIL_FRONTEND_URL ||
    process.env.FRONTEND_URL ||
    'https://ignite-me.app'
  ).replace(/\/$/, '');
}

async function sendWeeklyChronicleEmail(email, report, userId) {
  const frontendUrl = getEmailFrontendUrl();
  const logoUrl = process.env.EMAIL_LOGO_URL || `${frontendUrl}/awa.png`;
  const unsubscribeUrl = userId
    ? buildUnsubscribeUrl(userId, EMAIL_UNSUBSCRIBE_TYPES.WEEKLY_CHRONICLE, frontendUrl)
    : null;
  const { subject, html, text } = getWeeklyChronicleEmailContent(report, {
    appUrl: frontendUrl,
    logoUrl,
    year: new Date().getFullYear(),
    unsubscribeUrl
  });

  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: [email],
      subject,
      html,
      text
    });

    if (error) {
      console.error('Resend API error:', error);
      throw new Error(`Failed to send email: ${error.message}`);
    }

    return data;
  } catch (error) {
    console.error('Error sending weekly chronicle email:', error);
    throw error;
  }
}

/**
 * Send habit re-engagement email after 3-day ritual pause.
 * @param {string} email
 * @param {{ userName?: string, firstName?: string, sparksBalance?: number, language?: string }} payload
 */
async function sendReactivationEmail(email, payload = {}) {
  const frontendUrl = getEmailFrontendUrl();
  const logoUrl = process.env.EMAIL_LOGO_URL || `${frontendUrl}/icons/icon-192.png`;
  const unsubscribeUrl = payload.userId
    ? buildUnsubscribeUrl(payload.userId, EMAIL_UNSUBSCRIBE_TYPES.REACTIVATION, frontendUrl)
    : null;
  const { subject, html, text } = getReactivationEmailContent({
    userName: payload.userName,
    sparksBalance: payload.sparksBalance,
    language: payload.language,
    appUrl: frontendUrl,
    logoUrl,
    year: new Date().getFullYear(),
    unsubscribeUrl
  });

  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: [email],
      subject,
      html,
      text
    });

    if (error) {
      console.error('Resend API error:', error);
      throw new Error(`Failed to send email: ${error.message}`);
    }

    return data;
  } catch (error) {
    console.error('Error sending reactivation email:', error);
    throw error;
  }
}

module.exports = {
  sendPasswordResetEmail,
  sendPasswordResetSuccessEmail,
  sendNewUserRegistrationNotifyEmail,
  sendWeeklyChronicleEmail,
  sendReactivationEmail
};
