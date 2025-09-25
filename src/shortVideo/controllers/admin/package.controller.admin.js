const Package = require("../../../models/Package");
const User = require("../../../models/Package");

exports.getPackagesWithUserCount = async (req, res) => {
  try {
    // Get all packages
    const packages = await Package.aggregate([
      {
        $lookup: {
          from: "users", // collection name
          localField: "_id",
          foreignField: "package",
          as: "users"
        }
      },
      {
        $addFields: {
          userCount: { $size: "$users" }
        }
      },
      {
        $project: {
          users: 0 // don't return all user data, just count
        }
      }
    ]);

    return res.status(200).json({
      success: true,
      message: "Packages with user counts fetched successfully",
      data: packages
    });
  } catch (err) {
    console.error("GetPackagesWithUserCount Error:", err);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      data: null
    });
  }
};
