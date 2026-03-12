const Cart = require("../../models/Cart");
const Product = require("../../models/Product");
const Settings = require("../../../models/Settings");

exports.getCart = async (req, res) => {
  try {
    const user = req.user;

    if (user.role !== 'user') {
      return res.status(200).json({ success: false, message: 'Only users can access cart', data: null });
    }

    let cart = await Cart.findOne({ userId: user._id }).populate('items.productId');

    if (!cart) {
      return res.status(200).json({ success: true, message: 'Cart is empty', data: { items: [], useWallet: false } });
    }

    // 🔹 Calculate GST dynamically
    let totalGstAmount = 0;

    cart.items.forEach(item => {
      if (item.productId) {
        const basePrice = item.productId.finalPrice || 0;
        const gstRate = item.productId.gst || 0;
        const quantity = item.quantity || 1;

        const gstForItem = basePrice * gstRate * quantity;
        totalGstAmount += gstForItem;
      }
    });

    const settings = await Settings.findOne();
    if (settings?.deliveryMode === 'always_charge') {
      cart.deliveryCharge = settings.deliveryChargeAmount || 0;
    } else if (settings?.deliveryMode === 'free_above_amount') {
      const subtotal = cart.items.reduce((sum, item) => {
        return sum + ((item.productId?.finalPrice || 0) * (item.quantity || 1));
      }, 0);
      cart.deliveryCharge = subtotal >= (settings.freeDeliveryAbove || 0)
        ? 0
        : (settings.deliveryChargeAmount || 0);
    } else {
      cart.deliveryCharge = 0;
    }

    // 🔹 Round to 2 decimals
    totalGstAmount = Number(totalGstAmount.toFixed(2));

    // 🔹 Save only if change is significant
    if (Math.abs(cart.totalGstAmount - totalGstAmount) > 0.01) {
      cart.totalGstAmount = totalGstAmount;
      await cart.save();
    }

    return res.status(200).json({
      success: true,
      message: 'Cart fetched successfully',
      data: cart
    });

  } catch (err) {
    console.error('Get Cart Error:', err);
    return res.status(500).json({ success: false, message: 'Internal Server Error', data: null });
  }
};


exports.addCart = async (req, res) => {
  try {
    const user = req.user;
    const { productId, quantity, selectedVariation } = req.body;

    if (user.role !== 'user') {
      return res.status(200).json({
        success: false,
        message: 'Only users can modify cart',
        data: null
      });
    }

    if (!productId || quantity <= 0) {
      return res.status(200).json({
        success: false,
        message: 'Invalid product or quantity',
        data: null
      });
    }

    const product = await Product.findOne({ _id: productId, isActive: true });
    if (!product || product.stock < quantity) {
      return res.status(200).json({
        success: false,
        message: 'Product unavailable or out of stock',
        data: null
      });
    }

    // Validate that all required variations are selected
    if (product.variations && product.variations.length > 0) {
      const selected = selectedVariation || [];
      for (const v of product.variations) {
        const match = selected.find(s => s.name === v.name);
        if (!match || !v.options.includes(match.value)) {
          return res.status(200).json({
            success: false,
            message: `Please select a valid option for ${v.name}`,
            data: null
          });
        }
      }
    }

    let cart = await Cart.findOne({ userId: user._id });

    const variationArr = selectedVariation || [];

    if (!cart) {
      cart = new Cart({
        userId: user._id,
        items: [{ productId, quantity, selectedVariation: variationArr }]
      });

      await cart.save();
      return res.status(200).json({
        success: true,
        message: 'Product added to cart',
        data: cart
      });
    }

    // Restrict mixing sellers
    if (cart.items.length > 0) {
      const firstCartItem = cart.items[0];
      const existingProduct = await Product.findById(firstCartItem.productId);

      if (!existingProduct) {
        return res.status(200).json({
          success: false,
          message: 'Existing product in cart not found',
          data: null
        });
      }

      const existingSellerId = existingProduct.sellerId.toString();
      const newProductSellerId = product.sellerId.toString();

      if (existingSellerId !== newProductSellerId) {
        return res.status(200).json({
          success: false,
          message: 'You can only add products from the same seller in one cart',
          data: null
        });
      }
    }

    // Match by productId AND selectedVariation (different variation = different line)
    const existingItem = cart.items.find(item => {
      if (item.productId.toString() !== productId) return false;
      const existingVar = (item.selectedVariation || []).map(v => `${v.name}:${v.value}`).sort().join(',');
      const newVar = variationArr.map(v => `${v.name}:${v.value}`).sort().join(',');
      return existingVar === newVar;
    });

    if (existingItem) {
      existingItem.quantity += quantity;
    } else {
      cart.items.push({ productId, quantity, selectedVariation: variationArr });
    }

    await cart.save();

    return res.status(200).json({
      success: true,
      message: 'Product added to cart',
      data: cart
    });

  } catch (err) {
    console.error('Add to Cart Error:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      data: null
    });
  }
};


