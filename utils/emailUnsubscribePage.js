function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getUnsubscribeCopy(language, { success, error } = {}) {
  const isRu = language === 'ru';

  if (error) {
    return isRu
      ? {
        title: 'Не удалось отписаться',
        message: error,
        profileLabel: 'Открыть Ignite'
      }
      : {
        title: 'Unsubscribe failed',
        message: error,
        profileLabel: 'Open Ignite'
      };
  }

  return isRu
    ? {
      title: success ? 'Вы отписались' : 'Отписка',
      message: success || 'Настройки email обновлены.',
      profileLabel: 'Перейти в профиль'
    }
    : {
      title: success ? "You're unsubscribed" : 'Unsubscribe',
      message: success || 'Your email preferences were updated.',
      profileLabel: 'Go to profile'
    };
}

function renderEmailUnsubscribeHtml({
  language = 'en',
  success = null,
  error = null,
  profileUrl = 'https://ignite-me.app/profile'
} = {}) {
  const copy = getUnsubscribeCopy(language, { success, error });
  const isError = Boolean(error);

  return `<!DOCTYPE html>
<html lang="${language === 'ru' ? 'ru' : 'en'}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(copy.title)}</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      font-family: Arial, Helvetica, sans-serif;
      background: linear-gradient(160deg, #0f172a 0%, #16213e 56%, #1a1a2e 100%);
      color: #fff;
    }
    .card {
      width: 100%;
      max-width: 480px;
      padding: 32px 28px;
      border-radius: 18px;
      background: rgba(15, 23, 42, 0.92);
      border: 1px solid rgba(79, 209, 197, 0.18);
      text-align: center;
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.35);
    }
    h1 {
      margin: 0 0 12px;
      font-size: 1.5rem;
    }
    p {
      margin: 0;
      line-height: 1.6;
      color: rgba(255, 255, 255, 0.78);
    }
    a.button {
      display: inline-block;
      margin-top: 24px;
      padding: 12px 20px;
      border-radius: 12px;
      background: #4FD1C5;
      color: #0F172A;
      text-decoration: none;
      font-weight: 700;
    }
    .icon {
      font-size: 2rem;
      margin-bottom: 12px;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${isError ? '✉️' : '✓'}</div>
    <h1>${escapeHtml(copy.title)}</h1>
    <p>${escapeHtml(copy.message)}</p>
    ${isError ? '' : `<a class="button" href="${escapeHtml(profileUrl)}">${escapeHtml(copy.profileLabel)}</a>`}
  </div>
</body>
</html>`;
}

module.exports = {
  renderEmailUnsubscribeHtml,
  getUnsubscribeCopy
};
