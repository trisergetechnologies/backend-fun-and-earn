const User = require("../../../models/User");

exports.adminEcartActivate = async (req, res) => {
    try {
        const admin = req.user; // assuming this is the admin (you might want to verify their role if needed)
        const { userId, state_address } = req.body;

        // Validate input
        if (!userId) {
            return res.status(200).json({
                success: false,
                message: 'User ID is required',
                data: null
            });
        }

        if (!state_address) {
            return res.status(200).json({
                success: false,
                message: 'State is required to activate E-Cart',
                data: null
            });
        }

        // Fetch target user by ID
        const user = await User.findById(userId);
        if (!user) {
            return res.status(200).json({
                success: false,
                message: 'User not found',
                data: null
            });
        }

        // Check if eCart is already activated
        if (user.applications.includes('eCart')) {
            return res.status(200).json({
                success: false,
                message: 'User is already activated for E-Cart',
                data: null
            });
        }

        // Activate eCart
        user.applications.push('eCart');
        user.state_address = state_address;
        await user.save();

        return res.status(200).json({
            success: true,
            message: 'E-Cart activated successfully for user',
            data: {
                userId: user._id,
                applications: user.applications
            }
        });

    } catch (err) {
        console.error('Admin E-Cart Activation Error:', err);
        return res.status(500).json({
            success: false,
            message: 'Internal Server Error',
            data: null
        });
    }
};
