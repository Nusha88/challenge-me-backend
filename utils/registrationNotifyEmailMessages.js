function formatRegistrationDate(registeredAt) {
  const date = registeredAt instanceof Date ? registeredAt : new Date(registeredAt);
  if (Number.isNaN(date.getTime())) {
    return String(registeredAt || 'Unknown');
  }

  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const min = String(date.getUTCMinutes()).padStart(2, '0');

  return `${yyyy}-${mm}-${dd} ${hh}:${min} UTC`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getNewUserRegistrationNotifyEmailContent({ userName, userEmail, registeredAt }) {
  const name = String(userName || 'Unknown').trim() || 'Unknown';
  const email = String(userEmail || 'Unknown').trim() || 'Unknown';
  const registeredAtFormatted = formatRegistrationDate(registeredAt);
  const year = String(new Date().getFullYear());

  const subject = `New Ignite registration: ${name}`;

  const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>New user registration</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #1FA0F6 0%, #A62EE8 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 28px;">Ignite</h1>
          </div>
          <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
            <h2 style="color: #333; margin-top: 0;">New user registered</h2>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; font-weight: bold; width: 140px;">Name</td>
                <td style="padding: 8px 0;">${escapeHtml(name)}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; font-weight: bold;">Email</td>
                <td style="padding: 8px 0;">${escapeHtml(email)}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; font-weight: bold;">Registered at</td>
                <td style="padding: 8px 0;">${escapeHtml(registeredAtFormatted)}</td>
              </tr>
            </table>
            <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
            <p style="font-size: 12px; color: #999; text-align: center;">
              © ${year} Ignite. Admin notification.
            </p>
          </div>
        </body>
        </html>
      `;

  const text = [
    'New user registered on Ignite',
    '',
    `Name: ${name}`,
    `Email: ${email}`,
    `Registered at: ${registeredAtFormatted}`
  ].join('\n');

  return { subject, html, text };
}

module.exports = {
  getNewUserRegistrationNotifyEmailContent,
  formatRegistrationDate
};
