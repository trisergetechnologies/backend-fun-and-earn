const Category = require("../../models/Category");
const Product = require("../../models/Product");
const {
  buildImagesForCreate,
  buildImagesForUpdate,
  validateImageCount,
} = require("../../../utils/productImages");

function parseVariations(body) {
  if (!body.variations) return [];
  try {
    return typeof body.variations === 'string'
      ? JSON.parse(body.variations)
      : body.variations;
  } catch {
    return [];
  }
}

function stripSellerForbiddenFields(body) {
  const cleaned = { ...body };
  delete cleaned.isSpecial;
  delete cleaned.sellerId;
  delete cleaned.createdByRole;
  delete cleaned.images;
  delete cleaned.existingImages;
  return cleaned;
}

exports.addProduct = async (req, res) => {
  try {
    const user = req.user;

    const { title, description, categoryId } = req.body;
    const price = parseFloat(req.body.price);
    const stock = parseInt(req.body.stock, 10);
    const discountPercent = req.body.discountPercent
      ? parseFloat(req.body.discountPercent)
      : 0;
    const gst = req.body.gst !== undefined && req.body.gst !== ''
      ? parseFloat(req.body.gst)
      : 0.05;

    if (!title || isNaN(price) || isNaN(stock) || !categoryId) {
      return res.status(200).json({
        success: false,
        message: 'Missing or invalid required fields',
        data: null,
      });
    }

    const categoryExists = await Category.findOne({ _id: categoryId, isActive: true });
    if (!categoryExists) {
      return res.status(200).json({
        success: false,
        message: 'Selected category does not exist or is inactive',
        data: null,
      });
    }

    if (discountPercent < 0 || discountPercent > 100) {
      return res.status(200).json({
        success: false,
        message: 'Discount must be between 0 and 100',
        data: null,
      });
    }

    const finalPrice = +(price - (price * discountPercent) / 100).toFixed(2);
    const variations = parseVariations(req.body);
    const images = buildImagesForCreate(req);
    const imageCheck = validateImageCount(images.length);
    if (!imageCheck.valid) {
      return res.status(200).json({
        success: false,
        message: imageCheck.message,
        data: null,
      });
    }

    const newProduct = new Product({
      sellerId: user._id,
      categoryId,
      title,
      description,
      price,
      stock,
      discountPercent,
      finalPrice,
      gst,
      variations,
      createdByRole: user.role,
      images,
    });

    await newProduct.save();

    return res.status(200).json({
      success: true,
      message: 'Product added successfully',
      data: newProduct,
    });
  } catch (err) {
    console.error('Add Product Error:', err);
    return res.status(200).json({
      success: false,
      message: 'Internal Server Error',
      data: null,
    });
  }
};

exports.getProducts = async (req, res) => {
  try {
    const user = req.user;
    const { id } = req.params;
    const { page = 1, limit = 25, search } = req.query;

    if (id) {
      const product = await Product.findOne({
        _id: id,
        sellerId: user._id,
        isActive: true,
      })
        .populate('categoryId', 'title slug isActive');

      if (!product) {
        return res.status(200).json({
          success: false,
          message: 'Product not found',
          data: null,
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Product details fetched successfully',
        data: product,
      });
    }

    const queryFilter = { sellerId: user._id, isActive: true };

    if (search && typeof search === 'string' && search.trim()) {
      const term = search.trim();
      queryFilter.$or = [
        { title: { $regex: term, $options: 'i' } },
        { description: { $regex: term, $options: 'i' } },
      ];
    }

    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const skipNum = (Math.max(1, parseInt(page, 10)) - 1) * limitNum;

    const [products, total] = await Promise.all([
      Product.find(queryFilter)
        .skip(skipNum)
        .limit(limitNum)
        .populate('categoryId', 'title slug')
        .sort({ createdAt: -1 })
        .lean(),
      Product.countDocuments(queryFilter),
    ]);

    return res.status(200).json({
      success: true,
      message: 'Products fetched successfully',
      data: {
        products,
        total,
        totalPages: Math.ceil(total / limitNum) || 1,
        page: Math.max(1, parseInt(page, 10)),
      },
    });
  } catch (err) {
    console.error('Seller Get Products Error:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      data: null,
    });
  }
};

exports.updateProduct = async (req, res) => {
  try {
    const user = req.user;
    const { id } = req.params;

    const existing = await Product.findOne({ _id: id, sellerId: user._id });
    if (!existing) {
      return res.status(200).json({
        success: false,
        message: 'Product not found',
        data: null,
      });
    }

    const body = stripSellerForbiddenFields(req.body);

    if (body.gst !== undefined && body.gst !== '') {
      body.gst = parseFloat(body.gst);
    }

    if (body.variations) {
      body.variations = parseVariations({ variations: body.variations });
    }

    const mergedImages = buildImagesForUpdate(req, existing.images || []);
    const imageCheck = validateImageCount(mergedImages.length);
    if (!imageCheck.valid) {
      return res.status(200).json({
        success: false,
        message: imageCheck.message,
        data: null,
      });
    }

    const updatedProduct = await Product.findByIdAndUpdate(
      id,
      { ...body, images: mergedImages },
      { new: true, runValidators: true }
    ).populate('categoryId', 'title slug');

    if (req.body.price || req.body.discountPercent) {
      updatedProduct.finalPrice = +(
        updatedProduct.price * (1 - updatedProduct.discountPercent / 100)
      ).toFixed(2);
      await updatedProduct.save();
    }

    return res.status(200).json({
      success: true,
      message: 'Product updated successfully',
      data: updatedProduct,
    });
  } catch (err) {
    console.error('Seller Product Update Error:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      data: null,
    });
  }
};

exports.deleteProduct = async (req, res) => {
  try {
    const user = req.user;
    const { id } = req.params;

    const deletedProduct = await Product.findOneAndUpdate(
      { _id: id, sellerId: user._id },
      { isActive: false },
      { new: true }
    );

    if (!deletedProduct) {
      return res.status(200).json({
        success: false,
        message: 'Product not found',
        data: null,
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Product deactivated successfully',
      data: deletedProduct,
    });
  } catch (err) {
    console.error('Seller Product Delete Error:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      data: null,
    });
  }
};
