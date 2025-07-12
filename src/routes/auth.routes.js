const express = require('express');
const { login, register, sendOtp } = require('../controllers/auth.controllers');
const Product = require('../eCart/models/Product');
const Category = require('../eCart/models/Category');
const authRouter = express.Router();

authRouter.post('/register', register)
authRouter.post('/login', login);
authRouter.post('/sendotp', sendOtp);

authRouter.post('/mockdata', async (req, res) => {
     try {
    const {
      title,
      description = '',
      ownerId,
      ownerRole
    } = req.body;

    if (!title || !ownerId || !ownerRole) {
      return res.status(400).json({ message: 'Title, ownerId, and ownerRole are required' });
    }

    const slug = slugify(title);

    const existing = await Category.findOne({ slug });
    if (existing) {
      return res.status(400).json({ message: 'Category with this title already exists' });
    }

    const category = new Category({
      title,
      slug,
      description,
      ownerId,
      ownerRole
    });

    await category.save();

    return res.status(201).json({
      message: 'Category created successfully',
      category
    });
  } catch (err) {
    console.error('Error creating category:', err);
    return res.status(500).json({ message: 'Internal server error', error: err.message });
  }
});

function slugify(text) {
  return text
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, '')     // Remove invalid chars
    .replace(/\s+/g, '-')            // Replace spaces with -
    .replace(/-+/g, '-');            // Replace multiple - with single -
}

module.exports = authRouter;