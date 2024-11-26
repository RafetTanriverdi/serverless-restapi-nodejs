const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

exports.GetTransactionList = async (req, res) => {

  try {
    const balanceTransactions = await stripe.balanceTransactions.list({
      limit: 100,
    });
    res.status(200).json(balanceTransactions.data);
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
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.GetCustomerBalanceTransactions = async (req, res) => {
  const stripeCustomerId = req.params.customerStripeId;
  try {
    const charges = await stripe.charges.list({
      customer: stripeCustomerId,
      limit: 100,
    });

    const balanceTransactionsPromises = charges.data.map(async (charge) => {
      if (charge.balance_transaction) {
        const balanceTransaction = await stripe.balanceTransactions.retrieve(
          charge.balance_transaction
        );

        return {
          chargeId: charge.id,
          balanceTransactionId: charge.balance_transaction,
          amount: balanceTransaction.amount,
          fee: balanceTransaction.fee,
          net: balanceTransaction.net,
          currency: balanceTransaction.currency,
          description: charge.description,
        };
      }
      return null;
    });

    const balanceTransactions = await Promise.all(balanceTransactionsPromises);

    res.status(200).json(balanceTransactions.filter(Boolean));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
