exports.getMe = async (req, res) => {
  try {
    const user = req.user;

    return res.status(200).json({
      success: true,
      message: 'Seller profile fetched successfully',
      data: {
        _id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        applications: user.applications,
        isActive: user.isActive,
        sellerDetails: user.sellerDetails,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    });
  } catch (err) {
    console.error('Seller GetMe Error:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      data: null,
    });
  }
};
