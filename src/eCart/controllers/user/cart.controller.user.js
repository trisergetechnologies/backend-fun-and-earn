const Cart = require("../../models/Cart");
const Product = require("../../models/Product");

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

    return res.status(200).json({ success: true, message: 'Cart fetched successfully', data: cart });

  } catch (err) {
    console.error('Get Cart Error:', err);
    return res.status(500).json({ success: false, message: 'Internal Server Error', data: null });
  }
};


exports.addCart = async (req, res) => {
  try {
    const user = req.user;
    const { productId, quantity } = req.body;

    // 🔒 Only 'user' role can modify cart
    if (user.role !== 'user') {
      return res.status(200).json({
        success: false,
        message: 'Only users can modify cart',
        data: null
      });
    }

    // ❌ Basic validation
    if (!productId || quantity <= 0) {
      return res.status(200).json({
        success: false,
        message: 'Invalid product or quantity',
        data: null
      });
    }

    // 🛒 Find and verify product
    const product = await Product.findOne({ _id: productId, isActive: true });
    if (!product || product.stock < quantity) {
      return res.status(200).json({
        success: false,
        message: 'Product unavailable or out of stock',
        data: null
      });
    }

    // 🛍️ Get or create cart for user
    let cart = await Cart.findOne({ userId: user._id });

    if (!cart) {
      cart = new Cart({
        userId: user._id,
        items: [{ productId, quantity }]
      });

      await cart.save();
      return res.status(200).json({
        success: true,
        message: 'Product added to cart',
        data: cart
      });
    }

    // 🧾 Restrict mixing sellers
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

    // ✅ Add or update item in cart
    const existingItem = cart.items.find(item => item.productId.toString() === productId);
    if (existingItem) {
      existingItem.quantity += quantity;
    } else {
      cart.items.push({ productId, quantity });
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
