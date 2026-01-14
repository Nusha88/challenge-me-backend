const express = require('express');
const router = express.Router();
const Challenge = require('../models/Challenge');
const User = require('../models/User');

function getTodayUtcString() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
}

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

// Create challenge
router.post('/', async (req, res) => {
  try {
    const { title, description, startDate, endDate, owner, imageUrl, privacy, challengeType, frequency, actions, completedDays, allowComments } = req.body;

    if (!title || !description || !startDate || !endDate || !owner) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    const challengeData = { 
      title, 
      description, 
      startDate, 
      endDate, 
      owner, 
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

// Update challenge
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, startDate, endDate, owner, imageUrl, privacy, challengeType, frequency, actions, completedDays, allowComments } = req.body;

    if (!title || !description || !startDate || !endDate) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    const update = { title, description, startDate, endDate };
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
    if (frequency !== undefined && challengeType === 'habit') {
      update.frequency = frequency;
    } else if (challengeType === 'result') {
      update.frequency = null;
    }
    if (actions !== undefined && challengeType === 'result') {
      update.actions = actions;
    } else if (challengeType === 'habit') {
      update.actions = [];
    }
    if (allowComments !== undefined) {
      update.allowComments = allowComments;
    }
    const challenge = await Challenge.findByIdAndUpdate(id, update, {
      new: true,
      runValidators: true
    });

    if (!challenge) {
      return res.status(404).json({ message: 'Challenge not found' });
    }

    // Handle owner's completedDays - save to their participant entry
    if (challengeType === 'habit' && completedDays !== undefined && owner) {
      // Find owner's participant entry
      const ownerIndex = challenge.participants.findIndex(
        p => p.userId && p.userId.toString() === owner.toString()
      );
      
      if (ownerIndex !== -1) {
        // Update owner's completedDays in their participant entry
        challenge.participants[ownerIndex].completedDays = Array.isArray(completedDays) ? completedDays : [];
      } else {
        // If owner is not in participants, add them
        challenge.participants.push({ userId: owner, completedDays: Array.isArray(completedDays) ? completedDays : [] });
      }
      
      await challenge.save();
    }

    res.json({
      message: 'Challenge updated successfully',
      challenge
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
    const { excludeFinished, type, activity, participants, creationDate, page, limit, title, owner, popularity } = req.query;
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
    
    // Filter by owner
    if (owner) {
      query.owner = owner;
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
    
    // Apply excludeFinished filter (if excludeFinished is true, filter out finished challenges)
    if (excludeFinished === 'true' && !activity) {
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
    
    // Add watchers count to each challenge
    const User = require('../models/User');
    const challengesWithWatchers = await Promise.all(paginatedChallenges.map(async (challenge) => {
      const watchersCount = await User.countDocuments({ watchedChallenges: challenge._id });
      const challengeObj = challenge.toObject();
      challengeObj.watchersCount = watchersCount;
      return challengeObj;
    }));
    
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

// Update participant's completedDays
router.put('/:id/participant/:userId/completedDays', async (req, res) => {
  try {
    const { id, userId } = req.params;
    const { completedDays } = req.body;

    if (!completedDays || !Array.isArray(completedDays)) {
      return res.status(400).json({ message: 'completedDays must be an array' });
    }

    const challenge = await Challenge.findById(id);

    if (!challenge) {
      return res.status(404).json({ message: 'Challenge not found' });
    }

    // Find the participant
    const participantIndex = challenge.participants.findIndex(
      p => p.userId && p.userId.toString() === userId.toString()
    );

    if (participantIndex === -1) {
      return res.status(404).json({ message: 'Participant not found in this challenge' });
    }

    const authUserId = decodeOptionalAuthUserId(req);
    const prevCompletedDays = Array.isArray(challenge.participants[participantIndex].completedDays)
      ? [...challenge.participants[participantIndex].completedDays]
      : [];

    // Update completedDays for this participant
    challenge.participants[participantIndex].completedDays = completedDays;
    await challenge.save();

    // Award +5 XP only when today's date (UTC) is newly added, and only for the authenticated user updating themselves
    let xpGained = 0;
    let updatedUser = null;
    if (authUserId && authUserId.toString() === userId.toString()) {
      const todayStr = getTodayUtcString();
      const hadTodayBefore = prevCompletedDays.includes(todayStr);
      const hasTodayNow = completedDays.includes(todayStr);
      if (!hadTodayBefore && hasTodayNow) {
        xpGained = 5;
        updatedUser = await User.findByIdAndUpdate(
          userId,
          { $inc: { xp: xpGained } },
          { new: true, select: 'name email avatarUrl createdAt _id xp' }
        );
      }
    }

    res.json({
      message: 'Completed days updated successfully',
      challenge,
      xpGained,
      xp: updatedUser?.xp,
      user: updatedUser
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
    
    // Try to get authenticated user ID if token is provided (optional authentication)
    let requestingUserId = null;
    const authHeader = req.headers['authorization'];
    if (authHeader) {
      const token = authHeader.split(' ')[1];
      if (token) {
        try {
          const jwt = require('jsonwebtoken');
          const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey';
          const decoded = jwt.verify(token, JWT_SECRET);
          requestingUserId = decoded.id;
        } catch (err) {
          // Token invalid or expired, continue without authentication
        }
      }
    }

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

    // Add watchers count to each challenge
    const User = require('../models/User');
    const challengesWithWatchers = await Promise.all(allChallenges.map(async (challenge) => {
      const watchersCount = await User.countDocuments({ watchedChallenges: challenge._id });
      const challengeObj = challenge.toObject();
      challengeObj.watchersCount = watchersCount;
      return challengeObj;
    }));
    
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
    const { userId, text } = req.body;
    
    if (!userId || !text || !text.trim()) {
      return res.status(400).json({ message: 'User ID and comment text are required' });
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
      text: text.trim(),
      createdAt: new Date()
    };

    challenge.comments.push(comment);
    await challenge.save();

    // Populate user info for the new comment
    await challenge.populate('comments.userId', 'name avatarUrl');

    const newComment = challenge.comments[challenge.comments.length - 1];
    
    // Create notification for challenge owner if they are not the one commenting
    const ownerId = challenge.owner?._id || challenge.owner;
    if (ownerId && ownerId.toString() !== userId.toString()) {
      const Notification = require('../models/Notification');
      const { sendPushNotification } = require('../utils/pushService');
      const User = require('../models/User');
      
      try {
        const notification = await Notification.create({
          userId: ownerId,
          type: 'comment',
          challengeId: challenge._id,
          commentId: newComment._id,
          fromUserId: userId,
          read: false
        });
        
        // Send push notification
        const fromUser = await User.findById(userId, 'name');
        await sendPushNotification(ownerId, {
          title: 'New Comment',
          body: `${fromUser?.name || 'Someone'} commented on your challenge "${challenge.title}"`,
          data: {
            notificationId: notification._id.toString(),
            challengeId: challenge._id.toString(),
            type: 'comment'
          },
          tag: `challenge-${challenge._id}`
        });
      } catch (notificationError) {
        // Log error but don't fail the comment operation
        console.error('Error creating comment notification:', notificationError);
      }
    }
    
    res.status(201).json({ message: 'Comment added successfully', comment: newComment });
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
    const { userId, text, mentionedUserId } = req.body;
    
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
      mentionedUserId: mentionedUserId || null,
      createdAt: new Date()
    };

    comment.replies.push(reply);
    await challenge.save();

    // Populate user info for the new reply
    await challenge.populate('comments.replies.userId', 'name avatarUrl');
    await challenge.populate('comments.replies.mentionedUserId', 'name avatarUrl');

    const newReply = comment.replies[comment.replies.length - 1];
    
    // Create notification if user was mentioned
    if (mentionedUserId && mentionedUserId.toString() !== userId.toString()) {
      try {
        const Notification = require('../models/Notification');
        await Notification.create({
          userId: mentionedUserId,
          type: 'mention',
          challengeId: challenge._id,
          commentId: comment._id,
          replyId: newReply._id,
          fromUserId: userId
        });
      } catch (notifError) {
        console.error('Error creating notification:', notifError);
        // Don't fail the reply if notification fails
      }
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
    const { userId, text, mentionedUserId } = req.body;
    
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
    
    // Create notification if user was mentioned
    if (mentionedUserId && mentionedUserId.toString() !== userId.toString()) {
      try {
        const Notification = require('../models/Notification');
        const { sendPushNotification } = require('../utils/pushService');
        
        const notification = await Notification.create({
          userId: mentionedUserId,
          type: 'mention',
          challengeId: challenge._id,
          commentId: comment._id,
          replyId: newNestedReply._id,
          fromUserId: userId
        });
        
        // Send push notification
        const fromUser = await User.findById(userId, 'name');
        await sendPushNotification(mentionedUserId, {
          title: 'You were mentioned',
          body: `${fromUser?.name || 'Someone'} mentioned you in a reply on "${challenge.title}"`,
          data: {
            notificationId: notification._id.toString(),
            challengeId: challenge._id.toString(),
            type: 'mention'
          },
          tag: `challenge-${challenge._id}`
        });
      } catch (notifError) {
        console.error('Error creating notification:', notifError);
        // Don't fail the reply if notification fails
      }
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

module.exports = router;
