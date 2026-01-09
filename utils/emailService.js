const { Resend } = require('resend');

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || 'onboarding@resend.dev';
const PRODUCTION_FRONTEND_URL = process.env.FRONTEND_URL || 'https://playful-fudge-afc8e6.netlify.app';
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
  // If FRONTEND_URL is explicitly set, use it
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
  
  // Default to production URL for remote requests
  return PRODUCTION_FRONTEND_URL;
}

/**
 * Send password reset email
 * @param {string} email - Recipient email address
 * @param {string} resetToken - Password reset token
 * @param {string} userName - User's name (optional)
 * @param {string} origin - Request origin header (optional)
 * @returns {Promise<Object>} Resend API response
 */
async function sendPasswordResetEmail(email, resetToken, userName = 'User', origin = null) {
  const frontendUrl = getFrontendUrl(origin);
  const resetLink = `${frontendUrl}/reset-password?token=${resetToken}`;
  
  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: [email],
      subject: 'Reset Your Password - ChallengeMe',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Reset Your Password</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #1FA0F6 0%, #A62EE8 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 28px;">ChallengeMe</h1>
          </div>
          <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
            <h2 style="color: #333; margin-top: 0;">Hello ${userName},</h2>
            <p>We received a request to reset your password for your ChallengeMe account.</p>
            <p>Click the button below to reset your password:</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${resetLink}" 
                 style="display: inline-block; background: linear-gradient(135deg, #1FA0F6 0%, #A62EE8 100%); color: white; padding: 12px 30px; text-decoration: none; border-radius: 25px; font-weight: bold;">
                Reset Password
              </a>
            </div>
            <p style="font-size: 14px; color: #666;">Or copy and paste this link into your browser:</p>
            <p style="font-size: 12px; color: #999; word-break: break-all;">${resetLink}</p>
            <p style="font-size: 14px; color: #666; margin-top: 30px;">
              This link will expire in 1 hour. If you didn't request a password reset, please ignore this email.
            </p>
            <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
            <p style="font-size: 12px; color: #999; text-align: center;">
              © ${new Date().getFullYear()} ChallengeMe. All rights reserved.
            </p>
          </div>
        </body>
        </html>
      `,
      text: `
        Hello ${userName},
        
        We received a request to reset your password for your ChallengeMe account.
        
        Click the following link to reset your password:
        ${resetLink}
        
        This link will expire in 1 hour. If you didn't request a password reset, please ignore this email.
        
        © ${new Date().getFullYear()} ChallengeMe. All rights reserved.
      `
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

module.exports = {
  sendPasswordResetEmail
};
