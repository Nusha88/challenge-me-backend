const express = require('express');
const router = express.Router();
const Challenge = require('../models/Challenge');
const User = require('../models/User');
const { getClientDayRange, normalizeDateLikeToYmd } = require('../utils/dateHelpers');
const { findByClientDay, upsertChecklist } = require('../utils/dailyChecklistService');
const {
  isResultChallengeCompleted,
  collectNewlyCheckedActionIds,
  enrichChallengesWithWatchState
} = require('../utils/challengeHelpers');
const { getLocalizedCommentPush } = require('../utils/notificationMessages');
const {
  awardFirstCommentXp,
  awardHabitDayXp,
  awardHabitCompletionXp,
  awardResultActionXp,
  awardResultCompletionXp
} = require('../utils/xpService');

function decodeOptionalAuthUserId(req) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return null;
  const token = authHeader.split(' ')[1];
  if (!token) return null;
  try {
    const jwt = require('jsonwebtoken');
    const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey';
    const decoded = jwt.verify(token, JWT_SECRET);
    return decoded?.id || null;
  } catch {
    return null;
  }
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

  const Notification = require('../models/Notification');
  const { sendPushNotification } = require('../utils/pushService');

  try {
    const notification = await Notification.create({
      userId: recipientUserId,
      type,
      challengeId: challenge._id,
      commentId: commentId || null,
      replyId: replyId || null,
      fromUserId,
      read: false
    });

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

    await sendPushNotification(recipientUserId, {
      title: pushTitle,
      body: pushBody,
      data: {
        notificationId: notification._id.toString(),
        challengeId: challenge._id.toString(),
        type
      },
      tag: `challenge-${challenge._id}`
    });
  } catch (notificationError) {
    console.error('Error creating comment/mention notification:', notificationError);
  }
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
router.post('/', async (req, res) => {
  try {
    const { title, description, startDate, endDate, owner, imageUrl, privacy, challengeType, frequency, actions, completedDays, allowComments, difficulty, reward } = req.body;

    if (!title || !startDate || !endDate || !owner) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    const challengeData = { 
      title, 
      description: description || '', 
      startDate, 
      endDate, 
      owner, 
      difficulty: difficulty || 'medium',
      participants: [{ userId: owner, completedDays: [] }] 
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
    }
    if (actions && challengeType === 'result') {
      challengeData.actions = actions;
    }
    if (challengeType === 'result') {
      challengeData.reward = typeof reward === 'string' ? reward.trim() : '';
    }
    if (completedDays && challengeType === 'habit') {
      challengeData.completedDays = completedDays;
    }
    if (allowComments !== undefined) {
      challengeData.allowComments = allowComments;
    }

    const challenge = new Challenge(challengeData);
    await challenge.save();

    res.status(201).json({
      message: 'Challenge created successfully',
      challenge
    });
  } catch (error) {
    res.status(500).json({ message: 'Error creating challenge', error: error.message });
  }
});

