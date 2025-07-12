const mongoose = require('mongoose');
const Category = require('../../models/Category');
const User = require('../../../models/User');

// Custom slug generation function
const generateSlug = (text) => {
  return text
    .toString()
    .toLowerCase()
    .replace(/\s+/g, '-')     // Replace spaces with -
    .replace(/[^\w\-]+/g, '') // Remove all non-word chars
    .replace(/\-\-+/g, '-')   // Replace multiple - with single -
    .replace(/^-+/, '')       // Trim - from start of text
    .replace(/-+$/, '');      // Trim - from end of text
};

// 1. Add Category
exports.addCategory = async (req, res) => {
  try {
    const { title, description } = req.body;
    const seller = req.user;

    // Verify seller role
    if (seller.role !== 'seller') {
      return res.status(200).json({
        success: false,
        message: 'Only sellers can create categories',
        data: null
      });
    }

    // Generate slug using custom function
    const slug = generateSlug(title);

    // Check if category with same slug exists
    const existingCategory = await Category.findOne({ slug });
    if (existingCategory) {
      return res.status(200).json({
        success: false,
        message: 'Category with similar title already exists',
        data: null
      });
    }

    // Create new category
    const newCategory = await Category.create({
      title,
      slug,
      description,
      ownerId: seller._id,
      ownerRole: 'seller'
    });

    return res.status(200).json({
      success: true,
      message: 'Category created successfully',
      data: newCategory
    });

  } catch (err) {
    console.error('Add Category Error:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      data: null,
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// 2. Update Category
exports.updateCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description } = req.body;
    const seller = req.user;

    // Verify seller role
    if (seller.role !== 'seller') {
      return res.status(200).json({
        success: false,
        message: 'Only sellers can update categories',
        data: null
      });
    }

    // Find category and verify ownership
    const category = await Category.findOne({ _id: id, ownerId: seller._id });
    if (!category) {
      return res.status(200).json({
        success: false,
        message: 'Category not found or you are not the owner',
        data: null
      });
    }

    // Update fields
    if (title) {
      category.title = title;
      category.slug = generateSlug(title);
    }
    if (description !== undefined) {
      category.description = description;
    }

    await category.save();

    return res.status(200).json({
      success: true,
      message: 'Category updated successfully',
      data: category
    });

  } catch (err) {
    console.error('Update Category Error:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      data: null
    });
  }
};

// 3. Delete Category (Soft Delete)
exports.deleteCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const seller = req.user;

    // Verify seller role
    if (seller.role !== 'seller') {
      return res.status(200).json({
        success: false,
        message: 'Only sellers can delete categories',
        data: null
      });
    }

    // Soft delete (set isActive to false)
    const deletedCategory = await Category.findOneAndUpdate(
      { _id: id, ownerId: seller._id },
      { isActive: false },
      { new: true }
    );

    if (!deletedCategory) {
      return res.status(200).json({
        success: false,
        message: 'Category not found or you are not the owner',
        data: null
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Category deactivated successfully',
      data: deletedCategory
    });

  } catch (err) {
    console.error('Delete Category Error:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      data: null
    });
  }
};

// 4. Get Category
exports.getCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { slug } = req.query;

    // Get by ID or slug
    let category;
    if (id) {
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(200).json({
          success: false,
          message: 'Invalid category ID',
          data: null
        });
      }
      category = await Category.findById(id).populate('ownerId', 'name email');
    } else if (slug) {
      category = await Category.findOne({ slug }).populate('ownerId', 'name email');
    } else {
      // Get all active categories
      const categories = await Category.find({ isActive: true })
        .populate('ownerId', 'name email')
        .sort({ title: 1 });

      return res.status(200).json({
        success: true,
        message: 'All active categories fetched',
        data: categories
      });
    }

    if (!category) {
      return res.status(200).json({
        success: false,
        message: 'Category not found',
        data: null
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Category details fetched',
      data: category
    });

  } catch (err) {
    console.error('Get Category Error:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      data: null
    });
  }
};