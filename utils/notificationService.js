const Notification = require('../models/Notification');
const User = require('../models/User');
const { sendPushNotification } = require('./pushService');
const { getLocalizedCommentPush, getLocalizedDailyRecap } = require('./notificationMessages');

async function createNotificationWithPush({
  userId,
  type,
  notificationFields = {},
  push
}) {
  const notification = await Notification.create({
    userId,
    type,
    read: false,
    ...notificationFields
  });

  if (push) {
    await sendPushNotification(userId, {
      title: push.title,
      body: push.body,
      tag: push.tag,
      data: {
        notificationId: notification._id.toString(),
        type,
        ...push.data
      }
    });
  }

  return notification;
}

/** In-app + push notification for diary activity (owner comment or @mention in reply). */
async function notifyChallengeCommentRecipient({
  recipientUserId,
  fromUserId,
  challenge,
  type,
  commentId,
  replyId = null
}) {
  if (!recipientUserId || !fromUserId || !challenge) return;
  if (recipientUserId.toString() === fromUserId.toString()) return;

  try {
    const [fromUser, recipientUser] = await Promise.all([
      User.findById(fromUserId).select('name'),
      User.findById(recipientUserId).select('dailyRecapLanguage')
    ]);
    const fromName = fromUser?.name;
    const missionTitle = challenge.title;
    const isReplyToUser = type === 'mention' || replyId != null;
    const { title: pushTitle, body: pushBody } = getLocalizedCommentPush(
      type,
      fromName,
      missionTitle,
      recipientUser?.dailyRecapLanguage,
      isReplyToUser
    );

    await createNotificationWithPush({
      userId: recipientUserId,
      type,
      notificationFields: {
        challengeId: challenge._id,
        commentId: commentId || null,
        replyId: replyId || null,
        fromUserId
      },
      push: {
        title: pushTitle,
        body: pushBody,
        tag: `challenge-${challenge._id}`,
        data: {
          challengeId: challenge._id.toString()
        }
      }
    });
  } catch (notificationError) {
    console.error('Error creating comment/mention notification:', notificationError);
  }
}

async function notifyChallengeJoin({ ownerId, fromUserId, challenge }) {
  if (!ownerId || !fromUserId || !challenge) return;
  if (ownerId.toString() === fromUserId.toString()) return;

  try {
    const fromUser = await User.findById(fromUserId).select('name');
    const fromName = fromUser?.name || 'Someone';

    await createNotificationWithPush({
      userId: ownerId,
      type: 'join',
      notificationFields: {
        challengeId: challenge._id,
        fromUserId
      },
      push: {
        title: 'New Participant',
        body: `${fromName} joined your challenge "${challenge.title}"`,
        tag: `challenge-${challenge._id}`,
        data: {
          challengeId: challenge._id.toString()
        }
      }
    });
  } catch (notificationError) {
    console.error('Error creating join notification:', notificationError);
  }
}

async function notifyChallengeWatch({ ownerId, fromUserId, challenge }) {
  if (!ownerId || !fromUserId || !challenge) return;
  if (ownerId.toString() === fromUserId.toString()) return;

  try {
    const fromUser = await User.findById(fromUserId).select('name');
    const fromName = fromUser?.name || 'Someone';

    await createNotificationWithPush({
      userId: ownerId,
      type: 'watch',
      notificationFields: {
        challengeId: challenge._id,
        fromUserId
      },
      push: {
        title: 'New Follower',
        body: `${fromName} started watching your challenge "${challenge.title}"`,
        tag: `challenge-${challenge._id}`,
        data: {
          challengeId: challenge._id.toString()
        }
      }
    });
  } catch (notificationError) {
    console.error('Error creating watch notification:', notificationError);
  }
}

async function sendDailyRecapNotification(user, localDate) {
  const { title, body } = getLocalizedDailyRecap(user.dailyRecapLanguage);

  await createNotificationWithPush({
    userId: user._id,
    type: 'daily_recap',
    notificationFields: {
      title,
      body,
      localDate
    },
    push: {
      title,
      body,
      tag: 'daily-recap',
      data: {
        type: 'daily-recap',
        localDate
      }
    }
  });
}

async function notifyReferralCompleted({ referrerId, refereeId, refereeName }) {
  if (!referrerId || !refereeId) return;

  try {
    const title = 'Referral reward';
    const body = `Your friend ${refereeName} accepted a challenge! You both received 50 Sparks. Keep it up!`;

    await createNotificationWithPush({
      userId: referrerId,
      type: 'referral_completed',
      notificationFields: {
        fromUserId: refereeId,
        title,
        body
      },
      push: {
        title,
        body,
        tag: `referral-${refereeId}`,
        data: {
          type: 'referral_completed',
          fromUserId: refereeId.toString()
        }
      }
    });
  } catch (notificationError) {
    console.error('Error creating referral completed notification:', notificationError);
  }
}

module.exports = {
  createNotificationWithPush,
  notifyChallengeCommentRecipient,
  notifyChallengeJoin,
  notifyChallengeWatch,
  sendDailyRecapNotification,
  notifyReferralCompleted
};
