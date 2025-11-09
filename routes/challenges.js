const express = require('express');
const router = express.Router();
const Challenge = require('../models/Challenge');

// Create challenge
router.post('/', async (req, res) => {
  try {
    const { title, description, startDate, endDate, owner } = req.body;

    if (!title || !description || !startDate || !endDate || !owner) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    const challenge = new Challenge({ title, description, startDate, endDate, owner });
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
    const { title, description, startDate, endDate, owner } = req.body;

    if (!title || !description || !startDate || !endDate) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    const update = { title, description, startDate, endDate };
    if (owner) {
      update.owner = owner;
    }

    const challenge = await Challenge.findByIdAndUpdate(id, update, {
      new: true,
      runValidators: true
    });

    if (!challenge) {
      return res.status(404).json({ message: 'Challenge not found' });
    }

    res.json({
      message: 'Challenge updated successfully',
      challenge
    });
  } catch (error) {
    res.status(500).json({ message: 'Error updating challenge', error: error.message });
  }
});

// Get all challenges
router.get('/', async (req, res) => {
  try {
    const challenges = await Challenge.find({}).sort({ createdAt: -1 }).populate('owner', 'name');
    res.json({ challenges });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching challenges', error: error.message });
  }
});

// Get challenges by user
router.get('/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ message: 'User ID is required' });
    }

    const challenges = await Challenge.find({ owner: userId }).sort({ createdAt: -1 });
    res.json({ challenges });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching challenges', error: error.message });
  }
});

module.exports = router;
