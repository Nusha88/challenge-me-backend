const express = require('express');
const router = express.Router();
const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey';

// JWT middleware (for future use)
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'No token provided' });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ message: 'Invalid token' });
    req.user = user;
    next();
  });
}

// Get all users
router.get('/users', async (req, res) => {
  try {
    console.log('Attempting to fetch users...');
    if (!User) {
      console.error('User model is not defined');
      return res.status(500).json({
        message: 'Database model error',
        error: 'User model not found'
      });
    }
    const users = await User.find({}, {
      name: 1,
      age: 1,
      country: 1,
      createdAt: 1,
      _id: 1
    }).sort({ createdAt: -1 });
    console.log(`Successfully fetched ${users.length} users`);
    res.json({
      message: 'Users retrieved successfully',
      users
    });
  } catch (error) {
    console.error('Error in /users endpoint:', error);
    res.status(500).json({
      message: 'Error fetching users',
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Register a new user
router.post('/register', async (req, res) => {
  try {
    const { name, age, country, password } = req.body;
    if (!name || age === undefined || age === null || !country || !password) {
      return res.status(400).json({
        message: 'All fields are required'
      });
    }
    const ageNumber = Number(age);
    if (!Number.isInteger(ageNumber)) {
      return res.status(400).json({
        message: 'Age must be a whole number'
      });
    }
    if (ageNumber < 12 || ageNumber > 99) {
      return res.status(400).json({
        message: 'Age must be between 12 and 99'
      });
    }
    if (typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({
        message: 'Password must be at least 6 characters'
      });
    }
    // Check for duplicate name
    const existingUser = await User.findOne({ name });
    if (existingUser) {
      return res.status(409).json({ message: 'A user with this name already exists' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({
      name,
      age: ageNumber,
      country,
      avatarUrl: req.body.avatarUrl || '',
      password: hashedPassword
    });
    await user.save();
    // Generate JWT
    const token = jwt.sign({ id: user._id, name: user.name }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: {
        id: user._id,
        name: user.name,
        age: user.age,
        country: user.country,
        avatarUrl: user.avatarUrl,
        createdAt: user.createdAt
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      message: 'Error registering user',
      error: error.message
    });
  }
});

// Login endpoint
router.post('/login', async (req, res) => {
  try {
    const { name, password } = req.body;
    if (!name || !password) {
      return res.status(400).json({ message: 'Name and password are required' });
    }
    const user = await User.findOne({ name });
    if (!user || !user.password) {
      return res.status(401).json({ message: 'Invalid name or password' });
    }
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid name or password' });
    }
    // Generate JWT
    const token = jwt.sign({ id: user._id, name: user.name }, JWT_SECRET, { expiresIn: '7d' });
    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        name: user.name,
        age: user.age,
        country: user.country,
        avatarUrl: user.avatarUrl,
        createdAt: user.createdAt
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Error logging in', error: error.message });
  }
});

// Get current user's profile (protected)
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id, {
      name: 1,
      age: 1,
      country: 1,
      avatarUrl: 1,
      createdAt: 1,
      _id: 1
    });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json({ user });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching profile', error: error.message });
  }
});

// Update current user's profile (protected)
router.put('/profile', authenticateToken, async (req, res) => {
  try {
    const updates = {};
    const { name, age, country, avatarUrl } = req.body;

    if (name !== undefined) {
      if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ message: 'Name must be provided' });
      }
      updates.name = name.trim();
    }

    if (age !== undefined) {
      const ageNumber = Number(age);
      if (!Number.isInteger(ageNumber) || ageNumber < 12 || ageNumber > 99) {
        return res.status(400).json({ message: 'Age must be an integer between 12 and 99' });
      }
      updates.age = ageNumber;
    }

    if (country !== undefined) {
      if (typeof country !== 'string' || country.length !== 2) {
        return res.status(400).json({ message: 'Country must be a two-letter code' });
      }
      updates.country = country.toUpperCase();
    }

    if (avatarUrl !== undefined) {
      if (avatarUrl && typeof avatarUrl !== 'string') {
        return res.status(400).json({ message: 'Avatar URL must be a string' });
      }
      updates.avatarUrl = avatarUrl;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: 'No valid fields provided for update' });
    }

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $set: updates },
      { new: true, select: 'name age country avatarUrl createdAt _id' }
    );

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({
      message: 'Profile updated successfully',
      user
    });
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ message: 'Error updating profile', error: error.message });
  }
});

module.exports = router; 