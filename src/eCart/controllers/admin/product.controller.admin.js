const Category = require("../../models/Category");
const Product = require("../../models/Product");
const User = require("../../../models/User");

exports.addProduct = async (req, res) => {
  try {
    const user = req.user;

    // ✅ Destructure and parse input
    const { title, description, categoryId, sellerId } = req.body;
    const price = parseFloat(req.body.price);
    const stock = parseInt(req.body.stock);
    const discountPercent = req.body.discountPercent
      ? parseFloat(req.body.discountPercent)
      : 0;

    // ✅ Basic validation
    if (!title || isNaN(price) || isNaN(stock) || !categoryId || !sellerId) {
      return res.status(200).json({
        success: false,
        message: 'Missing or invalid required fields',
        data: null
      });
    }

    // ✅ Check category existence
    const categoryExists = await Category.findById(categoryId);
    if (!categoryExists) {
      return res.status(200).json({
        success: false,
        message: "Selected category does not exist",
        data: null,
      });
    }

    // ✅ Discount bounds check
    if (discountPercent < 0 || discountPercent > 100) {
      return res.status(200).json({
        success: false,
        message: 'Discount must be between 0 and 100',
        data: null
      });
    }

    // ✅ Calculate final price
    const finalPrice = +(price - (price * discountPercent) / 100).toFixed(2);

    // ✅ Create product
    const newProduct = new Product({
      sellerId: sellerId,
      categoryId,
      title,
      description,
      price,
      stock,
      discountPercent,
      finalPrice,
      createdByRole: user.role,
      images: req.file ? [req.file.url] : []
    });

    await newProduct.save();

    return res.status(200).json({
      success: true,
      message: 'Product added successfully',
      data: newProduct
    });
  } catch (err) {
    console.error('Add Product Error:', err);
    return res.status(200).json({
      success: false,
      message: 'Internal Server Error',
      data: null
    });
  }
};




exports.getProducts = async (req, res) => {
  try {
    const admin = req.user;
    const { id } = req.params;
    const { page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    // If ID is provided → return single product with full details
    if (id) {
      const product = await Product.findById(id)
        .populate('sellerId', 'name email phone role')
        .populate('categoryId', 'title slug isActive');

      if (!product) {
        return res.status(200).json({
          success: false,
          message: 'Product not found',
          data: null
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Product details fetched successfully',
        data: {
          ...product._doc,
          seller: product.sellerId,
          category: product.categoryId
        }
      });
    }

    // If no ID → return all products (active and inactive)
    const allProducts = await Product.find()
      .skip(skip)
      .limit(parseInt(limit))
      .populate('sellerId', 'name email role')
      .populate('categoryId', 'title slug');

    const totalProducts = await Product.countDocuments();
    const totalPages = Math.ceil(totalProducts / limit);

    return res.status(200).json({
      success: true,
      message: 'All products fetched successfully',
      data: {
        products: allProducts,
        totalPages
      }
    });

  } catch (err) {
    console.error('Admin Get Products Error:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      data: null,
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};




exports.updateProduct = async (req, res) => {
  try {
    const admin = req.user;
    const { id } = req.params;



    // Prevent updating images through this endpoint
    if (req.body.images) {
      delete req.body.images;
    }

    const updatedProduct = await Product.findByIdAndUpdate(
      id,
      req.body,
      { new: true, runValidators: true }
    )
      .populate('sellerId', 'name email')
      .populate('categoryId', 'title slug')
      .select('-images');

    if (!updatedProduct) {
      return res.status(200).json({
        success: false,
        message: 'Product not found',
        data: null
      });
    }

    // Recalculate finalPrice if price or discount changed
    if (req.body.price || req.body.discountPercent) {
      updatedProduct.finalPrice = updatedProduct.price * (1 - updatedProduct.discountPercent / 100);
      await updatedProduct.save();
    }

    return res.status(200).json({
      success: true,
      message: 'Product updated successfully',
      data: updatedProduct
    });

  } catch (err) {
    console.error('Admin Product Update Error:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      data: null
    });
  }
};



exports.deleteProduct = async (req, res) => {
  try {
    const admin = req.user;
    const { id } = req.params;


    // Soft delete (set isActive to false)
    const deletedProduct = await Product.findByIdAndUpdate(
      id,
      { isActive: false },
      { new: true }
    )
    .select('-images');

    if (!deletedProduct) {
      return res.status(200).json({
        success: false,
        message: 'Product not found',
        data: null
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Product deactivated successfully',
      data: deletedProduct
    });

  } catch (err) {
    console.error('Admin Product Delete Error:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      data: null,
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};