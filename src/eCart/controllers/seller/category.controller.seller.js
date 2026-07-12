const Category = require('../../models/Category');

exports.getCategories = async (req, res) => {
  try {
    const categories = await Category.find({ isActive: true })
      .sort({ title: 1 })
      .select('title slug description isActive icon');

    return res.status(200).json({
      success: true,
      message: 'Categories fetched',
      data: categories,
    });
  } catch (err) {
    console.error('Seller Get Categories Error:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      data: null,
    });
  }
};
