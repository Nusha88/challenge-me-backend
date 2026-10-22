/**
 * Localized push copy for comment / reply notifications.
 * Language follows user.dailyRecapLanguage ('ru' | 'en').
 */

const MESSAGES = {
  en: {
    someone: 'Someone',
    defaultMission: 'your mission',
    pushCommentTitle: 'New Comment',
    pushCommentBody: '{fromName} commented on your challenge "{missionTitle}"',
    pushReplyTitle: 'New Reply',
    pushReplyBody: '{fromName} replied to your comment on "{missionTitle}"',
    dailyRecapTitle: 'Daily Recap',
    dailyRecapBodies: [
      "Today's missions are still active. Shall we make a final push?",
      "Only a little remains to complete today's plan."
    ],
    pushFriendRequestTitle: 'Squad request',
    pushFriendRequestBody: '{fromName} wants to join your squad'
  },
  ru: {
    someone: 'Кто-то',
    defaultMission: 'ваша миссия',
    pushCommentTitle: 'Новый комментарий',
    pushCommentBody: '{fromName} прокомментировал(а) ваш вызов «{missionTitle}»',
    pushReplyTitle: 'Новый ответ',
    pushReplyBody: '{fromName} ответил(а) на ваш комментарий к «{missionTitle}»',
    dailyRecapTitle: 'Итоги дня',
    dailyRecapBodies: [
      'Миссии дня еще активны. Сделаем финальный рывок?',
      'До завершения сегодняшнего плана осталось совсем немного.'
    ],
    pushFriendRequestTitle: 'Заявка в отряд',
    pushFriendRequestBody: '{fromName} хочет вступить в твой отряд'
  }
};

function resolveLanguage(language) {
  return language === 'ru' ? 'ru' : 'en';
}

function formatMessage(template, fromName, missionTitle) {
  return template
    .replace(/\{fromName\}/g, fromName)
    .replace(/\{missionTitle\}/g, missionTitle);
}

/**
 * @param {'comment'|'mention'|string} type
 * @param {boolean} [isReplyToUser] — true when replying to someone's comment
 */
function getLocalizedCommentPush(type, fromName, missionTitle, language, isReplyToUser = false) {
  const lang = resolveLanguage(language);
  const strings = MESSAGES[lang];
  const name = fromName || strings.someone;
  const title = missionTitle || strings.defaultMission;
  const isReply = type === 'mention' || isReplyToUser;

  if (isReply) {
    return {
      title: strings.pushReplyTitle,
      body: formatMessage(strings.pushReplyBody, name, title)
    };
  }

  return {
    title: strings.pushCommentTitle,
    body: formatMessage(strings.pushCommentBody, name, title)
  };
}

function getLocalizedFriendRequestPush(fromName, language) {
  const strings = MESSAGES[resolveLanguage(language)];
  const name = fromName || strings.someone;
  return {
    title: strings.pushFriendRequestTitle || MESSAGES.en.pushFriendRequestTitle,
    body: (strings.pushFriendRequestBody || MESSAGES.en.pushFriendRequestBody).replace(
      /\{fromName\}/g,
      name
    )
  };
}

function getLocalizedDailyRecap(language) {
  const strings = MESSAGES[resolveLanguage(language)];
  const bodies = strings.dailyRecapBodies || MESSAGES.en.dailyRecapBodies;
  const body = bodies[Math.floor(Math.random() * bodies.length)];

  return {
    title: strings.dailyRecapTitle || MESSAGES.en.dailyRecapTitle,
    body
  };
}

module.exports = {
  getLocalizedCommentPush,
  getLocalizedFriendRequestPush,
  getLocalizedDailyRecap,
  MESSAGES
};