// Update challenge actions progress (Result Challenges)
router.patch('/:id/actions', async (req, res) => {
  try {
    const { id } = req.params;
    const { actions } = req.body;

    if (!actions || !Array.isArray(actions)) {
      return res.status(400).json({ message: 'Actions array is required' });
    }

    const challenge = await Challenge.findById(id);
    if (!challenge) {
      return res.status(404).json({ message: 'Challenge not found' });
    }

    if (challenge.challengeType !== 'result' && challenge.challengeType !== 'habit') {
      return res.status(400).json({ message: 'This route is only for result or habit challenges' });
    }

    const authUserId = decodeOptionalAuthUserId(req);
    if (!authUserId) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    // Security check: only owner can update progress of result challenge
    const ownerId = challenge.owner?._id || challenge.owner;
    if (authUserId.toString() !== ownerId.toString()) {
      return res.status(403).json({ message: 'You are not authorized to update this challenge' });
    }

    const prevActions = JSON.parse(JSON.stringify(challenge.actions || []));
    const wasCompletedBefore = isResultChallengeCompleted(prevActions);

    challenge.actions = actions;
    await challenge.save();

    const isCompletedNow = isResultChallengeCompleted(challenge.actions);

    const user = await User.findById(authUserId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    let updatedUser = user;
    const xpResults = [];

    if (challenge.challengeType === 'result') {
      const newlyCheckedActionIds = collectNewlyCheckedActionIds(
        prevActions,
        challenge.actions
      );

      for (const actionId of newlyCheckedActionIds) {
        const xpResult = await awardResultActionXp(authUserId, challenge._id, actionId);
        xpResults.push(xpResult);
        if (xpResult.awarded && xpResult.user) {
          updatedUser = xpResult.user;
        }
      }

      if (!wasCompletedBefore && isCompletedNow) {
        const completionXpResult = await awardResultCompletionXp(authUserId, challenge);
        xpResults.push(completionXpResult);
        if (completionXpResult.awarded && completionXpResult.user) {
          updatedUser = completionXpResult.user;
        }
      }
    }

    const xpGainedTotal = xpResults.reduce((sum, item) => sum + item.xpGained, 0);
    const xpEvents = xpResults.map((item) => ({
      awarded: item.awarded,
      gained: item.xpGained,
      reason: item.reason || null,
      eventKey: item.eventKey || null
    }));

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

    res.json({
      message: 'Actions updated successfully',
      challenge,
      xpGained: xpGainedTotal,
      xp: updatedUser?.xp,
      user: updatedUser,
      xpAward: {
        gained: xpGainedTotal,
        events: xpEvents
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Error updating actions', error: error.message });
  }
});

// Update challenge
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, startDate, endDate, owner, imageUrl, privacy, challengeType, frequency, actions, completedDays, allowComments, difficulty, reward } = req.body;

    if (!title || !startDate || !endDate) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    // Load existing challenge
    const existingChallenge = await Challenge.findById(id);

    if (!existingChallenge) {
      return res.status(404).json({ message: 'Challenge not found' });
    }

    const authUserId = decodeOptionalAuthUserId(req);
    const isAdmin = false; 

    // Security check: only owner can update challenge details
    const ownerId = existingChallenge.owner?._id || existingChallenge.owner;
    if (!authUserId || (authUserId.toString() !== ownerId.toString() && !isAdmin)) {
      return res.status(403).json({ message: 'You are not authorized to update this challenge' });
    }

    const effectiveOwnerId = owner || existingChallenge.owner;

    const update = { title, description: description || '', startDate, endDate };
    if (owner) {
      update.owner = owner;
    }
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
      update.actions = actions;
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

    let xpGainedTotal = 0;
    let updatedUser = null;
    const putXpResults = [];

    if (actions !== undefined && authUserId && challenge.challengeType === 'result') {
      const user = await User.findById(authUserId);
      if (user) {
        updatedUser = user;
        const isCompletedNowPut = isResultChallengeCompleted(challenge.actions);
        const newlyCheckedActionIds = collectNewlyCheckedActionIds(
          prevActions,
          challenge.actions
        );

        for (const actionId of newlyCheckedActionIds) {
          const xpResult = await awardResultActionXp(authUserId, challenge._id, actionId);
          putXpResults.push(xpResult);
          if (xpResult.awarded && xpResult.user) {
            updatedUser = xpResult.user;
          }
        }

        if (!wasCompletedBeforePut && isCompletedNowPut) {
          const completionXpResult = await awardResultCompletionXp(authUserId, challenge);
          putXpResults.push(completionXpResult);
          if (completionXpResult.awarded && completionXpResult.user) {
            updatedUser = completionXpResult.user;
          }
        }

        xpGainedTotal = putXpResults.reduce((sum, item) => sum + item.xpGained, 0);
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

    res.json({
      message: 'Challenge updated successfully',
      challenge,
      xpGained: xpGainedTotal,
      xp: updatedUser?.xp,
      user: updatedUser,
      ...(putXpResults.length > 0
        ? {
            xpAward: {
              gained: xpGainedTotal,
              events: putXpResults.map((item) => ({
                awarded: item.awarded,
                gained: item.xpGained,
                reason: item.reason || null,
                eventKey: item.eventKey || null
              }))
            }
          }
        : {})
    });
  } catch (error) {
    res.status(500).json({ message: 'Error updating challenge', error: error.message });
  }
});

// Join challenge
router.post('/:id/join', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ message: 'User ID is required to join a challenge' });
    }

    const challenge = await Challenge.findById(id);

    if (!challenge) {
      return res.status(404).json({ message: 'Challenge not found' });
    }

    // Only habit challenges can be joined
    if (challenge.challengeType !== 'habit') {
      return res.status(400).json({ message: 'Only habit challenges can be joined' });
    }

    // Check if user is already a participant
    const existingParticipant = challenge.participants.find(
      p => p.userId && p.userId.toString() === userId.toString()
    );
    
    if (existingParticipant) {
      return res.status(400).json({ message: 'You have already joined this challenge' });
    }

    // Add new participant with empty completedDays array
    challenge.participants.push({ userId, completedDays: [] });
    await challenge.save();

    // Create notification for challenge owner if they are not the one joining
    const ownerId = challenge.owner?._id || challenge.owner;
    if (ownerId && ownerId.toString() !== userId.toString()) {
      const Notification = require('../models/Notification');
      const { sendPushNotification } = require('../utils/pushService');
      const User = require('../models/User');
      
      try {
        const notification = await Notification.create({
          userId: ownerId,
          type: 'join',
          challengeId: challenge._id,
          fromUserId: userId,
          read: false
        });
        
        // Send push notification
        const fromUser = await User.findById(userId, 'name');
        await sendPushNotification(ownerId, {
          title: 'New Participant',
          body: `${fromUser?.name || 'Someone'} joined your challenge "${challenge.title}"`,
          data: {
            notificationId: notification._id.toString(),
            challengeId: challenge._id.toString(),
            type: 'join'
          },
          tag: `challenge-${challenge._id}`
        });
      } catch (notificationError) {
        // Log error but don't fail the join operation
        console.error('Error creating join notification:', notificationError);
      }
    }

    res.json({
      message: 'Successfully joined the challenge',
      challenge
    });
  } catch (error) {
    res.status(500).json({ message: 'Error joining challenge', error: error.message });
  }
});

