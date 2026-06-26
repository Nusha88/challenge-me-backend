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
  sparksGlow: 'rgba(251, 191, 36, 0.25)',
  rankGold: '#fcd34d',
  success: '#34d399'
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

function formatWeekRange(weekStart, weekEnd, language) {
  const start = new Date(`${weekStart}T12:00:00.000Z`);
  const end = new Date(`${weekEnd}T12:00:00.000Z`);
  const locale = resolveLanguage(language) === 'ru' ? 'ru-RU' : 'en-US';
  const options = { day: 'numeric', month: 'long' };

  const startLabel = start.toLocaleDateString(locale, options);
  const endLabel = end.toLocaleDateString(locale, { ...options, year: 'numeric' });

  return `${startLabel} – ${endLabel}`;
}

function getWeekdayShort(dateYmd, language) {
  const date = new Date(`${dateYmd}T12:00:00.000Z`);
  const locale = resolveLanguage(language) === 'ru' ? 'ru-RU' : 'en-US';
  return date.toLocaleDateString(locale, { weekday: 'short' });
}

function buildProgressBarHtml(percent, barColor = COLORS.accent) {
  const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
      <tr>
        <td style="background:${COLORS.cardInner}; border-radius:999px; padding:0; height:10px; border:1px solid ${COLORS.borderSoft};">
          <table role="presentation" width="${safePercent}%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse; min-width:10px;">
            <tr>
              <td style="background:linear-gradient(90deg, ${barColor} 0%, #a78bfa 100%); height:10px; border-radius:999px; font-size:0; line-height:0;">&nbsp;</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;
}

function getDayDisciplineRatio(day) {
  const total = Math.max(0, Number(day?.total) || 0);
  const completed = Math.max(0, Number(day?.completed) || 0);

  if (total <= 0) return 0;
  return completed / total;
}

function buildDayTrackerDotHtml(day) {
  const ratio = getDayDisciplineRatio(day);
  const size = 40;
  const ring = `2px solid ${COLORS.borderSoft}`;

  if (ratio >= 1) {
    return `
      <div style="width:${size}px; height:${size}px; border-radius:50%; margin:0 auto; background:${COLORS.accent}; border:2px solid #a78bfa; box-shadow:0 0 14px ${COLORS.accentSoft};"></div>
    `;
  }

  if (ratio > 0) {
    const fillPercent = Math.max(8, Math.round(ratio * 100));
    return `
      <div style="width:${size}px; height:${size}px; border-radius:50%; margin:0 auto; border:2px solid ${COLORS.accent}; background:linear-gradient(to top, ${COLORS.accent} 0%, ${COLORS.accent} ${fillPercent}%, ${COLORS.card} ${fillPercent}%, ${COLORS.card} 100%); box-shadow:0 0 8px rgba(139,92,246,0.22);"></div>
    `;
  }

  return `
    <div style="width:${size}px; height:${size}px; border-radius:50%; margin:0 auto; background:transparent; border:${ring};"></div>
  `;
}

