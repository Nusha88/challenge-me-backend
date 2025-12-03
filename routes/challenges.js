const express = require('express');
const router = express.Router();
const Challenge = require('../models/Challenge');

// Create challenge
router.post('/', async (req, res) => {
  try {
    const { title, description, startDate, endDate, owner, imageUrl, privacy, challengeType, frequency, actions, completedDays } = req.body;

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
    const { title, description, startDate, endDate, owner, imageUrl, privacy, challengeType, frequency, actions, completedDays } = req.body;

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

    res.json({
      message: 'Successfully joined the challenge',
      challenge
    });
  } catch (error) {
    res.status(500).json({ message: 'Error joining challenge', error: error.message });
  }
});

// Get all challenges
router.get('/', async (req, res) => {
  try {
    const challenges = await Challenge.find({})
      .sort({ createdAt: -1 })
      .populate('owner', 'name')
      .populate('participants.userId', 'name');
    res.json({ challenges });
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

    // Update completedDays for this participant
    challenge.participants[participantIndex].completedDays = completedDays;
    await challenge.save();

    res.json({
      message: 'Completed days updated successfully',
      challenge
    });
  } catch (error) {
    res.status(500).json({ message: 'Error updating completed days', error: error.message });
  }
});

// Get challenges by user
router.get('/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ message: 'User ID is required' });
    }

    const challenges = await Challenge.find({
      $or: [
        { owner: userId }, 
        { 'participants.userId': userId }
      ]
    })
      .sort({ createdAt: -1 })
      .populate('owner', 'name')
      .populate('participants.userId', 'name');

    res.json({ challenges });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching challenges', error: error.message });
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

module.exports = router;