// Leave challenge
router.post('/:id/leave', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ message: 'User ID is required' });
    }

    const challenge = await Challenge.findById(id)
      .populate('owner', 'name avatarUrl')
      .populate('participants.userId', 'name avatarUrl');

    if (!challenge) {
      return res.status(404).json({ message: 'Challenge not found' });
    }

    // Check if user is a participant
    const participantIndex = challenge.participants.findIndex(
      p => (p.userId?._id || p.userId || p._id || p).toString() === userId.toString()
    );

    if (participantIndex === -1) {
      return res.status(400).json({ message: 'You are not a participant of this challenge' });
    }

    // Remove participant
    challenge.participants.splice(participantIndex, 1);
    await challenge.save();

    // Refresh challenge data
    const updatedChallenge = await Challenge.findById(id)
      .populate('owner', 'name avatarUrl')
      .populate('participants.userId', 'name avatarUrl');

    res.json({
      message: 'Successfully left the challenge',
      challenge: updatedChallenge
    });
  } catch (error) {
    res.status(500).json({ message: 'Error leaving challenge', error: error.message });
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
    if (title && title.trim()) {
      query.title = { $regex: title.trim(), $options: 'i' }; // Case-insensitive search
    }
    
    // Filter by owner (createdBy is an alias for owner)
    if (owner || createdBy) {
      query.owner = owner || createdBy;
    }
    
    // Filter by privacy - exclude private challenges
    query.privacy = { $ne: 'private' };
    
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
    res.status(500).json({ message: 'Error fetching challenges', error: error.message });
  }
});