function buildRitualsWeekTrackerHtml(weekDays, language) {
  const days = Array.isArray(weekDays) && weekDays.length > 0 ? weekDays : [];

  if (days.length === 0) {
    return '';
  }

  const cells = days.map((day) => {
    const label = escapeHtml(getWeekdayShort(day.date, language));

    return `
      <td align="center" valign="bottom" style="padding:0 4px; width:14.28%; min-width:44px;">
        <div style="font-family:Arial, Helvetica, sans-serif; font-size:11px; line-height:1.2; color:${COLORS.textMuted}; text-transform:uppercase; letter-spacing:0.06em; font-weight:700; margin-bottom:10px;">${label}</div>
        ${buildDayTrackerDotHtml(day)}
      </td>
    `;
  }).join('');

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
      <tr>${cells}</tr>
    </table>
  `;
}

function buildRitualsDisciplineSubtext(completedTotal, language) {
  const count = Math.max(0, Number(completedTotal) || 0);
  const isRu = resolveLanguage(language) === 'ru';

  if (count === 0) {
    return isRu
      ? 'На этой неделе ритуальные отметки не выполнялись. Новая неделя — чистый лист для вашей дисциплины.'
      : 'No ritual check-ins were completed this week. A new week is a fresh start for your discipline.';
  }

  if (isRu) {
    const noun = count === 1 ? 'ритуальную отметку' : 'ритуальных отметок';
    const verb = count === 1 ? 'Вы выполнили' : 'Вы выполнили';
    return `${verb} ${count} ${noun} по активным привычкам за эту неделю.`;
  }

  const noun = count === 1 ? 'ritual check-in' : 'ritual check-ins';
  return `You completed ${count} ${noun} across your active habits this week.`;
}

function buildRitualsWeekDotsHtml(weekDays, language) {
  return buildRitualsWeekTrackerHtml(weekDays, language);
}

function hasWeeklyQuestProgress(quests) {
  return (quests || []).some((quest) => (quest.stepsCompletedThisWeek || 0) > 0);
}

function buildQuestLines(quests, language) {
  if (!quests?.length || !hasWeeklyQuestProgress(quests)) {
    return resolveLanguage(language) === 'ru'
      ? 'Следующая глава уже близко. Отдохните, соберитесь с силами и вернитесь сильнее.'
      : 'The next chapter awaits. Rest, regroup, and return stronger.';
  }

  return quests.slice(0, 5).map((quest) => {
    const title = quest.title || (language === 'ru' ? 'Квест' : 'Quest');
    const weekSteps = quest.stepsCompletedThisWeek || 0;
    const progress = quest.totalSteps > 0
      ? `${quest.overallCompleted}/${quest.totalSteps}`
      : String(quest.overallCompleted);

    if (resolveLanguage(language) === 'ru') {
      return `• ${title} — +${weekSteps} за неделю, всего ${progress}`;
    }

    return `• ${title} — +${weekSteps} this week, ${progress} overall`;
  }).join('\n');
}

function buildQuestHtml(quests, language) {
  const isRu = resolveLanguage(language) === 'ru';

  if (!quests?.length || !hasWeeklyQuestProgress(quests)) {
    const title = isRu ? 'Готовимся к следующей главе' : 'Preparing for the next chapter';
    const body = isRu
      ? 'На этой неделе шаги не отмечались — но легенда продолжается. Новая неделя — новый шанс на подвиг.'
      : 'No steps were marked this week — but your legend continues. A new week brings a fresh chance for glory.';

    return `
      <div style="text-align:center; padding:18px 12px; border-radius:12px; background:${COLORS.cardInner}; border:1px dashed ${COLORS.border};">
        <div style="font-size:28px; line-height:1; margin-bottom:10px;">⚔️</div>
        <p style="margin:0 0 6px; font-size:15px; font-weight:700; color:${COLORS.text}; letter-spacing:0.02em;">${title}</p>
        <p style="margin:0; font-size:13px; line-height:1.55; color:${COLORS.textMuted};">${body}</p>
      </div>
    `;
  }

  const items = quests.slice(0, 5).map((quest) => {
    const title = escapeHtml(quest.title || (isRu ? 'Квест' : 'Quest'));
    const weekSteps = quest.stepsCompletedThisWeek || 0;
    const totalSteps = Math.max(1, quest.totalSteps || 1);
    const overallPercent = Math.round(((quest.overallCompleted || 0) / totalSteps) * 100);
    const detail = isRu
      ? `+${weekSteps} за неделю · ${quest.overallCompleted}/${quest.totalSteps} всего`
      : `+${weekSteps} this week · ${quest.overallCompleted}/${quest.totalSteps} overall`;

    return `
      <div style="margin-bottom:12px; padding:14px; border-radius:12px; background:${COLORS.cardInner}; border:1px solid ${COLORS.borderSoft};">
        <p style="margin:0 0 4px; font-size:14px; font-weight:700; color:${COLORS.text};">${title}</p>
        <p style="margin:0 0 10px; font-size:12px; color:${COLORS.textMuted};">${detail}</p>
        ${buildProgressBarHtml(overallPercent, '#c084fc')}
      </div>
    `;
  }).join('');

  return items;
}

function buildSectionCard(title, icon, accentColor, bodyHtml, options = {}) {
  const { fullWidth = false } = options;
  const widthAttr = fullWidth ? 'colspan="2"' : '';
  const columnClass = fullWidth ? '' : 'class="stack-column" width="50%"';

  return `
    <td ${columnClass} ${widthAttr} valign="top" style="padding:8px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse; background:${COLORS.cardInner}; border:1px solid ${COLORS.borderSoft}; border-radius:12px; overflow:hidden;">
        <tr>
          <td style="padding:18px 18px 16px; font-family:Arial, Helvetica, sans-serif;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
              <tr>
                <td width="34" valign="top" style="font-size:22px; line-height:1;">${icon}</td>
                <td valign="top">
                  <p style="margin:0 0 12px; font-size:11px; letter-spacing:0.14em; text-transform:uppercase; color:${accentColor}; font-weight:700;">${title}</p>
                  ${bodyHtml}
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </td>
  `;
}

function buildRitualsSectionHtml(report, strings, language) {
  const ritualsCompleted = report?.rituals?.completedTotal ?? 0;
  const ritualsScheduled = report?.rituals?.scheduledTotal ?? 0;
  const ritualsRate = report?.rituals?.completionRate ?? 0;
  const weekTracker = buildRitualsWeekTrackerHtml(report?.rituals?.weekDays, language);
  const isRu = resolveLanguage(language) === 'ru';

  const disciplineLabel = isRu ? 'Рейтинг дисциплины' : 'Discipline Rating';
  const heroMetric = ritualsScheduled > 0
    ? `${disciplineLabel}: <span style="color:${COLORS.accent};">${ritualsRate}%</span>`
    : `<span style="color:${COLORS.textMuted};">${strings.ritualsEmpty}</span>`;

  const subtext = ritualsScheduled > 0
    ? buildRitualsDisciplineSubtext(ritualsCompleted, language)
    : (isRu
      ? 'На этой неделе не было запланированных ритуалов по вашим активным привычкам.'
      : 'No ritual check-ins were scheduled across your active habits this week.');

  return `
    <td colspan="2" valign="top" style="padding:8px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse; background:${COLORS.cardInner}; border:1px solid ${COLORS.borderSoft}; border-radius:12px; overflow:hidden;">
        <tr>
          <td style="padding:18px 18px 0; font-family:Arial, Helvetica, sans-serif;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
              <tr>
                <td width="34" valign="top" style="font-size:22px; line-height:1;">🛡️</td>
                <td valign="top">
                  <p style="margin:0 0 14px; font-size:11px; letter-spacing:0.14em; text-transform:uppercase; color:${COLORS.accent}; font-weight:700;">${strings.ritualsTitle}</p>
                  <p style="margin:0 0 10px; font-size:30px; font-weight:800; color:${COLORS.text}; line-height:1.15; letter-spacing:-0.02em;">${heroMetric}</p>
                  <p style="margin:0 0 16px; font-size:13px; line-height:1.6; color:${COLORS.textMuted};">${escapeHtml(subtext)}</p>
                  ${ritualsScheduled > 0 ? buildProgressBarHtml(ritualsRate) : ''}
                </td>
              </tr>
            </table>
          </td>
        </tr>
        ${weekTracker ? `
        <tr>
          <td style="padding:10px 18px 20px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse; background:rgba(139,92,246,0.06); border:1px solid ${COLORS.borderSoft}; border-radius:12px;">
              <tr>
                <td style="padding:16px 12px 14px;">
                  ${weekTracker}
                </td>
              </tr>
            </table>
          </td>
        </tr>
        ` : `
        <tr>
          <td style="padding:0 18px 18px; font-size:0; line-height:0;">&nbsp;</td>
        </tr>
        `}
      </table>
    </td>
  `;
}

function buildSparksSectionHtml(report, strings) {
  const sparksEarned = report?.sparks?.earnedThisWeek ?? 0;
  const sparksBalance = report?.sparks?.currentBalance ?? 0;

  const body = `
    <p style="margin:0 0 4px; font-size:11px; letter-spacing:0.08em; text-transform:uppercase; color:${COLORS.textMuted}; font-weight:700;">${strings.sparksEarnedLabel}</p>
    <p style="margin:0 0 18px; font-size:28px; font-weight:800; line-height:1; color:${COLORS.text}; letter-spacing:-0.02em;">+${sparksEarned}</p>
    <p style="margin:0 0 6px; font-size:11px; letter-spacing:0.08em; text-transform:uppercase; color:${COLORS.textMuted}; font-weight:700;">${strings.sparksBalanceLabel}</p>
    <p style="margin:0; font-size:42px; font-weight:900; line-height:1; color:${COLORS.sparks}; letter-spacing:-0.03em; text-shadow:0 0 22px ${COLORS.sparksGlow};">
      <span style="font-size:30px; vertical-align:middle;">⚡</span> ${sparksBalance}
    </p>
  `;

  return buildSectionCard(strings.sparksTitle, '⚡', COLORS.sparks, body);
}

function buildRankSectionHtml(report, strings) {
  const level = report?.rank?.level ?? 1;
  const rankRoman = escapeHtml(report?.rank?.rankRoman ?? 'I');
  const rankName = escapeHtml(report?.rank?.rankName ?? 'Explorer');
  const progress = report?.rank?.levelProgressPercent ?? 0;
  const xpInLevel = report?.rank?.xpInCurrentLevel ?? 0;
  const xpNeeded = report?.rank?.xpNeededForLevel ?? 1;

  const body = `
    <p style="margin:0 0 4px; font-size:11px; letter-spacing:0.08em; text-transform:uppercase; color:${COLORS.textMuted}; font-weight:700;">${strings.rankLevelLabel}</p>
    <p style="margin:0 0 4px; font-size:36px; font-weight:900; color:${COLORS.rankGold}; line-height:1; letter-spacing:-0.03em;">
      ${rankRoman}<span style="font-size:22px; color:${COLORS.textMuted}; font-weight:700;"> · </span>Lv.${level}
    </p>
    <p style="margin:0 0 14px; font-size:14px; color:${COLORS.text}; font-weight:700;">${rankName}</p>
    ${buildProgressBarHtml(progress, COLORS.rankGold)}
    <p style="margin:12px 0 0; font-size:12px; color:${COLORS.textDim}; font-weight:600;">${xpInLevel} / ${xpNeeded} XP · ${progress}%</p>
  `;

  return buildSectionCard(strings.rankTitle, '👑', COLORS.rankGold, body);
}

function buildQuestsFullWidthSection(questHtml, strings) {
  return `
    <tr>
      <td style="padding:8px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse; background:${COLORS.cardInner}; border:1px solid ${COLORS.borderSoft}; border-radius:12px;">
          <tr>
            <td style="padding:18px;">
              <p style="margin:0 0 14px; font-size:11px; letter-spacing:0.14em; text-transform:uppercase; color:#c084fc; font-weight:700;">
                ⚔️ ${strings.questsTitle}
              </p>
              ${questHtml}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  `;
}

function getWeeklyChronicleEmailContent(report, { appUrl, year, logoUrl } = {}) {
  const language = resolveLanguage(report?.language);
  const userName = escapeHtml(report?.userName || 'Hero');
  const weekRange = formatWeekRange(report.weekStart, report.weekEnd, language);
  const copyrightYear = String(year ?? new Date().getFullYear());
  const loginUrl = appUrl || 'https://ignite-me.app';
  const brandLogoUrl = logoUrl || `${loginUrl}/awa.png`;

  const strings = language === 'ru'
    ? {
      subject: `Летопись легенды · ${weekRange}`,
      eyebrow: 'Еженедельная летопись',
      greeting: `Приветствую, ${userName}`,
      intro: `Сводка вашего пути за ${weekRange}. Каждый ритуал и каждый шаг приближают вас к новому рангу.`,
      ritualsTitle: 'Ритуалы',
      ritualsEmpty: 'Без активных ритуалов',
      questsTitle: 'Эпические квесты',
      sparksTitle: 'Искры',
      sparksEarnedLabel: 'Заработано за неделю',
      sparksBalanceLabel: 'Текущий баланс',
      rankTitle: 'Ранг',
      rankLevelLabel: 'Ваш уровень',
      cta: 'Открыть Ignite',
      footer: `© ${copyrightYear} Ignite. Вы получили это письмо, потому что включили «Еженедельную летопись» в настройках профиля.`
    }
    : {
      subject: `Legend Chronicle · ${weekRange}`,
      eyebrow: 'Weekly Chronicle',
      greeting: `Greetings, ${userName}`,
      intro: `Your journey summary for ${weekRange}. Every ritual and every step brings you closer to the next rank.`,
      ritualsTitle: 'Rituals',
      ritualsEmpty: 'No active rituals',
      questsTitle: 'Epic Quests',
      sparksTitle: 'Sparks',
      sparksEarnedLabel: 'Earned this week',
      sparksBalanceLabel: 'Current balance',
      rankTitle: 'Rank',
      rankLevelLabel: 'Your level',
      cta: 'Open Ignite',
      footer: `© ${copyrightYear} Ignite. You received this email because weekly chronicle is enabled in your profile settings.`
    };

  const questHtml = buildQuestHtml(report.quests, language);
  const questText = buildQuestLines(report.quests, language);
  const ritualsCompleted = report?.rituals?.completedTotal ?? 0;
  const ritualsScheduled = report?.rituals?.scheduledTotal ?? 0;
  const ritualsRate = report?.rituals?.completionRate;
  const sparksEarned = report?.sparks?.earnedThisWeek ?? 0;
  const sparksBalance = report?.sparks?.currentBalance ?? 0;
  const level = report?.rank?.level ?? 1;
  const rankRoman = report?.rank?.rankRoman ?? 'I';
  const rankName = report?.rank?.rankName ?? 'Explorer';
  const rankProgress = report?.rank?.levelProgressPercent ?? 0;

  const ritualsLine = ritualsScheduled > 0
    ? `${language === 'ru' ? 'Рейтинг дисциплины' : 'Discipline Rating'}: ${ritualsRate}%. ${buildRitualsDisciplineSubtext(ritualsCompleted, language)}`
    : strings.ritualsEmpty;

  const html = `
<!DOCTYPE html>
<html lang="${language}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${strings.eyebrow}</title>
  <style>
    body, table, td { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
    table, td { mso-table-lspace:0pt; mso-table-rspace:0pt; }
    img { -ms-interpolation-mode:bicubic; border:0; outline:none; text-decoration:none; }
    @media only screen and (max-width:620px) {
      .container { width:100% !important; }
      .stack-column { display:block !important; width:100% !important; max-width:100% !important; }
      .hero-title { font-size:28px !important; }
      .logo-img { width:56px !important; height:56px !important; }
    }
  </style>
</head>
<body style="margin:0; padding:0; background:${COLORS.bg}; color:${COLORS.text}; font-family:Georgia, 'Times New Roman', serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse; background:${COLORS.bg};">
    <tr>
      <td align="center" style="padding:24px 12px 32px;">
        <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse; width:100%; max-width:600px;">
          <tr>
            <td align="center" style="padding:0 0 18px;">
              <img class="logo-img" src="${escapeHtml(brandLogoUrl)}" width="72" height="72" alt="Ignite" style="display:block; width:72px; height:72px; border-radius:18px; box-shadow:0 0 24px ${COLORS.accentSoft};">
            </td>
          </tr>

          <tr>
            <td style="background:${COLORS.card}; border:1px solid ${COLORS.border}; border-radius:12px; overflow:hidden; box-shadow:0 24px 60px rgba(0,0,0,0.45);">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
                <tr>
                  <td style="padding:28px 28px 0; background:linear-gradient(180deg, rgba(139,92,246,0.12) 0%, rgba(18,18,26,0) 100%);">
                    <p style="margin:0 0 10px; font-family:Arial, Helvetica, sans-serif; font-size:11px; letter-spacing:0.18em; text-transform:uppercase; color:${COLORS.accent}; font-weight:700; text-align:center;">
                      ${strings.eyebrow}
                    </p>
                    <h1 class="hero-title" style="margin:0 0 12px; font-size:34px; line-height:1.15; font-weight:700; color:${COLORS.text}; text-align:center;">
                      ${strings.greeting}
                    </h1>
                    <p style="margin:0; font-family:Arial, Helvetica, sans-serif; font-size:14px; line-height:1.65; color:${COLORS.textMuted}; text-align:center;">
                      ${strings.intro}
                    </p>
                  </td>
                </tr>

                <tr>
                  <td style="padding:24px 20px 8px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
                      <tr>
                        ${buildRitualsSectionHtml(report, strings, language)}
                      </tr>
                      <tr>
                        ${buildSparksSectionHtml(report, strings)}
                        ${buildRankSectionHtml(report, strings)}
                      </tr>
                      <tr>
                        <td class="stack-column" width="50%" valign="top" style="padding:8px;">
                          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse; background:${COLORS.cardInner}; border:1px solid ${COLORS.borderSoft}; border-radius:12px; height:100%;">
                            <tr>
                              <td style="padding:18px; font-family:Arial, Helvetica, sans-serif;">
                                <p style="margin:0 0 8px; font-size:11px; letter-spacing:0.14em; text-transform:uppercase; color:${COLORS.success}; font-weight:700;">📜 ${language === 'ru' ? 'Период' : 'Period'}</p>
                                <p style="margin:0; font-size:15px; line-height:1.5; color:${COLORS.text}; font-weight:600;">${escapeHtml(weekRange)}</p>
                                <p style="margin:12px 0 0; font-size:12px; line-height:1.55; color:${COLORS.textMuted};">${language === 'ru' ? 'Ваш личный дашборд прогресса за прошедшую неделю.' : 'Your personal progress dashboard for the past week.'}</p>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                      ${buildQuestsFullWidthSection(questHtml, strings)}
                    </table>
                  </td>
                </tr>

                <tr>
                  <td align="center" style="padding:8px 20px 28px;">
                    <a href="${loginUrl}"
                       style="display:inline-block; min-width:220px; padding:15px 32px; background:linear-gradient(135deg, #7c3aed 0%, #8b5cf6 45%, #a78bfa 100%); color:#ffffff; text-decoration:none; border-radius:999px; font-family:Arial, Helvetica, sans-serif; font-size:15px; font-weight:800; letter-spacing:0.04em; text-transform:uppercase; box-shadow:0 10px 30px rgba(139,92,246,0.35), inset 0 1px 0 rgba(255,255,255,0.18);">
                      ${strings.cta}
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:18px 8px 0; font-family:Arial, Helvetica, sans-serif; font-size:11px; line-height:1.6; color:${COLORS.textDim}; text-align:center;">
              ${strings.footer}
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
    strings.greeting,
    '',
    strings.intro,
    '',
    `${strings.ritualsTitle}: ${ritualsLine}`,
    '',
    `${strings.questsTitle}:`,
    questText,
    '',
    `${strings.sparksTitle}: +${sparksEarned} ${language === 'ru' ? 'за неделю' : 'this week'}, ${language === 'ru' ? 'баланс' : 'balance'} ${sparksBalance}.`,
    '',
    `${strings.rankTitle}: Lv.${level} · ${rankRoman} (${rankName}) · ${rankProgress}% ${language === 'ru' ? 'до след. уровня' : 'to next level'}.`,
    '',
    `${strings.cta}: ${loginUrl}`,
    '',
    strings.footer
  ].join('\n');

  return {
    subject: strings.subject,
    html,
    text
  };
}

module.exports = {
  getWeeklyChronicleEmailContent,
  resolveLanguage,
  formatWeekRange
};
