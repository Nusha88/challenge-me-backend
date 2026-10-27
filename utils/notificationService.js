const Notification = require('../models/Notification');
const User = require('../models/User');
const { sendPushNotification } = require('./pushService');
const { getLocalizedCommentPush, getLocalizedDailyRecap, getLocalizedFriendRequestPush, getLocalizedMissionInvitePush, getLocalizedCheerPush } = require('./notificationMessages');

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

  let pushResult = null;
  if (push) {
    pushResult = await sendPushNotification(userId, {
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

  return { notification, pushResult };
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

  const { notification, pushResult } = await createNotificationWithPush({
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

  // Transient push failure → throw so the scheduler does NOT mark the recap
  // as sent and retries on the next tick. Permanent failures (subscription
  // gone/pruned) are not retryable, so we let the marker advance. The in-app
  // row is removed first so the retry doesn't create duplicates.
  if (pushResult && !pushResult.delivered && !pushResult.permanent) {
    await Notification.deleteOne({ _id: notification._id }).catch(() => {});
    throw new Error(`Daily recap push failed transiently (${pushResult.reason})`);
  }
}

async function notifyFriendRequest({ recipientId, fromUserId, friendshipId }) {
  if (!recipientId || !fromUserId || !friendshipId) return;
  if (recipientId.toString() === fromUserId.toString()) return;

  try {
    const existing = await Notification.findOne({
      userId: recipientId,
      fromUserId,
      type: 'friend_request',
      read: false
    }).select('_id').lean();
    if (existing) return;

    const [fromUser, recipientUser] = await Promise.all([
      User.findById(fromUserId).select('name'),
      User.findById(recipientId).select('dailyRecapLanguage')
    ]);
    const { title, body } = getLocalizedFriendRequestPush(
      fromUser?.name,
      recipientUser?.dailyRecapLanguage
    );

    await createNotificationWithPush({
      userId: recipientId,
      type: 'friend_request',
      notificationFields: {
        fromUserId,
        friendshipId,
        title,
        body
      },
      push: {
        title,
        body,
        tag: `friend-request-${fromUserId}`,
        data: {
          type: 'friend_request',
          fromUserId: fromUserId.toString(),
          friendshipId: friendshipId.toString()
        }
      }
    });
  } catch (notificationError) {
    console.error('Error creating friend request notification:', notificationError);
  }
}

async function notifyMissionInvite({ recipientId, fromUserId, challenge }) {
  if (!recipientId || !fromUserId || !challenge?._id) return;
  if (recipientId.toString() === fromUserId.toString()) return;

  try {
    const existing = await Notification.findOne({
      userId: recipientId,
      challengeId: challenge._id,
      type: 'mission_invite',
      read: false
    }).select('_id').lean();
    if (existing) return;

    const [fromUser, recipientUser] = await Promise.all([
      User.findById(fromUserId).select('name'),
      User.findById(recipientId).select('dailyRecapLanguage')
    ]);
    const { title, body } = getLocalizedMissionInvitePush(
      fromUser?.name,
      challenge.title,
      recipientUser?.dailyRecapLanguage
    );

    await createNotificationWithPush({
      userId: recipientId,
      type: 'mission_invite',
      notificationFields: {
        fromUserId,
        challengeId: challenge._id,
        title,
        body
      },
      push: {
        title,
        body,
        tag: `mission-invite-${challenge._id}`,
        data: {
          type: 'mission_invite',
          challengeId: challenge._id.toString(),
          fromUserId: fromUserId.toString()
        }
      }
    });
  } catch (notificationError) {
    console.error('Error creating mission invite notification:', notificationError);
  }
}

async function notifyCheer({ recipientId, fromUserId, challengeId = null, activityId = null }) {
  if (!recipientId || !fromUserId) return;
  if (recipientId.toString() === fromUserId.toString()) return;

  try {
    const [fromUser, recipientUser] = await Promise.all([
      User.findById(fromUserId).select('name'),
      User.findById(recipientId).select('dailyRecapLanguage')
    ]);
    const { title, body } = getLocalizedCheerPush(
      fromUser?.name,
      recipientUser?.dailyRecapLanguage
    );
    const challengeObjectId = challengeId?._id || challengeId || null;
    const activityKey = activityId?._id || activityId || fromUserId;

    await createNotificationWithPush({
      userId: recipientId,
      type: 'cheer',
      notificationFields: {
        fromUserId,
        challengeId: challengeObjectId,
        title,
        body
      },
      push: {
        title,
        body,
        tag: `cheer-${activityKey}`,
        data: {
          type: 'cheer',
          fromUserId: fromUserId.toString(),
          ...(challengeObjectId ? { challengeId: challengeObjectId.toString() } : {})
        }
      }
    });
  } catch (notificationError) {
    console.error('Error creating cheer notification:', notificationError);
  }
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
  notifyFriendRequest,
  notifyMissionInvite,
  notifyCheer,
  notifyReferralCompleted
};