// Update participant's completedDays (HABIT CHALLENGE ONLY)
router.put('/:id/participant/:userId/completedDays', async (req, res) => {
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

    const authUserId = decodeOptionalAuthUserId(req);
    // Security: Only the user themselves can update their progress
    if (!authUserId || authUserId.toString() !== userId.toString()) {
      return res.status(403).json({ message: 'You are not authorized to update this progress' });
    }

    const prevCompletedDays = Array.isArray(challenge.participants[participantIndex].completedDays)
      ? challenge.participants[participantIndex].completedDays
      : [];

    const prevCompletedDayKeys = new Set(
      prevCompletedDays
        .map((day) => normalizeDateLikeToYmd(day))
        .filter(Boolean)
    );

    const addedDays = completedDays.filter((day) => !prevCompletedDayKeys.has(day));

    challenge.participants[participantIndex].completedDays = completedDays;
    await challenge.save();

    const userSelect = 'name email avatarUrl createdAt _id xp';
    let updatedUser = await User.findById(userId).select(userSelect);
    const xpResults = [];

    for (const day of addedDays) {
      const xpResult = await awardHabitDayXp(userId, challenge._id, day);
      xpResults.push(xpResult);
      if (xpResult.awarded && xpResult.user) {
        updatedUser = xpResult.user;
      }
    }

    let completionXpResult = null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endDate = new Date(challenge.endDate);
    endDate.setHours(0, 0, 0, 0);

    if (endDate < today && completedDays.length > 0) {
      completionXpResult = await awardHabitCompletionXp(userId, challenge._id);
      if (completionXpResult.awarded && completionXpResult.user) {
        updatedUser = completionXpResult.user;
      }
    }

    const dayXpGained = xpResults.reduce((sum, item) => sum + item.xpGained, 0);
    const completionXpGained = completionXpResult?.xpGained || 0;
    const xpGainedTotal = dayXpGained + completionXpGained;

    const xpEvents = [
      ...xpResults.map((item) => ({
        awarded: item.awarded,
        gained: item.xpGained,
        reason: item.reason || null,
        eventKey: item.eventKey || null
      })),
      ...(completionXpResult
        ? [{
            awarded: completionXpResult.awarded,
            gained: completionXpResult.xpGained,
            reason: completionXpResult.reason || null,
            eventKey: completionXpResult.eventKey || null
          }]
        : [])
    ];

    res.json({
      message: 'Completed days updated successfully',
      challenge,
      xpGained: xpGainedTotal,
      xp: updatedUser?.xp,
      user: updatedUser,
      xpAward: {
        gained: xpGainedTotal,
        events: xpEvents
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Error updating completed days', error: error.message });
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
    res.status(500).json({ message: 'Error fetching challenges', error: error.message });
  }
});

// Get challenge by ID (must be after more specific routes like /user/:userId)
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const challenge = await Challenge.findById(id)
      .populate('owner', 'name avatarUrl')
      .populate('participants.userId', 'name avatarUrl');
    
    if (!challenge) {
      return res.status(404).json({ message: 'Challenge not found' });
    }
    
    // Add watchers count
    const User = require('../models/User');
    const watchersCount = await User.countDocuments({ watchedChallenges: challenge._id });
    const challengeObj = challenge.toObject();
    challengeObj.watchersCount = watchersCount;
    
    res.json(challengeObj);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching challenge', error: error.message });
  }
});

// Delete challenge
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const challenge = await Challenge.findById(id);

    if (!challenge) {
      return res.status(404).json({ message: 'Challenge not found' });
    }

    await Challenge.findByIdAndDelete(id);

    res.json({
      message: 'Challenge deleted successfully'
    });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting challenge', error: error.message });
  }
});

// Watch a challenge
router.post('/:id/watch', async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({ message: 'User ID is required' });
    }

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

    // Create notification for challenge owner if they are not the one watching
    const ownerId = challenge.owner?._id || challenge.owner;
    if (ownerId && ownerId.toString() !== userId.toString()) {
      const Notification = require('../models/Notification');
      const { sendPushNotification } = require('../utils/pushService');
      const User = require('../models/User');
      
      try {
        const notification = await Notification.create({
          userId: ownerId,
          type: 'watch',
          challengeId: challenge._id,
          fromUserId: userId,
          read: false
        });
        
        // Send push notification
        const fromUser = await User.findById(userId, 'name');
        await sendPushNotification(ownerId, {
          title: 'New Follower',
          body: `${fromUser?.name || 'Someone'} started watching your challenge "${challenge.title}"`,
          data: {
            notificationId: notification._id.toString(),
            challengeId: challenge._id.toString(),
            type: 'watch'
          },
          tag: `challenge-${challenge._id}`
        });
      } catch (notificationError) {
        // Log error but don't fail the watch operation
        console.error('Error creating watch notification:', notificationError);
      }
    }

    res.json({ message: 'Challenge added to watch list', watchedChallenges: user.watchedChallenges });
  } catch (error) {
    res.status(500).json({ message: 'Error watching challenge', error: error.message });
  }
});

