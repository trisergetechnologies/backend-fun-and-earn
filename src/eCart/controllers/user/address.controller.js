const User = require('../../../models/User');


//-------------------------------------
// Get Addresses
// This function fetches all addresses or a specific address by slug.
//-------------------------------------

exports.getAddresses = async (req, res) => {
  try {
    const user = req.user;

    const { slug } = req.query;

    const fullUser = await User.findById(user._id).select('eCartProfile.addresses');

    if (!fullUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
        data: null
      });
    }

    const addresses = fullUser.eCartProfile.addresses || [];

    if (slug) {
      const address = addresses.find(addr => addr.slugName === slug);

      if (!address) {
        return res.status(404).json({
          success: false,
          message: 'Address not found',
          data: null
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Address fetched successfully',
        data: address
      });
    }

    // If no slug, return all addresses
    return res.status(200).json({
      success: true,
      message: 'All addresses fetched',
      data: addresses
    });

  } catch (err) {
    console.error('Get Addresses Error:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      data: null
    });
  }
};


//-------------------------------------
// Add Address
// This function adds a new address to the user's profile.
//-------------------------------------



exports.addAddress = async (req, res) => {

  // 👇 Utility to generate slug from string
const slugify = (text) =>
  text.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]+/g, '');

  try {
    const user = req.user;

    if (user.role !== 'user') {
      return res.status(200).json({
        success: false,
        message: 'Access denied: Only users can add addresses',
        data: null
      });
    }

    const {
      addressName,
      fullName,
      street,
      city,
      state,
      pincode,
      phone,
      isDefault = false
    } = req.body;

    if (!addressName || !fullName || !street || !city || !state || !pincode || !phone) {
      return res.status(200).json({
        success: false,
        message: 'Missing required fields',
        data: null
      });
    }

    const slugName = slugify(addressName);

    const userDoc = await User.findById(user._id);

    // Check for duplicate slug
    const existing = userDoc.eCartProfile.addresses.find(addr => addr.slugName === slugName);
    if (existing) {
      return res.status(200).json({
        success: false,
        message: `Address with slug "${slugName}" already exists`,
        data: null
      });
    }

    // If this is to be default, unset others
    if (isDefault) {
      userDoc.eCartProfile.addresses.forEach(addr => addr.isDefault = false);
    }

    // Push new address
    userDoc.eCartProfile.addresses.push({
      addressName,
      slugName,
      fullName,
      street,
      city,
      state,
      pincode,
      phone,
      isDefault
    });

    await userDoc.save();

    return res.status(200).json({
      success: true,
      message: 'Address added successfully',
      data: {
        slugName,
        addressName,
        fullName,
        street,
        city,
        state,
        pincode,
        phone,
        isDefault
      }
    });

  } catch (err) {
    console.error('Add Address Error:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      data: null
    });
  }
};



//-------------------------------------
// Update Address
// This function updates an existing address in the user's profile.
//-------------------------------------

exports.updateAddress = async (req, res) => {
  try {
    const user = req.user;
    const { slug } = req.params;

    if (user.role !== 'user') {
      return res.status(200).json({
        success: false,
        message: 'Access denied: Only users can update addresses',
        data: null
      });
    }

    if (!slug) {
      return res.status(200).json({
        success: false,
        message: 'Missing slugName parameter',
        data: null
      });
    }

    const userDoc = await User.findById(user._id);
    const addressIndex = userDoc.eCartProfile.addresses.findIndex(addr => addr.slugName === slug);

    if (addressIndex === -1) {
      return res.status(200).json({
        success: false,
        message: 'Address not found',
        data: null
      });
    }

    const {
      addressName,
      fullName,
      street,
      city,
      state,
      pincode,
      phone,
      isDefault
    } = req.body;

    const updatedAddress = {
      ...userDoc.eCartProfile.addresses[addressIndex]._doc, // Preserve existing
      addressName: addressName || userDoc.eCartProfile.addresses[addressIndex].addressName,
      fullName: fullName || userDoc.eCartProfile.addresses[addressIndex].fullName,
      street: street || userDoc.eCartProfile.addresses[addressIndex].street,
      city: city || userDoc.eCartProfile.addresses[addressIndex].city,
      state: state || userDoc.eCartProfile.addresses[addressIndex].state,
      pincode: pincode || userDoc.eCartProfile.addresses[addressIndex].pincode,
      phone: phone || userDoc.eCartProfile.addresses[addressIndex].phone,
      isDefault: isDefault !== undefined ? isDefault : userDoc.eCartProfile.addresses[addressIndex].isDefault
    };

    // If new isDefault is true, unset others
    if (updatedAddress.isDefault) {
      userDoc.eCartProfile.addresses.forEach(addr => addr.isDefault = false);
    }

    userDoc.eCartProfile.addresses[addressIndex] = updatedAddress;
    await userDoc.save();

    return res.status(200).json({
      success: true,
      message: 'Address updated successfully',
      data: updatedAddress
    });

  } catch (err) {
    console.error('Update Address Error:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      data: null
    });
  }
};



//-------------------------------------
// Delete Address
// This function deletes an address from the user's profile.
//-------------------------------------

exports.deleteAddress = async (req, res) => {
  try {
    const user = req.user;
    const { slug } = req.params;

    if (user.role !== 'user') {
      return res.status(200).json({
        success: false,
        message: 'Access denied: Only users can delete addresses',
        data: null
      });
    }

    if (!slug) {
      return res.status(200).json({
        success: false,
        message: 'Missing slugName parameter',
        data: null
      });
    }

    const userDoc = await User.findById(user._id);

    // Check if the address exists
    const addressToDelete = userDoc.eCartProfile.addresses.find(addr => addr.slugName === slug);

    if (!addressToDelete) {
      return res.status(200).json({
        success: false,
        message: 'Address not found',
        data: null
      });
    }

    const wasDefault = addressToDelete.isDefault;

    // Filter out the address
    userDoc.eCartProfile.addresses = userDoc.eCartProfile.addresses.filter(
      addr => addr.slugName !== slug
    );

    // If the deleted one was default and others remain, make first one default
    if (wasDefault && userDoc.eCartProfile.addresses.length > 0) {
      userDoc.eCartProfile.addresses[0].isDefault = true;
    }

    await userDoc.save();

    return res.status(200).json({
      success: true,
      message: 'Address deleted successfully',
      data: null
    });

  } catch (err) {
    console.error('Delete Address Error:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      data: null
    });
  }
};
