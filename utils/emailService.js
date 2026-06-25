const { Resend } = require('resend');
const { getPasswordResetEmailContent, getPasswordResetSuccessEmailContent } = require('./passwordResetEmailMessages');

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || 'Ignite <noreply@ignite-me.app>';
const PRODUCTION_FRONTEND_URL = process.env.FRONTEND_URL || 'https://ignite-me.app';
const LOCAL_FRONTEND_URL = 'http://localhost:5173';

if (!RESEND_API_KEY) {
  throw new Error('RESEND_API_KEY environment variable is required');
}

const resend = new Resend(RESEND_API_KEY);

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

module.exports = {
  sendPasswordResetEmail,
  sendPasswordResetSuccessEmail
};