// Unwatch a challenge
router.post('/:id/unwatch', async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({ message: 'User ID is required' });
    }

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

    res.json({ message: 'Challenge removed from watch list', watchedChallenges: user.watchedChallenges });
  } catch (error) {
    res.status(500).json({ message: 'Error unwatching challenge', error: error.message });
  }
});

// Get watched challenges for a user
router.get('/watched/:userId', async (req, res) => {
  try {
    const user = await User.findById(req.params.userId).populate('watchedChallenges');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Populate challenge details
    const challenges = await Challenge.find({ _id: { $in: user.watchedChallenges } })
      .populate('owner', 'name avatarUrl')
      .populate('participants.userId', 'name avatarUrl')
      .sort({ createdAt: -1 });

    // Add watchers count to each challenge
    const challengesWithWatchers = await Promise.all(challenges.map(async (challenge) => {
      const watchersCount = await User.countDocuments({ watchedChallenges: challenge._id });
      const challengeObj = challenge.toObject();
      challengeObj.watchersCount = watchersCount;
      return challengeObj;
    }));

    res.json({ challenges: challengesWithWatchers });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching watched challenges', error: error.message });
  }
});

// Add a comment to a challenge
router.post('/:id/comments', async (req, res) => {
  try {
    const { userId, text, imageUrl } = req.body;
    
    if (!userId) {
      return res.status(400).json({ message: 'User ID is required' });
    }
    
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
      text: (text && text.trim()) ? text.trim() : ' ',
      imageUrl: imageUrl || null,
      createdAt: new Date()
    };

    challenge.comments.push(comment);
    await challenge.save();

    // Populate user info for the new comment
    await challenge.populate('comments.userId', 'name avatarUrl');

    const newComment = challenge.comments[challenge.comments.length - 1];
    
    let xpGained = 0;
    let xpAward = { awarded: false, gained: 0, reason: null };
    let finalUser = userId ? await User.findById(userId).select('xp') : null;

    if (userId) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const endDate = new Date(challenge.endDate);
      endDate.setHours(0, 0, 0, 0);
      const isActive = endDate >= today;

      let isFinished = false;
      if (challenge.challengeType === 'result') {
        if (challenge.actions && Array.isArray(challenge.actions) && challenge.actions.length > 0) {
          isFinished = challenge.actions.every(action => {
            if (!action.checked) return false;
            if (action.children && Array.isArray(action.children) && action.children.length > 0) {
              return action.children.every(child => child.checked);
            }
            return true;
          });
        }
      } else {
        isFinished = endDate < today;
      }

      if (isActive && !isFinished) {
        const xpResult = await awardFirstCommentXp(userId, challenge._id);
        xpAward = {
          awarded: xpResult.awarded,
          gained: xpResult.xpGained,
          reason: xpResult.reason || null
        };

        if (xpResult.awarded) {
          xpGained = xpResult.xpGained;
          finalUser = xpResult.user;
        }
      }
    }
    
    // Notify challenge owner (same flow as mention notifications)
    const ownerId = challenge.owner?._id || challenge.owner;
    if (ownerId) {
      await notifyChallengeCommentRecipient({
        recipientUserId: ownerId,
        fromUserId: userId,
        challenge,
        type: 'comment',
        commentId: newComment._id
      });
    }
    
    res.status(201).json({
      message: 'Comment added successfully',
      comment: newComment,
      xpGained,
      xp: finalUser?.xp,
      xpAward
    });
  } catch (error) {
    res.status(500).json({ message: 'Error adding comment', error: error.message });
  }
});

