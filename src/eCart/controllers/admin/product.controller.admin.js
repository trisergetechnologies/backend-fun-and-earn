const Category = require("../../models/Category");
const Product = require("../../models/Product");
const User = require("../../../models/User");
const {
  buildImagesForCreate,
  buildImagesForUpdate,
  validateImageCount,
} = require("../../../utils/productImages");
const {
  parseCouponConfig,
  couponSetFromFields,
  couponUnsetForFields,
} = require("../../helpers/couponConfig");
const {
  parsePricingInput,
  assertDiscountOk,
  computeProductPricing,
} = require("../../helpers/productPricing");

exports.addProduct = async (req, res) => {
  try {
    const user = req.user;

    const { title, description, categoryId, sellerId } = req.body;
    const stock = parseInt(req.body.stock);
    const pricingInput = parsePricingInput(req.body);
    const { basePrice, transportCharge, discountAmount, gst } = pricingInput;

    if (!title || isNaN(basePrice) || isNaN(stock) || !categoryId || !sellerId) {
      return res.status(200).json({
        success: false,
        message: 'Missing or invalid required fields',
        data: null
      });
    }

    const categoryExists = await Category.findById(categoryId);
    if (!categoryExists) {
      return res.status(200).json({
        success: false,
        message: "Selected category does not exist",
        data: null,
      });
    }

    const discountCheck = assertDiscountOk({
      basePrice,
      transportCharge,
      discountAmount,
    });
    if (!discountCheck.ok) {
      return res.status(200).json({
        success: false,
        message: discountCheck.message,
        data: null
      });
    }

    const priced = computeProductPricing({
      basePrice,
      transportCharge,
      discountAmount,
      gst: Number.isFinite(gst) ? gst : 0.05,
    });

    let variations = [];
    if (req.body.variations) {
      try {
        variations = typeof req.body.variations === 'string'
          ? JSON.parse(req.body.variations)
          : req.body.variations;
      } catch (e) {
        variations = [];
      }
    }

    const couponConfig = parseCouponConfig(req.body, { applyDefault: true });
    if (!couponConfig.ok) {
      return res.status(200).json({
        success: false,
        message: couponConfig.message,
        data: null,
      });
    }

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
      sellerId: sellerId,
      categoryId,
      title,
      description,
      basePrice: priced.basePrice,
      transportCharge: priced.transportCharge,
      discountAmount: priced.discountAmount,
      price: priced.price,
      stock,
      discountPercent: priced.discountPercent,
      finalPrice: priced.finalPrice,
      gst: priced.gst,
      variations,
      createdByRole: user.role,
      images,
      ...couponSetFromFields(couponConfig.fields),
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
    const { page = 1, limit = 25 } = req.query;

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

    // Backend-driven filters: search, categoryId, isActive
    const queryFilter = {};
    if (req.query.search && typeof req.query.search === 'string' && req.query.search.trim()) {
      const term = req.query.search.trim();
      queryFilter.$or = [
        { title: { $regex: term, $options: 'i' } },
        { description: { $regex: term, $options: 'i' } }
      ];
    }
    if (req.query.categoryId && req.query.categoryId.trim()) {
      queryFilter.categoryId = req.query.categoryId.trim();
    }
    if (req.query.sellerId && req.query.sellerId.trim()) {
      queryFilter.sellerId = req.query.sellerId.trim();
    }
    if (req.query.isActive !== undefined && req.query.isActive !== '') {
      queryFilter.isActive = req.query.isActive === 'true';
    }

    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const skipNum = (Math.max(1, parseInt(page, 10)) - 1) * limitNum;

    const [allProducts, totalProducts] = await Promise.all([
      Product.find(queryFilter)
        .skip(skipNum)
        .limit(limitNum)
        .populate('sellerId', 'name email role')
        .populate('categoryId', 'title slug')
        .sort({ createdAt: -1 })
        .lean(),
      Product.countDocuments(queryFilter)
    ]);

    const totalPages = Math.ceil(totalProducts / limitNum) || 1;

    return res.status(200).json({
      success: true,
      message: 'All products fetched successfully',
      data: {
        products: allProducts,
        totalPages,
        total: totalProducts
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

    const existing = await Product.findById(id);
    if (!existing) {
      return res.status(200).json({
        success: false,
        message: 'Product not found',
        data: null,
      });
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

    // Remove image fields from body — mergedImages is applied explicitly below
    if (req.body.images) {
      delete req.body.images;
    }
    delete req.body.existingImages;

    const couponConfig = parseCouponConfig(req.body, { applyDefault: false });
    if (!couponConfig.ok) {
      return res.status(200).json({
        success: false,
        message: couponConfig.message,
        data: null,
      });
    }
    let unsetCoupon = null;
    if (couponConfig.fields) {
      const setCoupon = couponSetFromFields(couponConfig.fields);
      Object.assign(req.body, setCoupon);
      unsetCoupon = couponUnsetForFields(couponConfig.fields);
      // Avoid writing nulls for fields we intend to $unset
      if (unsetCoupon) {
        Object.keys(unsetCoupon).forEach((key) => {
          delete req.body[key];
        });
      }
    }

    // Parse gst if provided as string
    if (req.body.gst !== undefined && req.body.gst !== '') {
      req.body.gst = parseFloat(req.body.gst);
    }

    // Parse variations if provided as JSON string
    if (req.body.variations) {
      try {
        req.body.variations = typeof req.body.variations === 'string'
          ? JSON.parse(req.body.variations)
          : req.body.variations;
      } catch (e) {
        delete req.body.variations;
      }
    }

    const pricingTouched =
      req.body.basePrice !== undefined ||
      req.body.price !== undefined ||
      req.body.transportCharge !== undefined ||
      req.body.discountAmount !== undefined ||
      req.body.discountPercent !== undefined ||
      req.body.gst !== undefined;

    let pricingFields = {};
    if (pricingTouched) {
      const pricingInput = parsePricingInput(req.body, existing);
      const discountCheck = assertDiscountOk(pricingInput);
      if (!discountCheck.ok) {
        return res.status(200).json({
          success: false,
          message: discountCheck.message,
          data: null,
        });
      }
      const priced = computeProductPricing(pricingInput);
      pricingFields = {
        basePrice: priced.basePrice,
        transportCharge: priced.transportCharge,
        discountAmount: priced.discountAmount,
        price: priced.price,
        finalPrice: priced.finalPrice,
        discountPercent: priced.discountPercent,
        gst: priced.gst,
      };
      // Prevent stale client values from overwriting derived snapshots
      delete req.body.price;
      delete req.body.finalPrice;
      delete req.body.discountPercent;
      delete req.body.basePrice;
      delete req.body.transportCharge;
      delete req.body.discountAmount;
      delete req.body.gst;
    }

    const setFields = { ...req.body, ...pricingFields, images: mergedImages };
    const updatedProduct = await Product.findByIdAndUpdate(
      id,
      unsetCoupon ? { $set: setFields, $unset: unsetCoupon } : setFields,
      { new: true, runValidators: true }
    )
      .populate('sellerId', 'name email')
      .populate('categoryId', 'title slug');

    if (!updatedProduct) {
      return res.status(200).json({
        success: false,
        message: 'Product not found',
        data: null,
      });
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