const mongoose = require('mongoose');
const Category = require('../../models/Category');
const Product = require('../../models/Product');
const { resolveCategoryIcon } = require('../../../utils/categoryIcons');

const generateSlug = (text) =>
  text
    .toString()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');

exports.addCategory = async (req, res) => {
  try {
    const admin = req.user;
    if (admin.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admins can create categories',
        data: null,
      });
    }

    const { title, description = '', icon } = req.body;
    if (!title || !title.trim()) {
      return res.status(200).json({
        success: false,
        message: 'Category title is required',
        data: null,
      });
    }

    const resolvedIcon = resolveCategoryIcon(icon);
    const slug = generateSlug(title);

    const inactiveMatch = await Category.findOne({ slug, isActive: false });
    if (inactiveMatch) {
      inactiveMatch.title = title.trim();
      inactiveMatch.description = description;
      inactiveMatch.icon = resolvedIcon;
      inactiveMatch.isActive = true;
      inactiveMatch.ownerId = admin._id;
      inactiveMatch.ownerRole = 'admin';
      await inactiveMatch.save();

      return res.status(200).json({
        success: true,
        message: 'Category reactivated successfully',
        data: inactiveMatch,
      });
    }

    const existingActive = await Category.findOne({ slug, isActive: true });
    if (existingActive) {
      return res.status(200).json({
        success: false,
        message: 'Category with similar title already exists',
        data: null,
      });
    }

    const newCategory = await Category.create({
      title: title.trim(),
      slug,
      description,
      icon: resolvedIcon,
      ownerId: admin._id,
      ownerRole: 'admin',
    });

    return res.status(200).json({
      success: true,
      message: 'Category created successfully',
      data: newCategory,
    });
  } catch (err) {
    console.error('Add Category Error:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      data: null,
      error: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }
};

exports.updateCategory = async (req, res) => {
  try {
    const admin = req.user;
    const { id } = req.params;
    const { title, description, isActive, icon } = req.body;

    if (admin.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admins can update categories',
        data: null,
      });
    }

    const category = await Category.findById(id);
    if (!category) {
      return res.status(200).json({
        success: false,
        message: 'Category not found',
        data: null,
      });
    }

    if (title) {
      const newSlug = generateSlug(title);
      const conflict = await Category.findOne({
        slug: newSlug,
        _id: { $ne: id },
        isActive: true,
      });
      if (conflict) {
        return res.status(200).json({
          success: false,
          message: 'Another active category with this title already exists',
          data: null,
        });
      }
      category.title = title.trim();
      category.slug = newSlug;
    }

    if (description !== undefined) {
      category.description = description;
    }

    if (icon !== undefined) {
      category.icon = resolveCategoryIcon(icon);
    }

    if (isActive !== undefined) {
      category.isActive = isActive === true || isActive === 'true';
    }

    await category.save();

    return res.status(200).json({
      success: true,
      message: 'Category updated successfully',
      data: category,
    });
  } catch (err) {
    console.error('Update Category Error:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      data: null,
    });
  }
};

exports.deleteCategory = async (req, res) => {
  try {
    const admin = req.user;
    const { id } = req.params;

    if (admin.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admins can delete categories',
        data: null,
      });
    }

    const productCount = await Product.countDocuments({ categoryId: id });
    if (productCount > 0) {
      return res.status(200).json({
        success: false,
        message: `Cannot delete category: ${productCount} product(s) are mapped to it`,
        data: null,
      });
    }

    const deletedCategory = await Category.findByIdAndUpdate(
      id,
      { isActive: false },
      { new: true }
    );

    if (!deletedCategory) {
      return res.status(200).json({
        success: false,
        message: 'Category not found',
        data: null,
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Category deactivated successfully',
      data: deletedCategory,
    });
  } catch (err) {
    console.error('Delete Category Error:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      data: null,
    });
  }
};

exports.getCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { slug, activeOnly, page = 1, limit = 25, search } = req.query;

    if (id) {
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(200).json({
          success: false,
          message: 'Invalid category ID',
          data: null,
        });
      }
      const category = await Category.findById(id).populate('ownerId', 'name email');
      if (!category) {
        return res.status(200).json({
          success: false,
          message: 'Category not found',
          data: null,
        });
      }

      const productCount = await Product.countDocuments({ categoryId: id });
      return res.status(200).json({
        success: true,
        message: 'Category details fetched',
        data: { ...category.toObject(), productCount },
      });
    }

    if (slug) {
      const category = await Category.findOne({ slug, isActive: true }).populate(
        'ownerId',
        'name email'
      );
      if (!category) {
        return res.status(200).json({
          success: false,
          message: 'Category not found',
          data: null,
        });
      }
      return res.status(200).json({
        success: true,
        message: 'Category details fetched',
        data: category,
      });
    }

    const filter = {};
    const usePaginated = req.query.page || req.query.manage === 'true';

    if (usePaginated) {
      if (req.query.isActive === 'true') filter.isActive = true;
      else if (req.query.isActive === 'false') filter.isActive = false;
      // else: no isActive filter — show all for admin manage page
    } else {
      filter.isActive = true;
    }

    if (search && typeof search === 'string' && search.trim()) {
      const term = search.trim();
      filter.$or = [
        { title: { $regex: term, $options: 'i' } },
        { slug: { $regex: term, $options: 'i' } },
      ];
    }

    if (!usePaginated) {
      const categories = await Category.find(filter)
        .populate('ownerId', 'name email')
        .sort({ title: 1 });

      return res.status(200).json({
        success: true,
        message: 'All active categories fetched',
        data: categories,
      });
    }

    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const skipNum = (Math.max(1, parseInt(page, 10)) - 1) * limitNum;

    const [categories, total] = await Promise.all([
      Category.find(filter)
        .populate('ownerId', 'name email')
        .sort({ title: 1 })
        .skip(skipNum)
        .limit(limitNum)
        .lean(),
      Category.countDocuments(filter),
    ]);

    const categoriesWithCount = await Promise.all(
      categories.map(async (cat) => {
        const productCount = await Product.countDocuments({ categoryId: cat._id });
        return { ...cat, productCount };
      })
    );

    return res.status(200).json({
      success: true,
      message: 'Categories fetched',
      data: {
        categories: categoriesWithCount,
        total,
        totalPages: Math.ceil(total / limitNum) || 1,
        page: Math.max(1, parseInt(page, 10)),
      },
    });
  } catch (err) {
    console.error('Get Category Error:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      data: null,
    });
  }
};