// Get comments for a challenge
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

    // Manually populate nested replies (replies to replies) since Mongoose doesn't support deep nested populate
    const User = require('../models/User');
    for (const comment of challenge.comments) {
      if (comment.replies && comment.replies.length > 0) {
        for (const reply of comment.replies) {
          if (reply.replies && reply.replies.length > 0) {
            for (const nestedReply of reply.replies) {
              // Populate userId for nested replies
              if (nestedReply.userId && !nestedReply.userId.name) {
                const userId = nestedReply.userId._id || nestedReply.userId;
                const user = await User.findById(userId).select('name avatarUrl');
                if (user) {
                  nestedReply.userId = user;
                }
              }
              // Populate mentionedUserId for nested replies
              if (nestedReply.mentionedUserId && !nestedReply.mentionedUserId.name) {
                const mentionedUserId = nestedReply.mentionedUserId._id || nestedReply.mentionedUserId;
                const mentionedUser = await User.findById(mentionedUserId).select('name avatarUrl');
                if (mentionedUser) {
                  nestedReply.mentionedUserId = mentionedUser;
                }
              }
            }
          }
        }
      }
    }

    res.json({ 
      comments: challenge.comments || [],
      allowComments: challenge.allowComments 
    });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching comments', error: error.message });
  }
});

// Reply to a comment
router.post('/:id/comments/:commentId/reply', async (req, res) => {
  try {
    const { userId, text, mentionedUserId, imageUrl } = req.body;
    
    if (!userId || !text || !text.trim()) {
      return res.status(400).json({ message: 'User ID and reply text are required' });
    }

    const challenge = await Challenge.findById(req.params.id);
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

    res.status(201).json({ message: 'Reply added successfully', reply: newReply });
  } catch (error) {
    res.status(500).json({ message: 'Error adding reply', error: error.message });
  }
});

// Delete a comment (only by owner or comment author)
router.delete('/:id/comments/:commentId', async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({ message: 'User ID is required' });
    }

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
    res.status(500).json({ message: 'Error deleting comment', error: error.message });
  }
});

// Reply to a reply (nested reply)
router.post('/:id/comments/:commentId/replies/:replyId/reply', async (req, res) => {
  try {
    const { userId, text, mentionedUserId, imageUrl } = req.body;
    
    if (!userId || !text || !text.trim()) {
      return res.status(400).json({ message: 'User ID and reply text are required' });
    }

    const challenge = await Challenge.findById(req.params.id);
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
    
    // Return the properly populated nested reply
    res.status(201).json({ 
      message: 'Nested reply added successfully', 
      reply: newNestedReply,
      parentReply: updatedParentReply,
      comment: updatedComment
    });
  } catch (error) {
    res.status(500).json({ message: 'Error adding nested reply', error: error.message });
  }
});

// Delete a reply (only by owner, comment author, or reply author)
router.delete('/:id/comments/:commentId/replies/:replyId', async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({ message: 'User ID is required' });
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
    res.status(500).json({ message: 'Error deleting reply', error: error.message });
  }
});

// Delete a nested reply
router.delete('/:id/comments/:commentId/replies/:replyId/replies/:nestedReplyId', async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({ message: 'User ID is required' });
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
    res.status(500).json({ message: 'Error deleting nested reply', error: error.message });
  }
});

// Add or remove reaction to a comment
router.post('/:id/comments/:commentId/reactions', async (req, res) => {
  try {
    const { userId, emoji } = req.body;
    
    if (!userId || !emoji) {
      return res.status(400).json({ message: 'User ID and emoji are required' });
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
    res.status(500).json({ message: 'Error updating reaction', error: error.message });
  }
});

// Add or remove reaction to a reply
router.post('/:id/comments/:commentId/replies/:replyId/reactions', async (req, res) => {
  try {
    const { userId, emoji } = req.body;
    
    if (!userId || !emoji) {
      return res.status(400).json({ message: 'User ID and emoji are required' });
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
    res.status(500).json({ message: 'Error updating reaction', error: error.message });
  }
});

// Add or remove reaction to a nested reply
router.post('/:id/comments/:commentId/replies/:replyId/replies/:nestedReplyId/reactions', async (req, res) => {
  try {
    const { userId, emoji } = req.body;
    
    if (!userId || !emoji) {
      return res.status(400).json({ message: 'User ID and emoji are required' });
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
    res.status(500).json({ message: 'Error updating reaction', error: error.message });
  }
});

module.exports = router;
