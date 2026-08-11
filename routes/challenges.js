const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Challenge = require('../models/Challenge');
const User = require('../models/User');
const authenticateToken = require('../middleware/authenticateToken');
const { getClientDayRange, getClientLocalHour, normalizeDateLikeToYmd } = require('../utils/dateHelpers');
const { findByClientDay, upsertChecklist } = require('../utils/dailyChecklistService');
const {
  isResultChallengeCompleted,
  isHabitChallengeCompleted,
  collectNewlyCheckedActionIds,
  applyReactionPublicFields,
  enrichChallengesWithWatchState,
  findMainRitualChallenge,
  isChallengeFinished,
  isMissionActiveOnClientDay,
  isMissionFinishedForCommentSparks,
  findChallengeParticipant,
  getInclusiveDaysBetween,
  resetActionsChecked,
  isDayEffectiveCompleted,
  appendUniqueParticipantDay,
  isDateScheduledForChallenge
} = require('../utils/challengeHelpers');
const {
  notifyChallengeCommentRecipient,
  notifyChallengeJoin,
  notifyChallengeWatch
} = require('../utils/notificationService');
const { getWelcomeBonusRewardPayload } = require('../utils/referralService');
const {
  awardHabitDayXp,
  awardHabitCompletionXp,
  awardTieredHabitCompletionXp,
  awardResultActionXp,
  awardResultCompletionXp
} = require('../utils/xpService');
const {
  awardHabitDaySparks,
  awardMissionCompletionSparks,
  awardTieredMissionCompletionSparks,
  awardMissionCommentSparks,
  awardChecklistTaskSparks,
  awardQuestActionSparks,
  spendSparksOnce
} = require('../utils/sparksService');
const {
  buildResultActionChecklistTaskKey,
  SPARKS_AMOUNTS,
  buildMissionExtendSparksKey,
  buildSecondChanceSparksKey
} = require('../constants/sparksRules');
const { buildRewardPayload } = require('../utils/rewardResponse');
const { buildMissionRewardSummary } = require('../utils/missionRewardSummary');
const {
  buildHabitMissionRewardSummary,
  getParticipantJoinedAtKey,
  getSoloContinuationDates,
  isMissionFinalDay,
  needsSoloContinuation
} = require('../utils/missionTierService');
const { buildWatchedFeedActivities } = require('../utils/watchedFeedService');
const { clearReactivationStreakFlag } = require('../utils/reactivationService');

function serializeUserForClient(user) {
  if (!user) return null;
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl,
    xp: user.xp || 0,
    sparks: user.sparks || 0,
    createdAt: user.createdAt
  };
}

async function maybeAwardMissionCommentSparks(req, userId, challenge, ownerId) {
  let finalUser = userId
    ? await User.findById(userId).select('name email avatarUrl xp sparks createdAt _id')
    : null;
  const sparksResults = [];

  if (!userId) {
    return { finalUser, sparksResults };
  }

  const { clientDayStr } = getClientDayRange(req, 0);
  const isActive = isMissionActiveOnClientDay(challenge, clientDayStr);
  const isFinished = isMissionFinishedForCommentSparks(challenge, clientDayStr);
  const isNotOwner = ownerId && userId.toString() !== ownerId.toString();

  if (isActive && !isFinished && isNotOwner) {
    const sparksResult = await awardMissionCommentSparks(userId, challenge._id, clientDayStr);
    sparksResults.push(sparksResult);
    if (sparksResult.awarded && sparksResult.user) {
      finalUser = sparksResult.user;
    }
  }

  return { finalUser, sparksResults };
}

// Returns the authenticated user id if a valid token is present, else null.
// Used by public/optional endpoints for personalization.
const decodeOptionalAuthUserId = authenticateToken.getOptionalUserId;

// Escapes user input before using it inside a MongoDB $regex to avoid
// ReDoS / expensive-pattern denial of service.
function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Normalize and validate nested result-challenge actions.
 * Returns { ok: true, actions } or { ok: false, message }.
 */
function sanitizeChallengeActions(rawActions, { requireNonEmpty = false } = {}) {
  if (rawActions === undefined) {
    return { ok: true, actions: undefined };
  }

  if (!Array.isArray(rawActions)) {
    return { ok: false, message: 'Actions must be an array' };
  }

  const actions = rawActions.map((action) => {
    const text = typeof action?.text === 'string' ? action.text.trim() : '';
    const children = Array.isArray(action?.children)
      ? action.children.map((child) => {
          const childText = typeof child?.text === 'string' ? child.text.trim() : '';
          const normalizedChild = {
            text: childText,
            checked: Boolean(child?.checked)
          };
          if (child?._id) normalizedChild._id = child._id;
          return normalizedChild;
        }).filter((child) => child.text)
      : [];

    const normalized = {
      text,
      checked: Boolean(action?.checked),
      children
    };
    if (action?._id) normalized._id = action._id;
    return normalized;
  }).filter((action) => action.text || (action.children && action.children.length > 0));

  if (requireNonEmpty) {
    const hasFilled = actions.some((action) => action.text);
    if (!hasFilled) {
      return { ok: false, message: 'At least one action with text is required' };
    }
  }

  // Drop empty-text parents that somehow remain without children
  const cleaned = actions.filter((action) => action.text);
  if (requireNonEmpty && cleaned.length === 0) {
    return { ok: false, message: 'At least one action with text is required' };
  }

  return { ok: true, actions: cleaned };
}

/** Clone result actions for a renewed mission (new ids, unchecked). */
function cloneActionsUnchecked(rawActions) {
  if (!Array.isArray(rawActions)) return [];

  return rawActions
    .map((action) => {
      const text = typeof action?.text === 'string' ? action.text.trim() : '';
      const children = Array.isArray(action?.children)
        ? action.children
            .map((child) => {
              const childText = typeof child?.text === 'string' ? child.text.trim() : '';
              return childText ? { text: childText, checked: false } : null;
            })
            .filter(Boolean)
        : [];

      if (!text && children.length === 0) return null;
      return {
        text,
        checked: false,
        children
      };
    })
    .filter(Boolean);
}

function flattenResultActionStates(actions) {
  const map = new Map();
  if (!Array.isArray(actions)) return map;
  for (const a of actions) {
    const id = a._id != null ? String(a._id) : null;
    if (id) {
      map.set(id, {
        checked: !!a.checked,
        text: typeof a.text === 'string' ? a.text.trim() : ''
      });
    }
    if (Array.isArray(a.children)) {
      for (const c of a.children) {
        const cid = c._id != null ? String(c._id) : null;
        if (cid) {
          map.set(cid, {
            checked: !!c.checked,
            text: typeof c.text === 'string' ? c.text.trim() : ''
          });
        }
      }
    }
  }
  return map;
}

function diffResultActionCheckStates(prevActions, nextActions) {
  const prevMap = flattenResultActionStates(prevActions);
  const nextMap = flattenResultActionStates(nextActions);
  const newlyChecked = [];
  const newlyUnchecked = [];
  for (const [id, next] of nextMap) {
    const prev = prevMap.get(id);
    const wasChecked = prev ? prev.checked : false;
    if (next.checked && !wasChecked) {
      newlyChecked.push({ id, text: next.text });
    }
    if (!next.checked && wasChecked) {
      newlyUnchecked.push({ id });
    }
  }
  return { newlyChecked, newlyUnchecked };
}

function taskMatchesResultActionSource(task, challengeId, actionId) {
  const s = task.source;
  if (!s || s.kind !== 'resultAction') return false;
  const cid = s.challengeId != null ? String(s.challengeId) : '';
  return cid === String(challengeId) && String(s.actionId) === String(actionId);
}

async function syncTodayChecklistForResultActions(userId, legacyChecklists, req, challenge, prevActions, nextActions) {
  if (challenge.challengeType !== 'result') return;
  const { newlyChecked, newlyUnchecked } = diffResultActionCheckStates(prevActions, nextActions);
  if (newlyChecked.length === 0 && newlyUnchecked.length === 0) return;

  const { startUtc: todayStartUtc, endUtc: todayEndUtc, clientDayStr: todayStr } = getClientDayRange(req, 0);
  const challengeId = challenge._id;
  const missionTitle = (challenge.title && String(challenge.title).trim()) || 'Mission';

  const existingTodayChecklist = await findByClientDay(
    userId,
    todayStr,
    legacyChecklists,
    todayStartUtc,
    todayEndUtc
  );

  const tasks = [];
  if (existingTodayChecklist && Array.isArray(existingTodayChecklist.tasks)) {
    for (const t of existingTodayChecklist.tasks) {
      const plain = t.toObject ? t.toObject() : { ...t };
      const task = {
        title: plain.title,
        done: !!plain.done
      };
      if (plain.source && plain.source.kind) {
        task.source = {
          kind: plain.source.kind,
          challengeId: plain.source.challengeId,
          actionId: plain.source.actionId != null ? String(plain.source.actionId) : undefined
        };
      }
      tasks.push(task);
    }
  }

  for (const { id } of newlyUnchecked) {
    const idx = tasks.findIndex(task => taskMatchesResultActionSource(task, challengeId, id));
    if (idx >= 0) tasks.splice(idx, 1);
  }

  for (const { id, text } of newlyChecked) {
    const actionLabel = text || '';
    const title = `${missionTitle}: ${actionLabel}`;
    const idx = tasks.findIndex(task => taskMatchesResultActionSource(task, challengeId, id));
    if (idx >= 0) {
      tasks[idx].title = title;
      tasks[idx].done = true;
    } else {
      tasks.push({
        title,
        done: true,
        source: {
          kind: 'resultAction',
          challengeId,
          actionId: id
        }
      });
    }
  }

  await upsertChecklist({
    userId,
    localDate: todayStr,
    timeZone: 'UTC',
    tasks,
    anchorDate: todayStartUtc
  });
}

function isChallengeCompleted(challenge, today) {
  // Check if endDate is in the past
  if (challenge.endDate) {
    try {
      const endDate = new Date(challenge.endDate);
      endDate.setHours(0, 0, 0, 0);
      if (endDate < today) {
        return true; // Challenge ended
      }
    } catch (e) {
      // Continue if date parsing fails
    }
  }
  
  // For result challenges, check if all actions are done
  if (challenge.challengeType === 'result') {
    if (!challenge.actions || !Array.isArray(challenge.actions) || challenge.actions.length === 0) {
      return false; // Not completed if no actions
    }
    
    // Check if all actions and their children are checked
    const allActionsDone = challenge.actions.every(action => {
      // Parent action must be checked
      if (!action.checked) return false;
      
      // All children must be checked (if any exist)
      if (action.children && Array.isArray(action.children) && action.children.length > 0) {
        return action.children.every(child => child.checked);
      }
      
      return true;
    });
    
    return allActionsDone;
  }
  
  return false; // Not completed
}

