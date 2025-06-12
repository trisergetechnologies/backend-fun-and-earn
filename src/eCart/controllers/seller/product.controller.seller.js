const Category = require("../../models/Category");
const Product = require("../../models/Product");

exports.addProduct = async (req, res) => {
  try {
    const user = req.user;

    // ✅ Destructure and parse input
    const { title, description, categoryId } = req.body;
    const price = parseFloat(req.body.price);
    const stock = parseInt(req.body.stock);
    const discountPercent = req.body.discountPercent
      ? parseFloat(req.body.discountPercent)
      : 0;

    // ✅ Basic validation
    if (!title || isNaN(price) || isNaN(stock) || !categoryId) {
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
      sellerId: user._id,
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
