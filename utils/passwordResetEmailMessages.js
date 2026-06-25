const MESSAGES = {
  en: {
    subject: 'Reset Your Password - Ignite',
    title: 'Reset Your Password',
    greeting: 'Hello {userName},',
    bodyIntro: 'We received a request to reset your password for your Ignite account.',
    bodyCta: 'Click the button below to reset your password:',
    buttonLabel: 'Reset Password',
    linkHint: 'Or copy and paste this link into your browser:',
    expiryNote: "This link will expire in 1 hour. If you didn't request a password reset, please ignore this email.",
    footer: '© {year} Ignite. All rights reserved.',
    textIntro: 'We received a request to reset your password for your Ignite account.',
    textCta: 'Click the following link to reset your password:'
  },
  ru: {
    subject: 'Сбросьте пароль — Ignite',
    title: 'Сброс пароля',
    greeting: 'Здравствуйте, {userName}!',
    bodyIntro: 'Мы получили запрос на сброс пароля для вашего аккаунта Ignite.',
    bodyCta: 'Нажмите кнопку ниже, чтобы сбросить пароль:',
    buttonLabel: 'Сбросить пароль',
    linkHint: 'Или скопируйте и вставьте эту ссылку в браузер:',
    expiryNote: 'Ссылка действительна 1 час. Если вы не запрашивали сброс пароля, просто проигнорируйте это письмо.',
    footer: '© {year} Ignite. Все права защищены.',
    textIntro: 'Мы получили запрос на сброс пароля для вашего аккаунта Ignite.',
    textCta: 'Перейдите по ссылке, чтобы сбросить пароль:'
  }
};

const SUCCESS_MESSAGES = {
  en: {
    subject: 'Password Successfully Reset - Ignite',
    title: 'Password Successfully Reset',
    greeting: 'Hello {userName},',
    bodyIntro: 'Your Ignite account password has been successfully reset.',
    bodyCta: 'You can now sign in with your new password:',
    buttonLabel: 'Sign In',
    linkHint: 'Or copy and paste this link into your browser:',
    securityNote: 'If you did not make this change, please contact support immediately.',
    footer: '© {year} Ignite. All rights reserved.',
    textIntro: 'Your Ignite account password has been successfully reset.',
    textCta: 'Sign in with your new password:'
  },
  ru: {
    subject: 'Пароль успешно сброшен — Ignite',
    title: 'Пароль успешно сброшен',
    greeting: 'Здравствуйте, {userName}!',
    bodyIntro: 'Пароль для вашего аккаунта Ignite был успешно сброшен.',
    bodyCta: 'Теперь вы можете войти с новым паролем:',
    buttonLabel: 'Войти',
    linkHint: 'Или скопируйте и вставьте эту ссылку в браузер:',
    securityNote: 'Если вы не меняли пароль, немедленно свяжитесь со службой поддержки.',
    footer: '© {year} Ignite. Все права защищены.',
    textIntro: 'Пароль для вашего аккаунта Ignite был успешно сброшен.',
    textCta: 'Войдите с новым паролем:'
  }
};

function resolveLanguage(language) {
  return language === 'ru' ? 'ru' : 'en';
}

function format(template, vars) {
  return Object.entries(vars).reduce(
    (result, [key, value]) => result.replace(new RegExp(`\\{${key}\\}`, 'g'), value),
    template
  );
}

function getPasswordResetEmailContent({ userName, resetLink, year, language }) {
  const strings = MESSAGES[resolveLanguage(language)];
  const name = userName || 'User';
  const copyrightYear = String(year ?? new Date().getFullYear());

  const greeting = format(strings.greeting, { userName: name });
  const footer = format(strings.footer, { year: copyrightYear });

  const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>${strings.title}</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #1FA0F6 0%, #A62EE8 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 28px;">Ignite</h1>
          </div>
          <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
            <h2 style="color: #333; margin-top: 0;">${greeting}</h2>
            <p>${strings.bodyIntro}</p>
            <p>${strings.bodyCta}</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${resetLink}"
                 style="display: inline-block; background: linear-gradient(135deg, #1FA0F6 0%, #A62EE8 100%); color: white; padding: 12px 30px; text-decoration: none; border-radius: 25px; font-weight: bold;">
                ${strings.buttonLabel}
              </a>
            </div>
            <p style="font-size: 14px; color: #666;">${strings.linkHint}</p>
            <p style="font-size: 12px; color: #999; word-break: break-all;">${resetLink}</p>
            <p style="font-size: 14px; color: #666; margin-top: 30px;">
              ${strings.expiryNote}
            </p>
            <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
            <p style="font-size: 12px; color: #999; text-align: center;">
              ${footer}
            </p>
          </div>
        </body>
        </html>
      `;

  const text = `
        ${greeting}

        ${strings.textIntro}

        ${strings.textCta}
        ${resetLink}

        ${strings.expiryNote}

        ${footer}
      `;

  return {
    subject: strings.subject,
    html,
    text
  };
}

function getPasswordResetSuccessEmailContent({ userName, loginLink, year, language }) {
  const strings = SUCCESS_MESSAGES[resolveLanguage(language)];
  const name = userName || 'User';
  const copyrightYear = String(year ?? new Date().getFullYear());

  const greeting = format(strings.greeting, { userName: name });
  const footer = format(strings.footer, { year: copyrightYear });

  const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>${strings.title}</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #1FA0F6 0%, #A62EE8 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 28px;">Ignite</h1>
          </div>
          <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
            <h2 style="color: #333; margin-top: 0;">${greeting}</h2>
            <p>${strings.bodyIntro}</p>
            <p>${strings.bodyCta}</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${loginLink}"
                 style="display: inline-block; background: linear-gradient(135deg, #1FA0F6 0%, #A62EE8 100%); color: white; padding: 12px 30px; text-decoration: none; border-radius: 25px; font-weight: bold;">
                ${strings.buttonLabel}
              </a>
            </div>
            <p style="font-size: 14px; color: #666;">${strings.linkHint}</p>
            <p style="font-size: 12px; color: #999; word-break: break-all;">${loginLink}</p>
            <p style="font-size: 14px; color: #666; margin-top: 30px;">
              ${strings.securityNote}
            </p>
            <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
            <p style="font-size: 12px; color: #999; text-align: center;">
              ${footer}
            </p>
          </div>
        </body>
        </html>
      `;

  const text = `
        ${greeting}

        ${strings.textIntro}

        ${strings.textCta}
        ${loginLink}

        ${strings.securityNote}

        ${footer}
      `;

  return {
    subject: strings.subject,
    html,
    text
  };
}

module.exports = {
  getPasswordResetEmailContent,
  getPasswordResetSuccessEmailContent,
  resolveLanguage,
  MESSAGES,
  SUCCESS_MESSAGES
};