// Create challenge
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { title, description, startDate, endDate, imageUrl, privacy, challengeType, frequency, actions, allowComments, difficulty, reward } = req.body;
    // Owner is always the authenticated user, never taken from the body.
    const owner = req.user.id;

    if (!title || !startDate || !endDate) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    const challengeData = { 
      title, 
      description: description || '', 
      startDate, 
      endDate, 
      owner, 
      difficulty: difficulty || 'medium',
      participants: [{ userId: owner, completedDays: [], joinedAt: new Date(startDate) }] 
    };
    if (imageUrl) {
      challengeData.imageUrl = imageUrl;
    }
    if (privacy) {
      challengeData.privacy = privacy;
    }
    if (challengeType) {
      challengeData.challengeType = challengeType;
    }
    // Only set frequency for habit challenges, don't include it for result challenges
    if (challengeType === 'habit' && frequency) {
      challengeData.frequency = frequency;
    }
    // Explicitly don't set frequency for result challenges
    if (challengeType === 'result') {
      delete challengeData.frequency;
      const sanitized = sanitizeChallengeActions(actions, { requireNonEmpty: true });
      if (!sanitized.ok) {
        return res.status(400).json({ message: sanitized.message });
      }
      challengeData.actions = sanitized.actions;
      challengeData.reward = typeof reward === 'string' ? reward.trim() : '';
    }
    if (allowComments !== undefined) {
      challengeData.allowComments = allowComments;
    }

    const challenge = new Challenge(challengeData);
    await challenge.save();

    const welcomeBonusPayload = await getWelcomeBonusRewardPayload(owner, serializeUserForClient);

    res.status(201).json({
      message: 'Challenge created successfully',
      challenge,
      ...welcomeBonusPayload
    });
  } catch (error) {
    res.status(500).json({ message: 'Error creating challenge', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
});

// Update challenge actions progress (Result Challenges)
router.patch('/:id/actions', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { actions } = req.body;

    if (!actions || !Array.isArray(actions)) {
      return res.status(400).json({ message: 'Actions array is required' });
    }

    const sanitized = sanitizeChallengeActions(actions, { requireNonEmpty: true });
    if (!sanitized.ok) {
      return res.status(400).json({ message: sanitized.message });
    }

    const challenge = await Challenge.findById(id);
    if (!challenge) {
      return res.status(404).json({ message: 'Challenge not found' });
    }

    if (challenge.challengeType !== 'result' && challenge.challengeType !== 'habit') {
      return res.status(400).json({ message: 'This route is only for result or habit challenges' });
    }

    const authUserId = req.user.id;

    // Security check: only owner can update progress of result challenge
    const ownerId = challenge.owner?._id || challenge.owner;
    if (authUserId.toString() !== ownerId.toString()) {
      return res.status(403).json({ message: 'You are not authorized to update this challenge' });
    }

    const prevActions = JSON.parse(JSON.stringify(challenge.actions || []));
    const wasCompletedBefore = isResultChallengeCompleted(prevActions);

    challenge.actions = sanitized.actions;
    await challenge.save();

    const isCompletedNow = isResultChallengeCompleted(challenge.actions);

    const user = await User.findById(authUserId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    let updatedUser = user;
    const xpResults = [];
    const sparksResults = [];

    if (challenge.challengeType === 'result') {
      const newlyCheckedActionIds = collectNewlyCheckedActionIds(
        prevActions,
        challenge.actions
      );
      const { clientDayStr: todayStr } = getClientDayRange(req, 0);

      for (const actionId of newlyCheckedActionIds) {
        const xpResult = await awardResultActionXp(authUserId, challenge._id, actionId);
        xpResults.push(xpResult);
        if (xpResult.awarded && xpResult.user) {
          updatedUser = xpResult.user;
        }

        const sparksResult = await awardChecklistTaskSparks(
          authUserId,
          todayStr,
          buildResultActionChecklistTaskKey(challenge._id, actionId)
        );
        sparksResults.push(sparksResult);
        if (sparksResult.awarded && sparksResult.user) {
          updatedUser = sparksResult.user;
        }
      }

      if (!wasCompletedBefore && isCompletedNow) {
        const completionXpResult = await awardResultCompletionXp(authUserId, challenge);
        xpResults.push(completionXpResult);
        if (completionXpResult.awarded && completionXpResult.user) {
          updatedUser = completionXpResult.user;
        }

        const missionSparksResult = await awardMissionCompletionSparks(authUserId, challenge._id);
        sparksResults.push(missionSparksResult);
        if (missionSparksResult.awarded && missionSparksResult.user) {
          updatedUser = missionSparksResult.user;
        }
      }
    }

    if (challenge.challengeType === 'result') {
      try {
        const userForChecklist = await User.findById(authUserId).select('dailyChecklists');
        if (userForChecklist) {
          await syncTodayChecklistForResultActions(
            userForChecklist._id,
            userForChecklist.dailyChecklists,
            req,
            challenge,
            prevActions,
            actions
          );
        }
      } catch (syncErr) {
        console.error('Error syncing result actions to daily checklist:', syncErr);
      }
    }

    const rewardPayload = buildRewardPayload({
      user: serializeUserForClient(await User.findById(authUserId).select('name email avatarUrl xp sparks createdAt _id')),
      xpResults,
      sparksResults
    });

    res.json({
      message: 'Actions updated successfully',
      challenge,
      ...rewardPayload
    });
  } catch (error) {
    res.status(500).json({ message: 'Error updating actions', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
});

// Complete a single quest (result) action, optionally with a diary report
router.post('/:id/actions/:actionId/complete', authenticateToken, async (req, res) => {
  try {
    const { id, actionId } = req.params;
    const { mode = 'check', text, imageUrl, shareToCommunity } = req.body;

    const reportText = (text && String(text).trim()) ? String(text).trim() : '';
    const reportImageRaw = imageUrl ? String(imageUrl).trim() : '';
    const reportImage = reportImageRaw || null;

    if (mode === 'report' && !reportText && !reportImage) {
      return res.status(400).json({ message: 'Report text or image is required' });
    }

    if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(actionId)) {
      return res.status(400).json({ message: 'Invalid challenge or action id' });
    }

    const challenge = await Challenge.findById(id);
    if (!challenge) {
      return res.status(404).json({ message: 'Challenge not found' });
    }

    if (challenge.challengeType !== 'result') {
      return res.status(400).json({ message: 'This route is only for result challenges' });
    }

    const authUserId = req.user.id;

    const ownerId = challenge.owner?._id || challenge.owner;
    if (authUserId.toString() !== ownerId.toString()) {
      return res.status(403).json({ message: 'You are not authorized to update this challenge' });
    }

    const action = challenge.actions.id(actionId);
    if (!action) {
      return res.status(404).json({ message: 'Action not found' });
    }

    const wasAlreadyChecked = !!action.checked;
    const prevActions = JSON.parse(JSON.stringify(challenge.actions || []));
    const wasCompletedBefore = isResultChallengeCompleted(prevActions);

    if (!wasAlreadyChecked) {
      action.checked = true;
      if (Array.isArray(action.children)) {
        action.children.forEach((child) => { child.checked = true; });
      }
    }

    let entry = null;
    let sharedCommentId = null;

    if (mode === 'report') {
      challenge.userDiaryEntries.push({
        userId: authUserId,
        text: reportText,
        imageUrl: reportImage,
        actionTitle: action.text || '',
        actionId: action._id,
        createdAt: new Date()
      });

      if (shareToCommunity === true && challenge.allowComments) {
        challenge.comments.push({
          userId: authUserId,
          text: reportText,
          imageUrl: reportImage,
          actionTitle: action.text || '',
          createdAt: new Date()
        });
      }
    }

    await challenge.save();

    const isCompletedNow = isResultChallengeCompleted(challenge.actions);
    const { clientDayStr: todayStr } = getClientDayRange(req, 0);

    let updatedUser = null;
    const xpResults = [];
    const sparksResults = [];

    if (!wasAlreadyChecked) {
      const xpResult = await awardResultActionXp(authUserId, challenge._id, actionId);
      xpResults.push(xpResult);
      if (xpResult.awarded && xpResult.user) {
        updatedUser = xpResult.user;
      }

      const sparkAmount = mode === 'report'
        ? SPARKS_AMOUNTS.QUEST_ACTION_REPORT
        : SPARKS_AMOUNTS.QUEST_ACTION_CHECK;
      const sparksResult = await awardQuestActionSparks(
        authUserId,
        todayStr,
        challenge._id,
        actionId,
        sparkAmount
      );
      sparksResults.push(sparksResult);
      if (sparksResult.awarded && sparksResult.user) {
        updatedUser = sparksResult.user;
      }

      if (!wasCompletedBefore && isCompletedNow) {
        const completionXpResult = await awardResultCompletionXp(authUserId, challenge);
        xpResults.push(completionXpResult);
        if (completionXpResult.awarded && completionXpResult.user) {
          updatedUser = completionXpResult.user;
        }

        const missionSparksResult = await awardMissionCompletionSparks(authUserId, challenge._id);
        sparksResults.push(missionSparksResult);
        if (missionSparksResult.awarded && missionSparksResult.user) {
          updatedUser = missionSparksResult.user;
        }
      }

      try {
        const userForChecklist = await User.findById(authUserId).select('dailyChecklists');
        if (userForChecklist) {
          await syncTodayChecklistForResultActions(
            userForChecklist._id,
            userForChecklist.dailyChecklists,
            req,
            challenge,
            prevActions,
            challenge.actions
          );
        }
      } catch (syncErr) {
        console.error('Error syncing result actions to daily checklist:', syncErr);
      }
    }

    if (mode === 'report') {
      await challenge.populate('userDiaryEntries.userId', 'name avatarUrl');
      entry = challenge.userDiaryEntries[challenge.userDiaryEntries.length - 1];

      if (shareToCommunity === true && challenge.allowComments) {
        const sharedComment = challenge.comments[challenge.comments.length - 1];
        sharedCommentId = sharedComment?._id || null;
      }
    }

    const rewardPayload = buildRewardPayload({
      user: serializeUserForClient(await User.findById(authUserId).select('name email avatarUrl xp sparks createdAt _id')),
      xpResults,
      sparksResults
    });

    res.json({
      message: wasAlreadyChecked ? 'Action was already completed' : 'Action completed successfully',
      challenge,
      entry,
      sharedCommentId,
      alreadyCompleted: wasAlreadyChecked,
      ...rewardPayload
    });
  } catch (error) {
    console.error('Error completing action:', error);
    res.status(500).json({ message: 'Error completing action', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
});

router.post('/:id/end-result-mission', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid challenge id' });
    }

    const challenge = await Challenge.findById(id);
    if (!challenge) {
      return res.status(404).json({ message: 'Challenge not found' });
    }

    if (challenge.challengeType !== 'result') {
      return res.status(400).json({ message: 'This route is only for result challenges' });
    }

    const authUserId = req.user.id;

    const ownerId = challenge.owner?._id || challenge.owner;
    if (authUserId.toString() !== ownerId.toString()) {
      return res.status(403).json({ message: 'You are not authorized to update this challenge' });
    }

    if (challenge.resultMissionEndedAt) {
      return res.status(400).json({ message: 'Mission is already ended' });
    }

    if (!isResultChallengeCompleted(challenge.actions)) {
      return res.status(400).json({ message: 'Complete all quest steps before ending the mission' });
    }

    challenge.resultMissionEndedAt = new Date();
    await challenge.save();

    res.json({
      message: 'Mission ended successfully',
      challenge,
      missionRewardsSummary: buildMissionRewardSummary(challenge)
    });
  } catch (error) {
    console.error('Error ending result mission:', error);
    res.status(500).json({ message: 'Error ending mission', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
});

router.post('/:id/end-habit-mission', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    let { completedDays } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid challenge id' });
    }

    if (!completedDays || !Array.isArray(completedDays)) {
      return res.status(400).json({ message: 'completedDays must be an array' });
    }

    completedDays = [...new Set(completedDays)]
      .filter((day) => typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day))
      .sort();

    const challenge = await Challenge.findById(id);
    if (!challenge) {
      return res.status(404).json({ message: 'Challenge not found' });
    }

    if (challenge.challengeType !== 'habit') {
      return res.status(400).json({ message: 'This route is only for habit challenges' });
    }

    const authUserId = req.user.id;

    const participantIndex = challenge.participants.findIndex(
      (p) => p.userId && p.userId.toString() === authUserId.toString()
    );

    if (participantIndex === -1) {
      return res.status(403).json({ message: 'You are not a participant of this challenge' });
    }

    const participant = challenge.participants[participantIndex];
    if (participant.habitMissionEndedAt) {
      return res.status(400).json({ message: 'Mission completion already recorded' });
    }

    const { clientDayStr } = getClientDayRange(req, 0);
    if (!isMissionFinalDay(challenge, clientDayStr)) {
      return res.status(400).json({ message: 'Mission can only be completed on the final day' });
    }

    if (!completedDays.includes(clientDayStr)) {
      return res.status(400).json({ message: 'Final day must be marked as completed' });
    }

    const prevCompletedDays = Array.isArray(participant.completedDays) ? participant.completedDays : [];
    const prevCompletedDayKeys = new Set(
      prevCompletedDays.map((day) => normalizeDateLikeToYmd(day)).filter(Boolean)
    );
    const addedDays = completedDays.filter((day) => !prevCompletedDayKeys.has(day));

    challenge.participants[participantIndex].completedDays = completedDays;
    challenge.participants[participantIndex].habitMissionEndedAt = new Date();

    if (!participant.joinedAt) {
      challenge.participants[participantIndex].joinedAt = challenge.startDate;
    }

    await challenge.save();

    if (addedDays.length > 0) {
      await clearReactivationStreakFlag(authUserId);
    }

    const userSelect = 'name email avatarUrl createdAt _id xp sparks';
    let updatedUser = await User.findById(authUserId).select(userSelect);
    const xpResults = [];
    const sparksResults = [];

    for (const day of addedDays) {
      const xpResult = await awardHabitDayXp(authUserId, challenge._id, day);
      xpResults.push(xpResult);
      if (xpResult.awarded && xpResult.user) {
        updatedUser = xpResult.user;
      }

      const sparksResult = await awardHabitDaySparks(authUserId, challenge._id, day);
      sparksResults.push(sparksResult);
      if (sparksResult.awarded && sparksResult.user) {
        updatedUser = sparksResult.user;
      }
    }

    const updatedParticipant = challenge.participants[participantIndex];
    const missionRewardsSummary = buildHabitMissionRewardSummary(challenge, updatedParticipant);

    challenge.participants[participantIndex].completionTier = missionRewardsSummary.tier;
    await challenge.save();

    if (missionRewardsSummary.totalXp > 0) {
      const completionXpResult = await awardTieredHabitCompletionXp(
        authUserId,
        challenge._id,
        missionRewardsSummary.totalXp
      );
      xpResults.push(completionXpResult);
      if (completionXpResult.awarded && completionXpResult.user) {
        updatedUser = completionXpResult.user;
      }
    }

    if (missionRewardsSummary.totalSparks > 0) {
      const missionSparksResult = await awardTieredMissionCompletionSparks(
        authUserId,
        challenge._id,
        missionRewardsSummary.totalSparks
      );
      sparksResults.push(missionSparksResult);
      if (missionSparksResult.awarded && missionSparksResult.user) {
        updatedUser = missionSparksResult.user;
      }
    }

    const rewardPayload = buildRewardPayload({
      user: serializeUserForClient(updatedUser),
      xpResults,
      sparksResults
    });

    const populatedChallenge = await Challenge.findById(id)
      .populate('owner', 'name avatarUrl')
      .populate('participants.userId', 'name avatarUrl');

    res.json({
      message: 'Habit mission completed successfully',
      challenge: populatedChallenge,
      missionRewardsSummary,
      ...rewardPayload
    });
  } catch (error) {
    console.error('Error ending habit mission:', error);
    res.status(500).json({ message: 'Error completing habit mission', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
});

router.post('/:id/continue-solo', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { customEndDate } = req.body || {};

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid challenge id' });
    }

    const authUserId = req.user.id;

    const sourceChallenge = await Challenge.findById(id);
    if (!sourceChallenge) {
      return res.status(404).json({ message: 'Challenge not found' });
    }

    if (sourceChallenge.challengeType !== 'habit') {
      return res.status(400).json({ message: 'Only habit missions support solo continuation' });
    }

    if (!isChallengeFinished(sourceChallenge)) {
      return res.status(400).json({ message: 'Group mission must be finished before continuing solo' });
    }

    const participant = findChallengeParticipant(sourceChallenge, authUserId);
    if (!participant) {
      return res.status(403).json({ message: 'You are not a participant of this challenge' });
    }

    if (!needsSoloContinuation(sourceChallenge, participant)) {
      return res.status(400).json({ message: 'Solo continuation is not available for this mission' });
    }

    const joinedKey = getParticipantJoinedAtKey(sourceChallenge, participant);
    const { startDate, endDate } = getSoloContinuationDates(
      sourceChallenge,
      participant,
      customEndDate
    );

    const personalChallenge = {
      ...sourceChallenge.toObject(),
      startDate: joinedKey
    };

    const completedDays = (participant.completedDays || [])
      .map((day) => normalizeDateLikeToYmd(day))
      .filter((day) => day && day >= joinedKey && isDateScheduledForChallenge(personalChallenge, day));

    const frozenDays = (participant.frozenDays || [])
      .map((day) => normalizeDateLikeToYmd(day))
      .filter((day) => day && day >= joinedKey);

    const secondChanceDays = (participant.secondChanceDays || [])
      .map((day) => normalizeDateLikeToYmd(day))
      .filter((day) => day && day >= joinedKey);

    const soloChallenge = new Challenge({
      title: sourceChallenge.title,
      description: sourceChallenge.description || '',
      imageUrl: sourceChallenge.imageUrl || '',
      privacy: 'private',
      challengeType: 'habit',
      frequency: sourceChallenge.frequency || 'daily',
      startDate,
      endDate,
      owner: authUserId,
      difficulty: sourceChallenge.difficulty || 'medium',
      allowComments: sourceChallenge.allowComments !== false,
      participants: [{
        userId: authUserId,
        completedDays,
        frozenDays,
        secondChanceDays,
        joinedAt: startDate
      }]
    });

    await soloChallenge.save();

    const populatedChallenge = await Challenge.findById(soloChallenge._id)
      .populate('owner', 'name avatarUrl')
      .populate('participants.userId', 'name avatarUrl');

    res.status(201).json({
      message: 'Solo mission created successfully',
      challenge: populatedChallenge
    });
  } catch (error) {
    console.error('Error continuing solo mission:', error);
    res.status(500).json({ message: 'Error creating solo mission', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
});

// Update challenge
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, startDate, endDate, imageUrl, privacy, challengeType, frequency, actions, completedDays, allowComments, difficulty, reward } = req.body;

    if (!title || !startDate || !endDate) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    // Load existing challenge
    const existingChallenge = await Challenge.findById(id);

    if (!existingChallenge) {
      return res.status(404).json({ message: 'Challenge not found' });
    }

    const authUserId = req.user.id;
    const isAdmin = false;

    // Security check: only owner can update challenge details
    const ownerId = existingChallenge.owner?._id || existingChallenge.owner;
    if (!authUserId || (authUserId.toString() !== ownerId.toString() && !isAdmin)) {
      return res.status(403).json({ message: 'You are not authorized to update this challenge' });
    }

    // Ownership is immutable via this endpoint; never reassign from the body.
    const effectiveOwnerId = existingChallenge.owner;

    const update = { title, description: description || '', startDate, endDate };
    if (imageUrl !== undefined) {
      update.imageUrl = imageUrl;
    }
    if (privacy !== undefined) {
      update.privacy = privacy;
    }
    if (challengeType !== undefined) {
      update.challengeType = challengeType;
    }
    if (difficulty !== undefined) {
      update.difficulty = difficulty;
    }
    if (frequency !== undefined && challengeType === 'habit') {
      update.frequency = frequency;
    } else if (challengeType === 'result') {
      update.frequency = null;
    }
    
    if (actions !== undefined) {
      const sanitized = sanitizeChallengeActions(actions, {
        requireNonEmpty: (challengeType || existingChallenge.challengeType) === 'result'
      });
      if (!sanitized.ok) {
        return res.status(400).json({ message: sanitized.message });
      }
      update.actions = sanitized.actions;
    } else if (challengeType === 'habit' && !existingChallenge.actions) {
      update.actions = [];
    }
    
    if (allowComments !== undefined) {
      update.allowComments = allowComments;
    }

    const effectiveType = challengeType !== undefined ? challengeType : existingChallenge.challengeType;
    if (effectiveType === 'result' && reward !== undefined) {
      update.reward = typeof reward === 'string' ? reward.trim() : '';
    }

    const prevActions = JSON.parse(JSON.stringify(existingChallenge.actions || []));
    const wasCompletedBeforePut = isResultChallengeCompleted(prevActions);

    const challenge = await Challenge.findByIdAndUpdate(
      id,
      update,
      {
        new: true,
        runValidators: true
      }
    );

    let updatedUser = null;
    const putXpResults = [];
    const putSparksResults = [];

    if (actions !== undefined && authUserId && challenge.challengeType === 'result') {
      const user = await User.findById(authUserId);
      if (user) {
        updatedUser = user;
        const isCompletedNowPut = isResultChallengeCompleted(challenge.actions);
        const newlyCheckedActionIds = collectNewlyCheckedActionIds(
          prevActions,
          challenge.actions
        );
        const { clientDayStr: todayStr } = getClientDayRange(req, 0);

        for (const actionId of newlyCheckedActionIds) {
          const xpResult = await awardResultActionXp(authUserId, challenge._id, actionId);
          putXpResults.push(xpResult);
          if (xpResult.awarded && xpResult.user) {
            updatedUser = xpResult.user;
          }

          const sparksResult = await awardChecklistTaskSparks(
            authUserId,
            todayStr,
            buildResultActionChecklistTaskKey(challenge._id, actionId)
          );
          putSparksResults.push(sparksResult);
          if (sparksResult.awarded && sparksResult.user) {
            updatedUser = sparksResult.user;
          }
        }

        if (!wasCompletedBeforePut && isCompletedNowPut) {
          const completionXpResult = await awardResultCompletionXp(authUserId, challenge);
          putXpResults.push(completionXpResult);
          if (completionXpResult.awarded && completionXpResult.user) {
            updatedUser = completionXpResult.user;
          }

          const missionSparksResult = await awardMissionCompletionSparks(authUserId, challenge._id);
          putSparksResults.push(missionSparksResult);
          if (missionSparksResult.awarded && missionSparksResult.user) {
            updatedUser = missionSparksResult.user;
          }
        }
      }
    }

    // Handle owner's completedDays - save to their participant entry
    if (challenge.challengeType === 'habit' && completedDays !== undefined && effectiveOwnerId) {
      // Find owner's participant entry
      const ownerIndex = challenge.participants.findIndex(
        p => p.userId && p.userId.toString() === effectiveOwnerId.toString()
      );
      
      if (ownerIndex !== -1) {
        // Update owner's completedDays in their participant entry
        challenge.participants[ownerIndex].completedDays = Array.isArray(completedDays) ? completedDays : [];
      } else {
        // If owner is not in participants, add them
        challenge.participants.push({ userId: effectiveOwnerId, completedDays: Array.isArray(completedDays) ? completedDays : [] });
      }
      
      await challenge.save();
    }

    const putRewardPayload = (putXpResults.length > 0 || putSparksResults.length > 0)
      ? buildRewardPayload({
          user: serializeUserForClient(
            authUserId
              ? await User.findById(authUserId).select('name email avatarUrl xp sparks createdAt _id')
              : updatedUser
          ),
          xpResults: putXpResults,
          sparksResults: putSparksResults
        })
      : {};

    res.json({
      message: 'Challenge updated successfully',
      challenge,
      ...putRewardPayload
    });
  } catch (error) {
    res.status(500).json({ message: 'Error updating challenge', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
});

// Join challenge
router.post('/:id/join', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const challenge = await Challenge.findById(id);

    if (!challenge) {
      return res.status(404).json({ message: 'Challenge not found' });
    }

    // Only habit challenges can be joined
    if (challenge.challengeType !== 'habit') {
      return res.status(400).json({ message: 'Only habit challenges can be joined' });
    }

    // Atomic add: the $ne guard in the filter makes concurrent joins for the
    // same user match at most once, so no duplicate participants can appear.
    const { startUtc: joinDate } = getClientDayRange(req, 0);
    const updatedChallenge = await Challenge.findOneAndUpdate(
      { _id: id, 'participants.userId': { $ne: userId } },
      { $push: { participants: { userId, completedDays: [], joinedAt: joinDate } } },
      { new: true }
    );

    if (!updatedChallenge) {
      return res.status(400).json({ message: 'You have already joined this challenge' });
    }

    const ownerId = updatedChallenge.owner?._id || updatedChallenge.owner;
    await notifyChallengeJoin({ ownerId, fromUserId: userId, challenge: updatedChallenge });

    const welcomeBonusPayload = await getWelcomeBonusRewardPayload(userId, serializeUserForClient);

    const populatedChallenge = await Challenge.findById(updatedChallenge._id)
      .populate('owner', 'name avatarUrl')
      .populate('participants.userId', 'name avatarUrl');

    res.json({
      message: 'Successfully joined the challenge',
      challenge: populatedChallenge,
      ...welcomeBonusPayload
    });
  } catch (error) {
    res.status(500).json({ message: 'Error joining challenge', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
});

// Leave challenge
router.post('/:id/leave', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid challenge id' });
    }

    const challengeExists = await Challenge.exists({ _id: id });
    if (!challengeExists) {
      return res.status(404).json({ message: 'Challenge not found' });
    }

    // Use $pull instead of load/splice/save so legacy participant rows with
    // missing userId values do not block leaving for valid participants.
    const leaveResult = await Challenge.updateOne(
      { _id: id, 'participants.userId': userId },
      { $pull: { participants: { userId } } }
    );

    if (leaveResult.modifiedCount === 0) {
      return res.status(400).json({ message: 'You are not a participant of this challenge' });
    }

    const updatedChallenge = await Challenge.findById(id)
      .populate('owner', 'name avatarUrl')
      .populate('participants.userId', 'name avatarUrl');

    res.json({
      message: 'Successfully left the challenge',
      challenge: updatedChallenge
    });
  } catch (error) {
    console.error('Error leaving challenge:', error);
    res.status(500).json({ message: 'Error leaving challenge', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
});

// Extend a finished challenge for sparks: create a fresh personal copy
// (new createdAt) so it sorts to the top of My Missions like a new launch.
router.post('/:id/extend', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const authUserId = req.user.id;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid challenge id' });
    }

    const sourceChallenge = await Challenge.findById(id);

    if (!sourceChallenge) {
      return res.status(404).json({ message: 'Challenge not found' });
    }

    const participant = findChallengeParticipant(sourceChallenge, authUserId);
    if (!participant) {
      return res.status(403).json({ message: 'You are not a participant of this challenge' });
    }

    if (!isChallengeFinished(sourceChallenge)) {
      return res.status(400).json({ message: 'Only finished missions can be extended' });
    }

    const durationDays = getInclusiveDaysBetween(sourceChallenge.startDate, sourceChallenge.endDate);
    if (durationDays < 1) {
      return res.status(400).json({ message: 'Invalid mission duration' });
    }

    const { startUtc: newStartDate } = getClientDayRange(req, 0);
    const { startUtc: newEndDate } = getClientDayRange(req, durationDays - 1);
    const { clientDayStr } = getClientDayRange(req, 0);

    const extendCost = SPARKS_AMOUNTS.MISSION_EXTEND;
    const spendKey = buildMissionExtendSparksKey(id, clientDayStr);
    const spendResult = await spendSparksOnce(authUserId, spendKey, extendCost, {
      challengeId: id,
      clientDay: clientDayStr
    });

    if (!spendResult.success) {
      if (spendResult.reason === 'insufficient_sparks') {
        return res.status(402).json({ message: 'Insufficient sparks', reason: spendResult.reason });
      }
      if (spendResult.reason === 'already_spent') {
        return res.status(409).json({ message: 'Mission already extended today', reason: spendResult.reason });
      }
      return res.status(400).json({ message: 'Unable to spend sparks', reason: spendResult.reason });
    }

    const challengeType = sourceChallenge.challengeType || 'habit';

    const renewedPayload = {
      title: sourceChallenge.title,
      description: sourceChallenge.description || '',
      imageUrl: sourceChallenge.imageUrl || '',
      privacy: sourceChallenge.privacy === 'public' ? 'public' : 'private',
      challengeType,
      startDate: newStartDate,
      endDate: newEndDate,
      owner: authUserId,
      difficulty: sourceChallenge.difficulty || 'medium',
      allowComments: sourceChallenge.allowComments !== false,
      extendedFrom: sourceChallenge._id,
      participants: [{
        userId: authUserId,
        completedDays: [],
        frozenDays: [],
        secondChanceDays: [],
        joinedAt: newStartDate
      }]
    };

    if (challengeType === 'habit') {
      renewedPayload.frequency = sourceChallenge.frequency || 'daily';
    } else {
      renewedPayload.actions = cloneActionsUnchecked(sourceChallenge.actions);
      renewedPayload.reward = typeof sourceChallenge.reward === 'string'
        ? sourceChallenge.reward
        : '';
    }

    const renewedChallenge = new Challenge(renewedPayload);

    await renewedChallenge.save();

    const populatedChallenge = await Challenge.findById(renewedChallenge._id)
      .populate('owner', 'name avatarUrl')
      .populate('participants.userId', 'name avatarUrl')
      .lean();

    const rewardPayload = buildRewardPayload({
      user: serializeUserForClient(spendResult.user)
    });

    res.status(201).json({
      message: 'Challenge extended successfully',
      challenge: populatedChallenge,
      sourceChallengeId: id,
      sparksSpent: extendCost,
      durationDays,
      ...rewardPayload
    });
  } catch (error) {
    console.error('Error extending challenge:', error);
    res.status(500).json({ message: 'Error extending challenge', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
});

// Second chance: mark today as protected completion for sparks (habit only)
router.post('/:id/second-chance', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const authUserId = req.user.id;

    const challenge = await Challenge.findById(id);

    if (!challenge) {
      return res.status(404).json({ message: 'Challenge not found' });
    }

    if (challenge.challengeType !== 'habit') {
      return res.status(400).json({ message: 'Only habit challenges support second chance' });
    }

    if (isChallengeFinished(challenge)) {
      return res.status(400).json({ message: 'Mission is already finished' });
    }

    const participantIndex = challenge.participants.findIndex(
      (p) => p.userId && p.userId.toString() === authUserId.toString()
    );

    if (participantIndex === -1) {
      return res.status(403).json({ message: 'You are not a participant of this challenge' });
    }

    const { clientDayStr } = getClientDayRange(req, 0);
    const clientHour = getClientLocalHour(req);

    if (clientHour < 22 || clientHour > 23) {
      return res.status(400).json({
        message: 'Second chance is only available between 22:00 and 23:59',
        reason: 'second_chance_window_closed'
      });
    }

    if (!isDateScheduledForChallenge(challenge, clientDayStr)) {
      return res.status(400).json({ message: 'Today is not a scheduled day for this mission' });
    }

    const participant = challenge.participants[participantIndex];

    if (isDayEffectiveCompleted(participant, clientDayStr)) {
      return res.status(400).json({ message: 'Today is already completed for this mission' });
    }

    const cost = SPARKS_AMOUNTS.SECOND_CHANCE;
    const spendKey = buildSecondChanceSparksKey(id, authUserId, clientDayStr);
    const spendResult = await spendSparksOnce(authUserId, spendKey, cost, {
      challengeId: id,
      clientDay: clientDayStr
    });

    if (!spendResult.success) {
      if (spendResult.reason === 'insufficient_sparks') {
        return res.status(402).json({ message: 'Insufficient sparks', reason: spendResult.reason });
      }
      if (spendResult.reason === 'already_spent') {
        return res.status(409).json({ message: 'Second chance already used for this mission today', reason: spendResult.reason });
      }
      return res.status(400).json({ message: 'Unable to spend sparks', reason: spendResult.reason });
    }

    appendUniqueParticipantDay(participant, 'secondChanceDays', clientDayStr);
    await challenge.save();

    const populatedChallenge = await Challenge.findById(id)
      .populate('owner', 'name avatarUrl')
      .populate('participants.userId', 'name avatarUrl');

    const rewardPayload = buildRewardPayload({
      user: serializeUserForClient(spendResult.user)
    });

    res.json({
      message: 'Second chance applied successfully',
      challenge: populatedChallenge,
      sparksSpent: cost,
      ...rewardPayload
    });
  } catch (error) {
    res.status(500).json({ message: 'Error applying second chance', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
});

// Get all challenges
router.get('/', async (req, res) => {
  try {
    const { excludeFinished, type, activity, participants, creationDate, page, limit, title, owner, createdBy, popularity, isCompleted } = req.query;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Pagination parameters
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 20;
    const skip = (pageNum - 1) * limitNum;
    
    let query = {};
    
    // Filter by type (challengeType)
    if (type && (type === 'habit' || type === 'result')) {
      query.challengeType = type;
    }
    
    // Filter by title (search)
    if (title && typeof title === 'string' && title.trim()) {
      query.title = { $regex: escapeRegExp(title.trim()), $options: 'i' }; // Case-insensitive search
    }

    // Filter by owner (createdBy is an alias for owner). Cast to string to
    // prevent query-operator injection via ?owner[$ne]=...
    if (owner || createdBy) {
      query.owner = String(owner || createdBy);
    }
    
    // Filter by privacy - exclude private challenges
    query.privacy = { $ne: 'private' };
    // Legacy docs without visibility are treated as visible.
    query.visibility = { $ne: false };
    
    // Get all challenges first
    let allChallenges = await Challenge.find(query)
      .sort({ createdAt: -1 })
      .populate('owner', 'name avatarUrl')
      .populate('participants.userId', 'name avatarUrl');
    
    // Apply activity filter (active/finished/upcoming)
    if (activity) {
      allChallenges = allChallenges.filter(challenge => {
        if (!challenge.startDate || !challenge.endDate) return false;
        
        const startDate = new Date(challenge.startDate);
        startDate.setHours(0, 0, 0, 0);
        const endDate = new Date(challenge.endDate);
        endDate.setHours(0, 0, 0, 0);
        
        if (activity === 'active') {
          return startDate <= today && endDate >= today;
        } else if (activity === 'finished') {
          // Check if challenge is finished
          if (endDate < today) return true;
          
          // For result challenges, check if all actions are done
          if (challenge.challengeType === 'result') {
            if (!challenge.actions || !Array.isArray(challenge.actions) || challenge.actions.length === 0) {
              return false;
            }
            return challenge.actions.every(action => {
              if (!action.checked) return false;
              if (action.children && Array.isArray(action.children) && action.children.length > 0) {
                return action.children.every(child => child.checked);
              }
              return true;
            });
          }
          return false;
        } else if (activity === 'upcoming') {
          return startDate > today;
        }
        return true;
      });
    }
    
    // Apply isCompleted filter
    // If isCompleted is not sent, exclude completed challenges by default
    // If isCompleted is 'true', include only completed challenges
    // If isCompleted is 'false', exclude completed challenges
    // If isCompleted is 'all', include both active and completed
    if (isCompleted !== undefined && isCompleted !== 'all') {
      const includeCompleted = isCompleted === 'true' || isCompleted === true;
      allChallenges = allChallenges.filter(challenge => {
        const completed = isChallengeCompleted(challenge, today);
        return includeCompleted ? completed : !completed;
      });
    } else if (isCompleted === undefined) {
      // Default behavior: exclude completed challenges if isCompleted is not specified
      allChallenges = allChallenges.filter(challenge => {
        return !isChallengeCompleted(challenge, today);
      });
    }
    
    // Apply excludeFinished filter (if excludeFinished is true, filter out finished challenges)
    // This is kept for backward compatibility but isCompleted takes precedence
    if (excludeFinished === 'true' && !activity && isCompleted === undefined) {
      allChallenges = allChallenges.filter(challenge => {
        // Check if endDate is in the past
        if (challenge.endDate) {
          try {
            const endDate = new Date(challenge.endDate);
            endDate.setHours(0, 0, 0, 0);
            if (endDate < today) {
              return false; // Exclude if endDate is in past
            }
          } catch (e) {
            // Continue if date parsing fails
          }
        }
        
        // For result challenges, check if all actions are done
        if (challenge.challengeType === 'result') {
          if (!challenge.actions || !Array.isArray(challenge.actions) || challenge.actions.length === 0) {
            return true; // Include if no actions
          }
          
          // Check if all actions and their children are checked
          const allActionsDone = challenge.actions.every(action => {
            // Parent action must be checked
            if (!action.checked) return false;
            
            // All children must be checked (if any exist)
            if (action.children && Array.isArray(action.children) && action.children.length > 0) {
              return action.children.every(child => child.checked);
            }
            
            return true;
          });
          
          if (allActionsDone) {
            return false; // Exclude if all actions are done
          }
        }
        
        return true; // Include the challenge
      });
    }
    
    // Filter by participants count
    if (participants) {
      allChallenges = allChallenges.filter(challenge => {
        const participantCount = (challenge.participants || []).length;
        
        if (participants === '0') {
          return participantCount === 0;
        } else if (participants === '1-5') {
          return participantCount >= 1 && participantCount <= 5;
        } else if (participants === '6+') {
          return participantCount >= 6;
        }
        return true;
      });
    }
    
    // Filter by creation date
    if (creationDate) {
      allChallenges = allChallenges.filter(challenge => {
        const creationDateValue = challenge.createdAt || challenge.startDate;
        if (!creationDateValue) return false;
        
        const created = new Date(creationDateValue);
        created.setHours(0, 0, 0, 0);
        const daysDiff = Math.floor((today - created) / (1000 * 60 * 60 * 24));
        
        if (creationDate === 'today') {
          return daysDiff === 0;
        } else if (creationDate === 'week') {
          return daysDiff >= 0 && daysDiff <= 7;
        } else if (creationDate === 'month') {
          return daysDiff >= 0 && daysDiff <= 30;
        } else if (creationDate === 'older') {
          return daysDiff > 30;
        }
        return true;
      });
    }
    
    // Sort by popularity if requested
    if (popularity === 'most') {
      // Sort by participant count descending (most popular first)
      allChallenges.sort((a, b) => {
        const countA = (a.participants || []).length;
        const countB = (b.participants || []).length;
        return countB - countA;
      });
    } else if (popularity === 'least') {
      // Sort by participant count ascending (least popular first)
      allChallenges.sort((a, b) => {
        const countA = (a.participants || []).length;
        const countB = (b.participants || []).length;
        return countA - countB;
      });
    }
    
    // Apply pagination
    const totalChallenges = allChallenges.length;
    const paginatedChallenges = allChallenges.slice(skip, skip + limitNum);
    const hasMore = skip + limitNum < totalChallenges;
    
    const requestingUserId = decodeOptionalAuthUserId(req);
    const challengesWithWatchers = await enrichChallengesWithWatchState(
      paginatedChallenges,
      requestingUserId,
      User
    );

    res.json({
      challenges: challengesWithWatchers,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: totalChallenges,
        hasMore
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching challenges', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
});

// Most popular active public habit challenge (featured main ritual card)
router.get('/main-ritual', async (req, res) => {
  try {
    const challenge = await findMainRitualChallenge(Challenge);

    if (!challenge) {
      return res.json({ challenge: null });
    }

    const requestingUserId = decodeOptionalAuthUserId(req);
    const [enriched] = await enrichChallengesWithWatchState(
      [challenge],
      requestingUserId,
      User
    );

    res.json({ challenge: enriched ?? null });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching main ritual', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
});

// Update participant's completedDays (HABIT CHALLENGE ONLY)
router.put('/:id/participant/:userId/completedDays', authenticateToken, async (req, res) => {
  try {
    const { id, userId } = req.params;
    let { completedDays } = req.body;

    if (!completedDays || !Array.isArray(completedDays)) {
      return res.status(400).json({ message: 'completedDays must be an array' });
    }

    // Normalize completedDays: unique, YYYY-MM-DD format strings
    completedDays = [...new Set(completedDays)]
      .filter(d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d))
      .sort();

    const challenge = await Challenge.findById(id);

    if (!challenge) {
      return res.status(404).json({ message: 'Challenge not found' });
    }

    if (challenge.challengeType !== 'habit') {
      return res.status(400).json({ message: 'This route only supports habit challenges' });
    }

    // Find the participant
    const participantIndex = challenge.participants.findIndex(
      p => p.userId && p.userId.toString() === userId.toString()
    );

    if (participantIndex === -1) {
      return res.status(404).json({ message: 'Participant not found in this challenge' });
    }

    const authUserId = req.user.id;
    // Security: Only the user themselves can update their progress
    if (authUserId.toString() !== userId.toString()) {
      return res.status(403).json({ message: 'You are not authorized to update this progress' });
    }

    const prevParticipant = challenge.participants[participantIndex];

    // Reject days outside the participant's allowed window: nothing before the
    // challenge start, nothing after today (client day), and nothing past the
    // later of the challenge end / the participant's solo-continuation end.
    // Prevents farming XP/sparks by submitting arbitrary dates.
    const { clientDayStr: todayKey } = getClientDayRange(req, 0);
    const startKey = normalizeDateLikeToYmd(challenge.startDate);
    const challengeEndKey = normalizeDateLikeToYmd(challenge.endDate);
    const soloEndKey = normalizeDateLikeToYmd(
      getSoloContinuationDates(challenge, prevParticipant)?.endDate
    );
    const endKey = [challengeEndKey, soloEndKey].filter(Boolean).sort().pop() || null;

    const invalidDays = completedDays.filter((day) =>
      (startKey && day < startKey) ||
      (endKey && day > endKey) ||
      (todayKey && day > todayKey)
    );
    if (invalidDays.length > 0) {
      return res.status(400).json({
        message: 'completedDays contains dates outside the challenge window or in the future',
        invalidDays
      });
    }
    const prevCompletedDays = Array.isArray(prevParticipant.completedDays)
      ? prevParticipant.completedDays
      : [];

    const prevCompletedDayKeys = new Set(
      prevCompletedDays
        .map((day) => normalizeDateLikeToYmd(day))
        .filter(Boolean)
    );

    const addedDays = completedDays.filter((day) => !prevCompletedDayKeys.has(day));

    challenge.participants[participantIndex].completedDays = completedDays;
    await challenge.save();

    if (addedDays.length > 0) {
      await clearReactivationStreakFlag(userId);
    }

    const userSelect = 'name email avatarUrl createdAt _id xp sparks';
    let updatedUser = await User.findById(userId).select(userSelect);
    const xpResults = [];
    const sparksResults = [];

    for (const day of addedDays) {
      const xpResult = await awardHabitDayXp(userId, challenge._id, day);
      xpResults.push(xpResult);
      if (xpResult.awarded && xpResult.user) {
        updatedUser = xpResult.user;
      }

      const sparksResult = await awardHabitDaySparks(userId, challenge._id, day);
      sparksResults.push(sparksResult);
      if (sparksResult.awarded && sparksResult.user) {
        updatedUser = sparksResult.user;
      }
    }

    const rewardPayload = buildRewardPayload({
      user: serializeUserForClient(updatedUser),
      xpResults,
      sparksResults
    });

    res.json({
      message: 'Completed days updated successfully',
      challenge,
      ...rewardPayload
    });
  } catch (error) {
    res.status(500).json({ message: 'Error updating completed days', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
});

// Get challenges by user
router.get('/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { excludePrivate, type, activity, participants, creationDate } = req.query;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const requestingUserId = decodeOptionalAuthUserId(req);

    if (!userId) {
      return res.status(400).json({ message: 'User ID is required' });
    }

    // Build query
    const query = {
      $or: [
        { owner: userId }, 
        { 'participants.userId': userId }
      ]
    };

    // Filter by type (challengeType)
    if (type && (type === 'habit' || type === 'result')) {
      query.challengeType = type;
    }

    // Exclude private challenges if:
    // 1. excludePrivate query param is true (as string 'true' or boolean true), OR
    // 2. The requesting user is not viewing their own profile (or no token provided)
    const isOwnProfile = requestingUserId && requestingUserId.toString() === userId.toString();
    const shouldExcludePrivate = excludePrivate === 'true' || excludePrivate === true || !isOwnProfile;
    if (shouldExcludePrivate) {
      query.privacy = { $ne: 'private' };
    }
    if (!isOwnProfile) {
      query.visibility = { $ne: false };
    }

    // Get all challenges first
    let allChallenges = await Challenge.find(query)
      .sort({ createdAt: -1 })
      .populate('owner', 'name avatarUrl')
      .populate('participants.userId', 'name avatarUrl');

    // Apply activity filter (active/finished/upcoming)
    if (activity) {
      allChallenges = allChallenges.filter(challenge => {
        if (!challenge.startDate || !challenge.endDate) return false;
        
        const startDate = new Date(challenge.startDate);
        startDate.setHours(0, 0, 0, 0);
        const endDate = new Date(challenge.endDate);
        endDate.setHours(0, 0, 0, 0);
        
        if (activity === 'active') {
          return startDate <= today && endDate >= today;
        } else if (activity === 'finished') {
          // Check if challenge is finished
          if (endDate < today) return true;
          
          // For result challenges, check if all actions are done
          if (challenge.challengeType === 'result') {
            if (!challenge.actions || !Array.isArray(challenge.actions) || challenge.actions.length === 0) {
              return false;
            }
            return challenge.actions.every(action => {
              if (!action.checked) return false;
              if (action.children && Array.isArray(action.children) && action.children.length > 0) {
                return action.children.every(child => child.checked);
              }
              return true;
            });
          }
          return false;
        } else if (activity === 'upcoming') {
          return startDate > today;
        }
        return true;
      });
    }
    
    // Filter by participants count
    if (participants) {
      allChallenges = allChallenges.filter(challenge => {
        const participantCount = (challenge.participants || []).length;
        
        if (participants === '0') {
          return participantCount === 0;
        } else if (participants === '1-5') {
          return participantCount >= 1 && participantCount <= 5;
        } else if (participants === '6+') {
          return participantCount >= 6;
        }
        return true;
      });
    }
    
    // Filter by creation date
    if (creationDate) {
      allChallenges = allChallenges.filter(challenge => {
        const creationDateValue = challenge.createdAt || challenge.startDate;
        if (!creationDateValue) return false;
        
        const created = new Date(creationDateValue);
        created.setHours(0, 0, 0, 0);
        const daysDiff = Math.floor((today - created) / (1000 * 60 * 60 * 24));
        
        if (creationDate === 'today') {
          return daysDiff === 0;
        } else if (creationDate === 'week') {
          return daysDiff >= 0 && daysDiff <= 7;
        } else if (creationDate === 'month') {
          return daysDiff >= 0 && daysDiff <= 30;
        } else if (creationDate === 'older') {
          return daysDiff > 30;
        }
        return true;
      });
    }

    const challengesWithWatchers = await enrichChallengesWithWatchState(
      allChallenges,
      requestingUserId,
      User
    );

    res.json({ challenges: challengesWithWatchers });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching challenges', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
});

// Watched feed (must be before /watched/:userId and /:id)
router.get('/watched/feed/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const authUserId = decodeOptionalAuthUserId(req);

    if (authUserId && authUserId.toString() !== userId.toString()) {
      return res.status(403).json({ message: 'You are not authorized to view this feed' });
    }

    const user = await User.findById(userId).select('watchedChallenges');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (!user.watchedChallenges?.length) {
      return res.json({ activities: [] });
    }

    const challenges = await Challenge.find({ _id: { $in: user.watchedChallenges } })
      .select('title allowComments participants comments endDate challengeType actions')
      .populate('participants.userId', 'name avatarUrl')
      .populate('comments.userId', 'name avatarUrl');

    const activities = buildWatchedFeedActivities(challenges);

    res.json({ activities });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching watched feed', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
});

// Get watched challenges for a user (must be before /:id)
router.get('/watched/:userId', async (req, res) => {
  try {
    const user = await User.findById(req.params.userId).populate('watchedChallenges');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const challenges = await Challenge.find({ _id: { $in: user.watchedChallenges } })
      .populate('owner', 'name avatarUrl')
      .populate('participants.userId', 'name avatarUrl')
      .sort({ createdAt: -1 });

    const viewerUserId = decodeOptionalAuthUserId(req);
    const challengesWithWatchers = await Promise.all(challenges.map(async (challenge) => {
      const watchersCount = await User.countDocuments({ watchedChallenges: challenge._id });
      const challengeObj = challenge.toObject();
      challengeObj.watchersCount = watchersCount;
      challengeObj.isWatched = true;
      applyReactionPublicFields(challengeObj, viewerUserId);
      return challengeObj;
    }));

    res.json({ challenges: challengesWithWatchers });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching watched challenges', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
});

// Get challenge by ID (must be after more specific routes like /user/:userId)
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const User = require('../models/User');
    const viewerUserId = decodeOptionalAuthUserId(req);

    const [challenge, watchersCount, viewer] = await Promise.all([
      Challenge.findById(id)
        .populate('owner', 'name avatarUrl')
        .populate('participants.userId', 'name avatarUrl'),
      User.countDocuments({ watchedChallenges: id }),
      viewerUserId
        ? User.findById(viewerUserId).select('watchedChallenges').lean()
        : Promise.resolve(null)
    ]);
    
    if (!challenge) {
      return res.status(404).json({ message: 'Challenge not found' });
    }

    const ownerId = challenge.owner?._id || challenge.owner;
    const isOwner = viewerUserId && ownerId && String(ownerId) === String(viewerUserId);
    if (challenge.visibility === false && !isOwner) {
      return res.status(404).json({ message: 'Challenge not found' });
    }
    
    const challengeObj = challenge.toObject();
    challengeObj.watchersCount = watchersCount;
    challengeObj.isWatched = viewerUserId
      ? (viewer?.watchedChallenges || []).some((cid) => String(cid) === String(id))
      : false;
    applyReactionPublicFields(challengeObj, viewerUserId);
    
    res.json(challengeObj);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching challenge', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
});

// Delete challenge
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const challenge = await Challenge.findById(id);

    if (!challenge) {
      return res.status(404).json({ message: 'Challenge not found' });
    }

    // Only the owner may delete their challenge.
    const ownerId = challenge.owner?._id || challenge.owner;
    if (!ownerId || ownerId.toString() !== req.user.id.toString()) {
      return res.status(403).json({ message: 'You are not authorized to delete this challenge' });
    }

    await Challenge.findByIdAndDelete(id);

    res.json({
      message: 'Challenge deleted successfully'
    });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting challenge', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
});

// Watch a challenge
router.post('/:id/watch', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const challenge = await Challenge.findById(req.params.id).populate('owner', '_id');
    if (!challenge) {
      return res.status(404).json({ message: 'Challenge not found' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if already watching
    if (user.watchedChallenges.includes(challenge._id)) {
      return res.status(400).json({ message: 'Challenge is already being watched' });
    }

    user.watchedChallenges.push(challenge._id);
    await user.save();

    const ownerId = challenge.owner?._id || challenge.owner;
    await notifyChallengeWatch({ ownerId, fromUserId: userId, challenge });

    const watchersCount = await User.countDocuments({ watchedChallenges: challenge._id });

    res.json({
      message: 'Challenge added to watch list',
      watchedChallenges: user.watchedChallenges,
      watchersCount,
      isWatched: true
    });
  } catch (error) {
    res.status(500).json({ message: 'Error watching challenge', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
});

// Unwatch a challenge
router.post('/:id/unwatch', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const challenge = await Challenge.findById(req.params.id);
    if (!challenge) {
      return res.status(404).json({ message: 'Challenge not found' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Remove from watched challenges
    user.watchedChallenges = user.watchedChallenges.filter(
      id => id.toString() !== challenge._id.toString()
    );
    await user.save();

    const watchersCount = await User.countDocuments({ watchedChallenges: challenge._id });

    res.json({
      message: 'Challenge removed from watch list',
      watchedChallenges: user.watchedChallenges,
      watchersCount,
      isWatched: false
    });
  } catch (error) {
    res.status(500).json({ message: 'Error unwatching challenge', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
});

// Like / dislike a challenge (YouTube-style toggle)
router.post('/:id/reaction', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { value } = req.body;

    if (value !== 'like' && value !== 'dislike') {
      return res.status(400).json({ message: 'value must be "like" or "dislike"' });
    }

    const challenge = await Challenge.findById(req.params.id);
    if (!challenge) {
      return res.status(404).json({ message: 'Challenge not found' });
    }

    const ownerId = challenge.owner?._id || challenge.owner;
    if (ownerId && String(ownerId) === String(userId)) {
      return res.status(403).json({ message: 'You cannot react to your own mission' });
    }

    if (!Array.isArray(challenge.likedBy)) challenge.likedBy = [];
    if (!Array.isArray(challenge.dislikedBy)) challenge.dislikedBy = [];

    const uid = String(userId);
    const likedIdx = challenge.likedBy.findIndex((id) => String(id) === uid);
    const dislikedIdx = challenge.dislikedBy.findIndex((id) => String(id) === uid);
    const current = likedIdx >= 0 ? 'like' : dislikedIdx >= 0 ? 'dislike' : null;

    if (current === value) {
      if (likedIdx >= 0) challenge.likedBy.splice(likedIdx, 1);
      if (dislikedIdx >= 0) challenge.dislikedBy.splice(dislikedIdx, 1);
    } else {
      if (likedIdx >= 0) challenge.likedBy.splice(likedIdx, 1);
      if (dislikedIdx >= 0) challenge.dislikedBy.splice(dislikedIdx, 1);
      if (value === 'like') {
        challenge.likedBy.push(userId);
      } else {
        challenge.dislikedBy.push(userId);
      }
    }

    await challenge.save();

    const likesCount = challenge.likedBy.length;
    const dislikesCount = challenge.dislikedBy.length;
    const stillLiked = challenge.likedBy.some((id) => String(id) === uid);
    const stillDisliked = challenge.dislikedBy.some((id) => String(id) === uid);
    const userReaction = stillLiked ? 'like' : stillDisliked ? 'dislike' : null;

    res.json({ likesCount, dislikesCount, userReaction });
  } catch (error) {
    res.status(500).json({ message: 'Error updating reaction', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
});

// Add a comment to a challenge
router.post('/:id/comments', authenticateToken, async (req, res) => {
  try {
    const { text, imageUrl } = req.body;
    const userId = req.user.id;

    if ((!text || !text.trim()) && !imageUrl) {
      return res.status(400).json({ message: 'Comment text or image is required' });
    }

    const challenge = await Challenge.findById(req.params.id).populate('owner', '_id');
    if (!challenge) {
      return res.status(404).json({ message: 'Challenge not found' });
    }

    if (!challenge.allowComments) {
      return res.status(403).json({ message: 'Comments are disabled for this challenge' });
    }

    const comment = {
      userId,
      text: (text && text.trim()) ? text.trim() : '',
      imageUrl: imageUrl || null,
      createdAt: new Date()
    };

    challenge.comments.push(comment);
    await challenge.save();

    // Populate user info for the new comment
    await challenge.populate('comments.userId', 'name avatarUrl');

    const newComment = challenge.comments[challenge.comments.length - 1];
    const ownerId = challenge.owner?._id || challenge.owner;

    const { finalUser, sparksResults } = await maybeAwardMissionCommentSparks(
      req,
      userId,
      challenge,
      ownerId
    );

    // Notify challenge owner (same flow as mention notifications)
    if (ownerId) {
      await notifyChallengeCommentRecipient({
        recipientUserId: ownerId,
        fromUserId: userId,
        challenge,
        type: 'comment',
        commentId: newComment._id
      });
    }

    const rewardPayload = buildRewardPayload({
      user: serializeUserForClient(finalUser),
      sparksResults
    });

    res.status(201).json({
      message: 'Comment added successfully',
      comment: newComment,
      ...rewardPayload
    });
  } catch (error) {
    res.status(500).json({ message: 'Error adding comment', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
});

// Get comments for a challenge
const COMMENTS_PAGE_MAX = 100;

router.get('/:id/comments', async (req, res) => {
  try {
    const challenge = await Challenge.findById(req.params.id)
      .populate('comments.userId', 'name avatarUrl')
      .populate('comments.replies.userId', 'name avatarUrl')
      .populate('comments.replies.mentionedUserId', 'name avatarUrl')
      .select('comments allowComments');

    if (!challenge) {
      return res.status(404).json({ message: 'Challenge not found' });
    }

    // Paginate over the embedded array so huge threads don't ship whole.
    // offset counts back from the newest comment (offset=0 → latest page);
    // chronological order is preserved within the page.
    const allComments = challenge.comments || [];
    const total = allComments.length;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || COMMENTS_PAGE_MAX, 1), COMMENTS_PAGE_MAX);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const end = Math.max(0, total - offset);
    const start = Math.max(0, end - limit);
    const comments = allComments.slice(start, end);

    // Populate nested replies (replies to replies) in one batched query —
    // Mongoose doesn't support deep nested populate, and per-reply findById
    // calls were an N+1.
    const unresolvedIds = new Set();
    for (const comment of comments) {
      for (const reply of comment.replies || []) {
        for (const nestedReply of reply.replies || []) {
          if (nestedReply.userId && !nestedReply.userId.name) {
            unresolvedIds.add(String(nestedReply.userId._id || nestedReply.userId));
          }
          if (nestedReply.mentionedUserId && !nestedReply.mentionedUserId.name) {
            unresolvedIds.add(String(nestedReply.mentionedUserId._id || nestedReply.mentionedUserId));
          }
        }
      }
    }

    if (unresolvedIds.size > 0) {
      const users = await User.find({ _id: { $in: [...unresolvedIds] } }).select('name avatarUrl');
      const usersById = new Map(users.map((u) => [String(u._id), u]));
      for (const comment of comments) {
        for (const reply of comment.replies || []) {
          for (const nestedReply of reply.replies || []) {
            if (nestedReply.userId && !nestedReply.userId.name) {
              const resolved = usersById.get(String(nestedReply.userId._id || nestedReply.userId));
              if (resolved) nestedReply.userId = resolved;
            }
            if (nestedReply.mentionedUserId && !nestedReply.mentionedUserId.name) {
              const resolved = usersById.get(String(nestedReply.mentionedUserId._id || nestedReply.mentionedUserId));
              if (resolved) nestedReply.mentionedUserId = resolved;
            }
          }
        }
      }
    }

    res.json({
      comments,
      allowComments: challenge.allowComments,
      total,
      hasMore: start > 0
    });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching comments', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
});

// Reply to a comment
router.post('/:id/comments/:commentId/reply', authenticateToken, async (req, res) => {
  try {
    const { text, mentionedUserId, imageUrl } = req.body;
    const userId = req.user.id;

    if (!text || !text.trim()) {
      return res.status(400).json({ message: 'Reply text is required' });
    }

    const challenge = await Challenge.findById(req.params.id).populate('owner', '_id');
    if (!challenge) {
      return res.status(404).json({ message: 'Challenge not found' });
    }

    if (!challenge.allowComments) {
      return res.status(403).json({ message: 'Comments are disabled for this challenge' });
    }

    const comment = challenge.comments.id(req.params.commentId);
    if (!comment) {
      return res.status(404).json({ message: 'Comment not found' });
    }

    const reply = {
      userId,
      text: text.trim(),
      imageUrl: imageUrl || null,
      mentionedUserId: mentionedUserId || null,
      createdAt: new Date()
    };

    comment.replies.push(reply);
    await challenge.save();

    // Populate user info for the new reply
    await challenge.populate('comments.replies.userId', 'name avatarUrl');
    await challenge.populate('comments.replies.mentionedUserId', 'name avatarUrl');

    const newReply = comment.replies[comment.replies.length - 1];
    const ownerId = challenge.owner?._id || challenge.owner;
    const { finalUser, sparksResults } = await maybeAwardMissionCommentSparks(
      req,
      userId,
      challenge,
      ownerId
    );
    
    if (mentionedUserId) {
      await notifyChallengeCommentRecipient({
        recipientUserId: mentionedUserId,
        fromUserId: userId,
        challenge,
        type: 'mention',
        commentId: comment._id,
        replyId: newReply._id
      });
    }

    const rewardPayload = buildRewardPayload({
      user: serializeUserForClient(finalUser),
      sparksResults
    });

    res.status(201).json({ message: 'Reply added successfully', reply: newReply, ...rewardPayload });
  } catch (error) {
    res.status(500).json({ message: 'Error adding reply', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
});

// Delete a comment (only by owner or comment author)
router.delete('/:id/comments/:commentId', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const challenge = await Challenge.findById(req.params.id);
    if (!challenge) {
      return res.status(404).json({ message: 'Challenge not found' });
    }

    const comment = challenge.comments.id(req.params.commentId);
    if (!comment) {
      return res.status(404).json({ message: 'Comment not found' });
    }

    // Check if user is owner or comment author
    const ownerId = challenge.owner?._id || challenge.owner;
    const commentUserId = comment.userId?._id || comment.userId;
    
    if (ownerId.toString() !== userId.toString() && commentUserId.toString() !== userId.toString()) {
      return res.status(403).json({ message: 'You are not authorized to delete this comment' });
    }

    comment.deleteOne();
    await challenge.save();

    res.json({ message: 'Comment deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting comment', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
});

// Get the current user's private diary entries (owner only)
router.get('/:id/diary', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const challenge = await Challenge.findById(req.params.id)
      .populate('userDiaryEntries.userId', 'name avatarUrl')
      .select('userDiaryEntries owner allowComments');

    if (!challenge) {
      return res.status(404).json({ message: 'Challenge not found' });
    }

    const ownerId = challenge.owner?._id || challenge.owner;
    if (!ownerId || ownerId.toString() !== userId.toString()) {
      return res.status(403).json({ message: 'You are not authorized to view this diary' });
    }

    const entries = (challenge.userDiaryEntries || []).filter((entry) => {
      const entryUserId = entry.userId?._id || entry.userId;
      return entryUserId && entryUserId.toString() === userId.toString();
    });

    res.json({ entries });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching diary entries', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
});

// Add a private diary entry (owner only), optionally sharing it to the community feed
router.post('/:id/diary', authenticateToken, async (req, res) => {
  try {
    const { text, imageUrl, shareToCommunity, isTriumph, actionTitle } = req.body;
    const userId = req.user.id;
    const triumphEntry = isTriumph === true;

    if ((!text || !text.trim()) && !imageUrl) {
      return res.status(400).json({ message: 'Diary text or image is required' });
    }

    const challenge = await Challenge.findById(req.params.id).populate('owner', '_id');
    if (!challenge) {
      return res.status(404).json({ message: 'Challenge not found' });
    }

    const ownerId = challenge.owner?._id || challenge.owner;
    if (!ownerId || ownerId.toString() !== userId.toString()) {
      return res.status(403).json({ message: 'You are not authorized to write in this diary' });
    }

    const entryData = {
      userId,
      text: (text && text.trim()) ? text.trim() : '',
      imageUrl: imageUrl || null,
      isTriumph: triumphEntry,
      actionTitle: (actionTitle && String(actionTitle).trim()) ? String(actionTitle).trim() : '',
      createdAt: new Date()
    };

    challenge.userDiaryEntries.push(entryData);

    let sharedCommentId = null;
    const shouldShareToCommunity =
      challenge.allowComments && (shareToCommunity === true || triumphEntry);

    if (shouldShareToCommunity) {
      challenge.comments.push({
        userId,
        text: entryData.text,
        imageUrl: entryData.imageUrl,
        isTriumph: triumphEntry,
        actionTitle: entryData.actionTitle || '',
        createdAt: new Date()
      });
    }

    await challenge.save();

    await challenge.populate('userDiaryEntries.userId', 'name avatarUrl');

    const newEntry = challenge.userDiaryEntries[challenge.userDiaryEntries.length - 1];

    if (shouldShareToCommunity) {
      const sharedComment = challenge.comments[challenge.comments.length - 1];
      sharedCommentId = sharedComment?._id || null;
    }

    res.status(201).json({
      message: 'Diary entry added successfully',
      entry: newEntry,
      sharedCommentId
    });
  } catch (error) {
    res.status(500).json({ message: 'Error adding diary entry', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
});

// Delete a private diary entry (owner / author only)
router.delete('/:id/diary/:entryId', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const challenge = await Challenge.findById(req.params.id);
    if (!challenge) {
      return res.status(404).json({ message: 'Challenge not found' });
    }

    const entry = challenge.userDiaryEntries.id(req.params.entryId);
    if (!entry) {
      return res.status(404).json({ message: 'Diary entry not found' });
    }

    const entryUserId = entry.userId?._id || entry.userId;
    if (!entryUserId || entryUserId.toString() !== userId.toString()) {
      return res.status(403).json({ message: 'You are not authorized to delete this diary entry' });
    }

    entry.deleteOne();
    await challenge.save();

    res.json({ message: 'Diary entry deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting diary entry', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
});

// Reply to a reply (nested reply)
router.post('/:id/comments/:commentId/replies/:replyId/reply', authenticateToken, async (req, res) => {
  try {
    const { text, mentionedUserId, imageUrl } = req.body;
    const userId = req.user.id;

    if (!text || !text.trim()) {
      return res.status(400).json({ message: 'Reply text is required' });
    }

    const challenge = await Challenge.findById(req.params.id).populate('owner', '_id');
    if (!challenge) {
      return res.status(404).json({ message: 'Challenge not found' });
    }

    if (!challenge.allowComments) {
      return res.status(403).json({ message: 'Comments are disabled for this challenge' });
    }

    const comment = challenge.comments.id(req.params.commentId);
    if (!comment) {
      return res.status(404).json({ message: 'Comment not found' });
    }

    const parentReply = comment.replies.id(req.params.replyId);
    if (!parentReply) {
      return res.status(404).json({ message: 'Reply not found' });
    }

    const nestedReply = {
      userId,
      text: text.trim(),
      imageUrl: imageUrl || null,
      mentionedUserId: mentionedUserId || null,
      createdAt: new Date()
    };

    parentReply.replies.push(nestedReply);
    await challenge.save();

    const ownerId = challenge.owner?._id || challenge.owner;
    const { finalUser, sparksResults } = await maybeAwardMissionCommentSparks(
      req,
      userId,
      challenge,
      ownerId
    );

    // Re-fetch and populate user info for the new nested reply
    const User = require('../models/User');
    const updatedChallenge = await Challenge.findById(req.params.id)
      .populate('comments.userId', 'name avatarUrl')
      .populate('comments.replies.userId', 'name avatarUrl')
      .populate('comments.replies.mentionedUserId', 'name avatarUrl');
    
    const updatedComment = updatedChallenge.comments.id(req.params.commentId);
    const updatedParentReply = updatedComment.replies.id(req.params.replyId);
    const newNestedReply = updatedParentReply.replies[updatedParentReply.replies.length - 1];
    
    // Manually populate the nested reply user data
    if (newNestedReply.userId) {
      const userId = newNestedReply.userId._id || newNestedReply.userId;
      const user = await User.findById(userId).select('name avatarUrl');
      if (user) {
        newNestedReply.userId = user;
      }
    }
    if (newNestedReply.mentionedUserId) {
      const mentionedUserId = newNestedReply.mentionedUserId._id || newNestedReply.mentionedUserId;
      const mentionedUser = await User.findById(mentionedUserId).select('name avatarUrl');
      if (mentionedUser) {
        newNestedReply.mentionedUserId = mentionedUser;
      }
    }
    
    if (mentionedUserId) {
      await notifyChallengeCommentRecipient({
        recipientUserId: mentionedUserId,
        fromUserId: userId,
        challenge,
        type: 'mention',
        commentId: comment._id,
        replyId: newNestedReply._id
      });
    }

    const rewardPayload = buildRewardPayload({
      user: serializeUserForClient(finalUser),
      sparksResults
    });
    
    // Return the properly populated nested reply
    res.status(201).json({ 
      message: 'Nested reply added successfully', 
      reply: newNestedReply,
      parentReply: updatedParentReply,
      comment: updatedComment,
      ...rewardPayload
    });
  } catch (error) {
    res.status(500).json({ message: 'Error adding nested reply', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
});

// Delete a reply (only by owner, comment author, or reply author)
router.delete('/:id/comments/:commentId/replies/:replyId', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const challenge = await Challenge.findById(req.params.id);
    if (!challenge) {
      return res.status(404).json({ message: 'Challenge not found' });
    }

    const comment = challenge.comments.id(req.params.commentId);
    if (!comment) {
      return res.status(404).json({ message: 'Comment not found' });
    }

    const reply = comment.replies.id(req.params.replyId);
    if (!reply) {
      return res.status(404).json({ message: 'Reply not found' });
    }

    // Check if user is owner, comment author, or reply author
    const ownerId = challenge.owner?._id || challenge.owner;
    const commentUserId = comment.userId?._id || comment.userId;
    const replyUserId = reply.userId?._id || reply.userId;
    
    if (ownerId.toString() !== userId.toString() && 
        commentUserId.toString() !== userId.toString() && 
        replyUserId.toString() !== userId.toString()) {
      return res.status(403).json({ message: 'You are not authorized to delete this reply' });
    }

    reply.deleteOne();
    await challenge.save();

    res.json({ message: 'Reply deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting reply', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
});

// Delete a nested reply
router.delete('/:id/comments/:commentId/replies/:replyId/replies/:nestedReplyId', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const challenge = await Challenge.findById(req.params.id);
    if (!challenge) {
      return res.status(404).json({ message: 'Challenge not found' });
    }

    const comment = challenge.comments.id(req.params.commentId);
    if (!comment) {
      return res.status(404).json({ message: 'Comment not found' });
    }

    const parentReply = comment.replies.id(req.params.replyId);
    if (!parentReply) {
      return res.status(404).json({ message: 'Parent reply not found' });
    }

    const nestedReply = parentReply.replies.id(req.params.nestedReplyId);
    if (!nestedReply) {
      return res.status(404).json({ message: 'Nested reply not found' });
    }

    // Check if user is owner, comment author, parent reply author, or nested reply author
    const ownerId = challenge.owner?._id || challenge.owner;
    const commentUserId = comment.userId?._id || comment.userId;
    const parentReplyUserId = parentReply.userId?._id || parentReply.userId;
    const nestedReplyUserId = nestedReply.userId?._id || nestedReply.userId;
    
    if (ownerId.toString() !== userId.toString() && 
        commentUserId.toString() !== userId.toString() && 
        parentReplyUserId.toString() !== userId.toString() &&
        nestedReplyUserId.toString() !== userId.toString()) {
      return res.status(403).json({ message: 'You are not authorized to delete this nested reply' });
    }

    nestedReply.deleteOne();
    await challenge.save();

    res.json({ message: 'Nested reply deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting nested reply', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
});

// Add or remove reaction to a comment
router.post('/:id/comments/:commentId/reactions', authenticateToken, async (req, res) => {
  try {
    const { emoji } = req.body;
    const userId = req.user.id;

    if (!emoji) {
      return res.status(400).json({ message: 'Emoji is required' });
    }

    const challenge = await Challenge.findById(req.params.id);
    if (!challenge) {
      return res.status(404).json({ message: 'Challenge not found' });
    }

    const comment = challenge.comments.id(req.params.commentId);
    if (!comment) {
      return res.status(404).json({ message: 'Comment not found' });
    }

    // Initialize reactions Map if it doesn't exist
    if (!comment.reactions) {
      comment.reactions = new Map();
    }

    // Get or create the emoji array
    if (!comment.reactions.has(emoji)) {
      comment.reactions.set(emoji, []);
    }

    const emojiReactions = comment.reactions.get(emoji);
    const userIdStr = userId.toString();

    // Check if user already reacted
    const existingIndex = emojiReactions.findIndex(r => {
      const rUserId = r.userId?._id || r.userId;
      return rUserId && rUserId.toString() === userIdStr;
    });

    if (existingIndex >= 0) {
      // Remove reaction
      emojiReactions.splice(existingIndex, 1);
      if (emojiReactions.length === 0) {
        comment.reactions.delete(emoji);
      }
    } else {
      // Add reaction
      emojiReactions.push({ userId });
    }

    await challenge.save();

    // Populate user info for reactions
    const User = require('../models/User');
    const populatedReactions = {};
    for (const [emojiKey, reactions] of comment.reactions.entries()) {
      populatedReactions[emojiKey] = await Promise.all(
        reactions.map(async (r) => {
          if (r.userId && !r.userId.name) {
            const uid = r.userId._id || r.userId;
            const user = await User.findById(uid).select('name avatarUrl');
            return { userId: user || r.userId };
          }
          return r;
        })
      );
    }

    res.json({ 
      message: existingIndex >= 0 ? 'Reaction removed' : 'Reaction added',
      reactions: populatedReactions
    });
  } catch (error) {
    res.status(500).json({ message: 'Error updating reaction', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
});

// Add or remove reaction to a reply
router.post('/:id/comments/:commentId/replies/:replyId/reactions', authenticateToken, async (req, res) => {
  try {
    const { emoji } = req.body;
    const userId = req.user.id;

    if (!emoji) {
      return res.status(400).json({ message: 'Emoji is required' });
    }

    const challenge = await Challenge.findById(req.params.id);
    if (!challenge) {
      return res.status(404).json({ message: 'Challenge not found' });
    }

    const comment = challenge.comments.id(req.params.commentId);
    if (!comment) {
      return res.status(404).json({ message: 'Comment not found' });
    }

    const reply = comment.replies.id(req.params.replyId);
    if (!reply) {
      return res.status(404).json({ message: 'Reply not found' });
    }

    // Initialize reactions Map if it doesn't exist
    if (!reply.reactions) {
      reply.reactions = new Map();
    }

    // Get or create the emoji array
    if (!reply.reactions.has(emoji)) {
      reply.reactions.set(emoji, []);
    }

    const emojiReactions = reply.reactions.get(emoji);
    const userIdStr = userId.toString();

    // Check if user already reacted
    const existingIndex = emojiReactions.findIndex(r => {
      const rUserId = r.userId?._id || r.userId;
      return rUserId && rUserId.toString() === userIdStr;
    });

    if (existingIndex >= 0) {
      // Remove reaction
      emojiReactions.splice(existingIndex, 1);
      if (emojiReactions.length === 0) {
        reply.reactions.delete(emoji);
      }
    } else {
      // Add reaction
      emojiReactions.push({ userId });
    }

    await challenge.save();

    // Populate user info for reactions
    const User = require('../models/User');
    const populatedReactions = {};
    for (const [emojiKey, reactions] of reply.reactions.entries()) {
      populatedReactions[emojiKey] = await Promise.all(
        reactions.map(async (r) => {
          if (r.userId && !r.userId.name) {
            const uid = r.userId._id || r.userId;
            const user = await User.findById(uid).select('name avatarUrl');
            return { userId: user || r.userId };
          }
          return r;
        })
      );
    }

    res.json({ 
      message: existingIndex >= 0 ? 'Reaction removed' : 'Reaction added',
      reactions: populatedReactions
    });
  } catch (error) {
    res.status(500).json({ message: 'Error updating reaction', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
});

// Add or remove reaction to a nested reply
router.post('/:id/comments/:commentId/replies/:replyId/replies/:nestedReplyId/reactions', authenticateToken, async (req, res) => {
  try {
    const { emoji } = req.body;
    const userId = req.user.id;

    if (!emoji) {
      return res.status(400).json({ message: 'Emoji is required' });
    }

    const challenge = await Challenge.findById(req.params.id);
    if (!challenge) {
      return res.status(404).json({ message: 'Challenge not found' });
    }

    const comment = challenge.comments.id(req.params.commentId);
    if (!comment) {
      return res.status(404).json({ message: 'Comment not found' });
    }

    const parentReply = comment.replies.id(req.params.replyId);
    if (!parentReply) {
      return res.status(404).json({ message: 'Reply not found' });
    }

    const nestedReply = parentReply.replies.id(req.params.nestedReplyId);
    if (!nestedReply) {
      return res.status(404).json({ message: 'Nested reply not found' });
    }

    // Initialize reactions Map if it doesn't exist
    if (!nestedReply.reactions) {
      nestedReply.reactions = new Map();
    }

    // Get or create the emoji array
    if (!nestedReply.reactions.has(emoji)) {
      nestedReply.reactions.set(emoji, []);
    }

    const emojiReactions = nestedReply.reactions.get(emoji);
    const userIdStr = userId.toString();

    // Check if user already reacted
    const existingIndex = emojiReactions.findIndex(r => {
      const rUserId = r.userId?._id || r.userId;
      return rUserId && rUserId.toString() === userIdStr;
    });

    if (existingIndex >= 0) {
      // Remove reaction
      emojiReactions.splice(existingIndex, 1);
      if (emojiReactions.length === 0) {
        nestedReply.reactions.delete(emoji);
      }
    } else {
      // Add reaction
      emojiReactions.push({ userId });
    }

    await challenge.save();

    // Populate user info for reactions
    const User = require('../models/User');
    const populatedReactions = {};
    for (const [emojiKey, reactions] of nestedReply.reactions.entries()) {
      populatedReactions[emojiKey] = await Promise.all(
        reactions.map(async (r) => {
          if (r.userId && !r.userId.name) {
            const uid = r.userId._id || r.userId;
            const user = await User.findById(uid).select('name avatarUrl');
            return { userId: user || r.userId };
          }
          return r;
        })
      );
    }

    res.json({ 
      message: existingIndex >= 0 ? 'Reaction removed' : 'Reaction added',
      reactions: populatedReactions
    });
  } catch (error) {
    res.status(500).json({ message: 'Error updating reaction', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
});

module.exports = router;
