const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

exports.GetTransactionList = async (req, res) => {
  try {
    const balanceTransactions = await stripe.balanceTransactions.list({
      limit: 100,
    });
    res.status(200).json(balanceTransactions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.GetBalanceList = async (req, res) => {
  try {
    const balance = await stripe.balance.retrieve();
    res.status(200).json(balance);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.GetRefundList = async (req, res) => {
  try {
    const refunds = await stripe.refunds.list({
      limit: 100,
    });
    res.status(200).json(refunds);
  } catch (error) {}
};
