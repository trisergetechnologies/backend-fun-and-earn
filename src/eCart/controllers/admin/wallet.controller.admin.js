const WalletTransaction = require("../../../models/WalletTransaction");
const WithdrawalRequest = require("../../models/WithdrawalRequest");
const User = require("../../../models/User");



function round2(value) {
  if (isNaN(value) || value === null) return 0;
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}


exports.handleWithdrawalRequest = async (req, res) => {
  try {
    const admin = req.user;
    if (!admin || admin.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Unauthorized"
      });
    }

    const { requestId, action, remarks } = req.body; // action = 'approve' | 'reject'

    if (!["approve", "reject"].includes(action)) {
      return res.status(200).json({
        success: false,
        message: "Invalid action type",
        data: null
      });
    }

    const withdrawalReq = await WithdrawalRequest.findById(requestId).populate("user");
    if (!withdrawalReq) {
      return res.status(200).json({
        success: false,
        message: "Withdrawal request not found",
        data: null
      });
    }

    if (withdrawalReq.status !== "pending") {
      return res.status(200).json({
        success: false,
        message: `This request is already ${withdrawalReq.status}`,
        data: null
      });
    }

    const user = withdrawalReq.user;

    // Approve flow
    if (action === "approve") {
      const walletBalance = user.wallets.eCartWallet;

      if (walletBalance < withdrawalReq.amount) {
        return res.status(200).json({
          success: false,
          message: "User does not have sufficient balance to approve withdrawal",
          data: { walletBalance }
        });
      }

      // Deduct amount from user's eCartWallet
      user.wallets.eCartWallet = round2(walletBalance - withdrawalReq.amount);
      await user.save();

      // Update WalletTransaction
      await WalletTransaction.findByIdAndUpdate(withdrawalReq.walletTransactionId, {
        status: "success",
        notes: `Manual payout of ₹${withdrawalReq.payoutAmount} after ₹${withdrawalReq.tdsAmount} TDS deduction.`,
      });

      // Update WithdrawalRequest
      withdrawalReq.status = "approved";
      withdrawalReq.adminRemarks = remarks || "Approved by admin";
      withdrawalReq.processedAt = new Date();
      await withdrawalReq.save();

      return res.status(200).json({
        success: true,
        message: "Withdrawal approved successfully",
        data: { withdrawalReq }
      });
    }

    // Reject flow
    if (action === "reject") {
      withdrawalReq.status = "rejected";
      withdrawalReq.adminRemarks = remarks || "Rejected by admin";
      withdrawalReq.processedAt = new Date();
      await withdrawalReq.save();

      await WalletTransaction.findByIdAndUpdate(withdrawalReq.walletTransactionId, {
        status: "failed",
        notes: `Withdrawal rejected by admin. ${remarks || ""}`
      });

      return res.status(200).json({
        success: true,
        message: "Withdrawal rejected successfully",
        data: { withdrawalReq }
      });
    }

  } catch (err) {
    console.error("Error in handleWithdrawalRequest:", err);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: err.message
    });
  }
};



exports.getWithdrawalRequests = async (req, res) => {
  try {
    const admin = req.user;
    if (!admin || admin.role !== "admin") {
      return res.status(200).json({
        success: false,
        message: "Unauthorized access",
        data: null,
      });
    }

    const { status } = req.query; // optional filter
    const validStatuses = ["pending", "approved", "rejected"];

    // Validate status if provided
    const filter = {};
    if (status) {
      if (!validStatuses.includes(status)) {
        return res.status(200).json({
          success: false,
          message: "Invalid status filter",
          data: null,
        });
      }
      filter.status = status;
    }

    // Fetch withdrawal requests (latest first)
    const requests = await WithdrawalRequest.find(filter)
      .populate({
        path: "user",
        select: "name email phone wallets.eCartWallet wallets.shortVideoWallet eCartProfile.bankDetails",
      })
      .sort({ createdAt: -1 })
      .lean();

    if (!requests || requests.length === 0) {
      return res.status(200).json({
        success: true,
        message: "No withdrawal requests found",
        data: [],
      });
    }

    // Format response for admin readability
    const formatted = requests.map((reqDoc) => ({
      requestId: reqDoc._id,
      user: {
        id: reqDoc.user?._id,
        name: reqDoc.user?.name || "Unknown",
        email: reqDoc.user?.email || "N/A",
        phone: reqDoc.user?.phone || "N/A",
      },
      walletBalances: {
        eCartWallet: reqDoc.user?.wallets?.eCartWallet || 0,
        shortVideoWallet: reqDoc.user?.wallets?.shortVideoWallet || 0,
      },
      bankDetails: reqDoc.user?.eCartProfile?.bankDetails || {},
      amountRequested: reqDoc.amount,
      tdsAmount: reqDoc.tdsAmount,
      payoutAmount: reqDoc.payoutAmount,
      status: reqDoc.status,
      adminRemarks: reqDoc.adminRemarks || "",
      createdAt: reqDoc.createdAt,
      processedAt: reqDoc.processedAt || null,
    }));

    return res.status(200).json({
      success: true,
      message: "Withdrawal requests fetched successfully",
      data: formatted,
    });
  } catch (err) {
    console.error("❌ Error in getWithdrawalRequests:", err);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: err.message,
    });
  }
};