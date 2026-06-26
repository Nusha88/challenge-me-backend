const REACTIVATION_MESSAGES = {
  en: {
    subject: '🌌 Your flame is fading... We miss you in Ignite',
    preheader: 'Your legend is on pause — one small step can reignite it.',
    greeting: 'Hello, {{firstName}}',
    bodyText: 'Your legend is on pause, but it is never lost. Even heroes need rest — what matters is the moment you choose to return. Your rituals are waiting quietly, ready whenever you are.',
    sparksNotice: 'You still have {{sparksBalance}} Sparks glowing in your account. They are proof of the path you have already walked.',
    ctaButton: 'REIGNITE YOUR FLAME',
    footer: '© {{year}} Ignite. You received this because we noticed a short pause in your ritual journey. We will only send this reminder once for this pause.'
  },
  ru: {
    subject: '🌌 Твоё пламя угасает... Нам не хватает тебя в Ignite',
    preheader: 'Твоя легенда на паузе — один шаг может снова её разжечь.',
    greeting: 'Привет, {{firstName}}',
    bodyText: 'Твоя легенда на паузе, но она не исчезла. Даже героям нужен отдых — важен момент, когда ты решаешь вернуться. Твои ритуалы ждут тебя и готовы продолжиться, когда ты будешь готов.',
    sparksNotice: 'У тебя всё ещё {{sparksBalance}} Искр на счету. Это знак пути, который ты уже прошёл.',
    ctaButton: 'РАЗЖЕЧЬ ПЛАМЯ СНОВА',
    footer: '© {{year}} Ignite. Вы получили это письмо, потому что мы заметили короткую паузу в ваших ритуалах. Такое напоминание отправляется только один раз за эту паузу.'
  }
};

const COLORS = {
  bg: '#0a0a0c',
  card: '#12121a',
  cardInner: '#16161f',
  border: 'rgba(139, 92, 246, 0.28)',
  borderSoft: 'rgba(255, 255, 255, 0.08)',
  accent: '#8b5cf6',
  accentSoft: 'rgba(139, 92, 246, 0.18)',
  text: '#ececf1',
  textMuted: '#9ca3af',
  textDim: '#6b7280',
  sparks: '#fbbf24',
  sparksGlow: 'rgba(251, 191, 36, 0.25)'
};

function resolveLanguage(language) {
  return language === 'ru' ? 'ru' : 'en';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function interpolate(template, vars) {
  return Object.entries(vars).reduce(
    (result, [key, value]) => result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value),
    template
  );
}

function getFirstName(fullName) {
  const trimmed = String(fullName || '').trim();
  if (!trimmed) return 'Hero';
  return trimmed.split(/\s+/)[0];
}

function getReactivationEmailContent({
  userName,
  sparksBalance,
  language,
  appUrl,
  logoUrl,
  year
}) {
  const lang = resolveLanguage(language);
  const strings = REACTIVATION_MESSAGES[lang];
  const firstName = escapeHtml(getFirstName(userName));
  const sparks = escapeHtml(String(Math.max(0, Number(sparksBalance) || 0)));
  const copyrightYear = String(year ?? new Date().getFullYear());
  const loginUrl = appUrl || 'https://ignite-me.app';
  const iconUrl = logoUrl || `${loginUrl}/icons/icon-192.png`;

  const vars = {
    firstName,
    sparksBalance: sparks,
    year: copyrightYear
  };

  const subject = interpolate(strings.subject, vars);
  const greeting = interpolate(strings.greeting, vars);
  const bodyText = interpolate(strings.bodyText, vars);
  const sparksNotice = interpolate(strings.sparksNotice, vars);
  const ctaButton = strings.ctaButton;
  const footer = interpolate(strings.footer, vars);
  const preheader = interpolate(strings.preheader, vars);

  const html = `
<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${escapeHtml(subject)}</title>
  <style>
    body, table, td { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
    table, td { mso-table-lspace:0pt; mso-table-rspace:0pt; }
    img { -ms-interpolation-mode:bicubic; border:0; outline:none; text-decoration:none; }
    @media only screen and (max-width:620px) {
      .container { width:100% !important; }
      .hero-title { font-size:26px !important; }
      .body-copy { font-size:15px !important; }
    }
  </style>
</head>
<body style="margin:0; padding:0; background:${COLORS.bg}; color:${COLORS.text};">
  <div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent; mso-hide:all;">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse; background:${COLORS.bg};">
    <tr>
      <td align="center" style="padding:28px 14px 36px;">
        <table role="presentation" class="container" width="560" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse; width:100%; max-width:560px;">
          <tr>
            <td align="center" style="padding:0 0 20px;">
              <img src="${escapeHtml(iconUrl)}" width="72" height="72" alt="Ignite" style="display:block; width:72px; height:72px; border-radius:18px; box-shadow:0 0 24px ${COLORS.accentSoft};">
            </td>
          </tr>
          <tr>
            <td style="background:${COLORS.card}; border:1px solid ${COLORS.border}; border-radius:12px; overflow:hidden; box-shadow:0 20px 50px rgba(0,0,0,0.42);">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
                <tr>
                  <td style="padding:32px 28px 24px; background:linear-gradient(180deg, rgba(139,92,246,0.10) 0%, rgba(18,18,26,0) 100%); text-align:center;">
                    <p style="margin:0 0 8px; font-family:Georgia, 'Times New Roman', serif; font-size:36px; line-height:1;">🌌</p>
                    <h1 class="hero-title" style="margin:0 0 14px; font-family:Georgia, 'Times New Roman', serif; font-size:30px; line-height:1.2; font-weight:700; color:${COLORS.text};">${greeting}</h1>
                    <p class="body-copy" style="margin:0; font-family:Arial, Helvetica, sans-serif; font-size:16px; line-height:1.65; color:${COLORS.textMuted};">${bodyText}</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 28px 28px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse; background:${COLORS.cardInner}; border:1px solid ${COLORS.borderSoft}; border-radius:12px;">
                      <tr>
                        <td style="padding:18px 20px; text-align:center;">
                          <p style="margin:0; font-family:Arial, Helvetica, sans-serif; font-size:15px; line-height:1.6; color:${COLORS.text};">
                            <span style="font-size:22px; vertical-align:middle; color:${COLORS.sparks}; text-shadow:0 0 14px ${COLORS.sparksGlow};">⚡</span>
                            <span style="font-size:16px; color:${COLORS.textMuted};"> ${sparksNotice}</span>
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding:0 28px 32px;">
                    <a href="${loginUrl}"
                       style="display:inline-block; min-width:240px; padding:16px 28px; background:linear-gradient(135deg, #7c3aed 0%, ${COLORS.accent} 50%, #a78bfa 100%); color:#ffffff; text-decoration:none; border-radius:999px; font-family:Arial, Helvetica, sans-serif; font-size:14px; font-weight:800; letter-spacing:0.08em; text-transform:uppercase; box-shadow:0 12px 32px rgba(139,92,246,0.35), inset 0 1px 0 rgba(255,255,255,0.16);">
                      ${ctaButton}
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 8px 0; font-family:Arial, Helvetica, sans-serif; font-size:11px; line-height:1.6; color:${COLORS.textDim}; text-align:center;">
              ${footer}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();

  const text = [
    greeting,
    '',
    bodyText,
    '',
    sparksNotice,
    '',
    `${ctaButton}: ${loginUrl}`,
    '',
    footer
  ].join('\n');

  return { subject, html, text };
}

module.exports = {
  REACTIVATION_MESSAGES,
  getReactivationEmailContent,
  getFirstName,
  resolveLanguage
};
