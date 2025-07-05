const mongoose = require("mongoose");
const Product = require("../../models/Product");
const Category = require("../../models/Category");


exports.getProducts = async (req, res) => {
  try {
    const user = req.user;
    const { id, slug } = req.params;

    if (user.role !== 'user') {
      return res.status(200).json({
        success: false,
        message: 'Access denied: Only users can view products',
        data: null
      });
    }

    // If ID is provided → return single product
    if (id) {
      const product = await Product.findOne({ _id: id, isActive: true })
        .populate('categoryId', 'title slug') // Optional
        .populate('sellerId', 'name email'); // Optional

      if (!product) {
        return res.status(200).json({
          success: false,
          message: 'Product not found or inactive',
          data: null
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Product fetched successfully',
        data: product
      });
    }

        // 🔍 If category slug is provided → find matching category
    else if (slug) {
      const category = await Category.findOne({ slug });
      if (!category) {
        return res.status(200).json({
          success: false,
          message: 'Category not found',
          data: null
        });
      }

      const categoryProducts = await Product.find({
        isActive: true,
        categoryId: category._id
      })
        .populate('categoryId', 'title slug')
        .populate('sellerId', 'name email');

      return res.status(200).json({
        success: true,
        message: `Products in category '${category.title}' fetched successfully`,
        data: categoryProducts
      });
    }

    // If no ID → return all active products
    const allProducts = await Product.find({ isActive: true })
      .populate('categoryId', 'title slug')
      .populate('sellerId', 'name email');

    return res.status(200).json({
      success: true,
      message: 'All products fetched successfully',
      data: allProducts
    });

  } catch (err) {
    console.error('Get Products Error:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      data: null
    });
  }
};



exports.searchProducts = async (req, res) => {
  try {
    const user = req.user;

    if (user.role !== 'user') {
      return res.status(200).json({
        success: false,
        message: 'Access denied: Only users can search products',
        data: null
      });
    }

    const { keyword = '', categoryId } = req.query;

    // Build search filters
    const filter = {
      isActive: true
    };

    if (keyword) {
      filter.$or = [
        { title: { $regex: keyword, $options: 'i' } },
        { description: { $regex: keyword, $options: 'i' } }
      ];
    }

    if (categoryId && mongoose.Types.ObjectId.isValid(categoryId)) {
      filter.categoryId = categoryId;
    }

    const products = await Product.find(filter)
      .populate('categoryId', 'title slug')
      .populate('sellerId', 'name');

    return res.status(200).json({
      success: true,
      message: 'Search results',
      data: products
    });

  } catch (err) {
    console.error('Search Products Error:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      data: null
    });
  }
};
