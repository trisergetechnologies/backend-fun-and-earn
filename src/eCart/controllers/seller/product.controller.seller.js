const Category = require("../../models/Category");
const Product = require("../../models/Product");
const {
  buildImagesForCreate,
  buildImagesForUpdate,
  validateImageCount,
} = require("../../../utils/productImages");
const {
  parsePricingInput,
  assertDiscountOk,
  computeProductPricing,
} = require("../../helpers/productPricing");

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
  delete cleaned.couponEligible;
  delete cleaned.couponWallet;
  delete cleaned.couponAmount;
  delete cleaned.couponAmountEcart;
  delete cleaned.couponAmountShortVideo;
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
    const stock = parseInt(req.body.stock, 10);
    const pricingInput = parsePricingInput(req.body);
    const { basePrice, transportCharge, discountAmount, gst } = pricingInput;

    if (!title || isNaN(basePrice) || isNaN(stock) || !categoryId) {
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

    const discountCheck = assertDiscountOk({
      basePrice,
      transportCharge,
      discountAmount,
    });
    if (!discountCheck.ok) {
      return res.status(200).json({
        success: false,
        message: discountCheck.message,
        data: null,
      });
    }

    const priced = computeProductPricing({
      basePrice,
      transportCharge,
      discountAmount,
      gst: Number.isFinite(gst) ? gst : 0.05,
    });

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

    const pricingTouched =
      body.basePrice !== undefined ||
      body.price !== undefined ||
      body.transportCharge !== undefined ||
      body.discountAmount !== undefined ||
      body.discountPercent !== undefined ||
      body.gst !== undefined;

    let pricingFields = {};
    if (pricingTouched) {
      const pricingInput = parsePricingInput(body, existing);
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
      delete body.price;
      delete body.finalPrice;
      delete body.discountPercent;
      delete body.basePrice;
      delete body.transportCharge;
      delete body.discountAmount;
      delete body.gst;
    }

    const updatedProduct = await Product.findByIdAndUpdate(
      id,
      { ...body, ...pricingFields, images: mergedImages },
      { new: true, runValidators: true }
    ).populate('categoryId', 'title slug');

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