exports.updateCart = async (req, res) => {
  try {
    const user = req.user;
    const { productId, quantity } = req.body;

    if (user.role !== 'user') {
      return res.status(200).json({ success: false, message: 'Only users can update cart', data: null });
    }

    if (!productId || quantity < 1) {
      return res.status(200).json({ success: false, message: 'Invalid product or quantity', data: null });
    }

    const cart = await Cart.findOne({ userId: user._id });

    if (!cart) {
      return res.status(200).json({ success: false, message: 'Cart not found', data: null });
    }

    const item = cart.items.find(i => i.productId.toString() === productId);

    if (!item) {
      return res.status(200).json({ success: false, message: 'Item not found in cart', data: null });
    }

    item.quantity = quantity;
    await cart.save();

    return res.status(200).json({ success: true, message: 'Cart updated', data: cart });

  } catch (err) {
    console.error('Update Cart Error:', err);
    return res.status(500).json({ success: false, message: 'Internal Server Error', data: null });
  }
};


exports.removeItem = async (req, res) => {
  try {
    const user = req.user;
    const { productId } = req.params;

    if (user.role !== 'user') {
      return res.status(200).json({ success: false, message: 'Only users can remove items', data: null });
    }

    const cart = await Cart.findOne({ userId: user._id });

    if (!cart) {
      return res.status(200).json({ success: false, message: 'Cart not found', data: null });
    }

    const originalLength = cart.items.length;
    cart.items = cart.items.filter(item => item.productId.toString() !== productId);

    if (cart.items.length === originalLength) {
      return res.status(200).json({ success: false, message: 'Item not found in cart', data: null });
    }

    await cart.save();

    return res.status(200).json({ success: true, message: 'Item removed from cart', data: cart });

  } catch (err) {
    console.error('Remove Item Error:', err);
    return res.status(500).json({ success: false, message: 'Internal Server Error', data: null });
  }
};


exports.clearCart = async (req, res) => {
  try {
    const user = req.user;

    if (user.role !== 'user') {
      return res.status(200).json({ success: false, message: 'Only users can clear cart', data: null });
    }

    const cart = await Cart.findOne({ userId: user._id });

    if (!cart) {
      return res.status(200).json({ success: false, message: 'Cart not found', data: null });
    }

    cart.items = [];
    await cart.save();

    return res.status(200).json({ success: true, message: 'Cart cleared', data: cart });

  } catch (err) {
    console.error('Clear Cart Error:', err);
    return res.status(500).json({ success: false, message: 'Internal Server Error', data: null });
  }
};


exports.useWallet = async (req, res) => {
  try {
    const user = req.user;
    const { useWallet } = req.body;

    if (user.role !== 'user') {
      return res.status(200).json({ success: false, message: 'Only users can use wallet toggle', data: null });
    }

    const cart = await Cart.findOne({ userId: user._id });

    if (!cart) {
      return res.status(200).json({ success: false, message: 'Cart not found', data: null });
    }

    cart.useWallet = !!useWallet;
    await cart.save();

    return res.status(200).json({ success: true, message: 'Wallet usage updated in cart', data: { useWallet: cart.useWallet } });

  } catch (err) {
    console.error('Use Wallet Error:', err);
    return res.status(500).json({ success: false, message: 'Internal Server Error', data: null });
  }
};
