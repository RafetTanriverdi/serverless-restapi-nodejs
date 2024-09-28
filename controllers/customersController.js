const {
  AdminEnableUserCommand,
  AdminDisableUserCommand,
  CognitoIdentityProviderClient,
  AdminDeleteUserCommand,
} = require("@aws-sdk/client-cognito-identity-provider");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  GetCommand,
  ScanCommand,
  UpdateCommand,
  DeleteCommand,
} = require("@aws-sdk/lib-dynamodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const client = new DynamoDBClient();
const docClient = DynamoDBDocumentClient.from(client);
const cognitoClient = new CognitoIdentityProviderClient();
const CUSTOMERS_TABLE = process.env.CUSTOMERS_TABLE;

const CUSTOMER_POOL_ID = process.env.CUSTOMER_POOL_ID;

exports.ListCustomers = async (req, res) => {
  const getCustomerParams = {
    TableName: CUSTOMERS_TABLE,
  };

  try {
    const { Items } = await docClient.send(new ScanCommand(getCustomerParams));

    if (!Items) {
      return res.status(404).json({ message: "No customers found" });
    }

    res.status(200).json(Items);
  } catch (error) {
    res.status(500).json({ error: error.message });
    console.error(error);
  }
};

exports.GetCustomer = async (req, res) => {
  const { customerId } = req.params;

  const getCustomerParams = {
    TableName: CUSTOMERS_TABLE,
    Key: { customerId },
  };

  try {
    const { Item } = await docClient.send(new GetCommand(getCustomerParams));

    const charges = await stripe.charges.list({
      customer: Item.customerStripeId,
    });

    if (!Item) {
      return res.status(404).json({ message: "Customer not found" });
    }
    console.log(Item, charges.data);
    res.status(200).json({ ...Item, charges: charges.data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.UpdateCustomer = async (req, res) => {
  const { customerId } = req.params;
  const { status, cognitoUsername } = req.body;

  const updateCustomerParams = {
    TableName: CUSTOMERS_TABLE,
    Key: { customerId },
    UpdateExpression: "SET #status = :status",
    ExpressionAttributeNames: { "#status": "status" },
    ExpressionAttributeValues: { ":status": status },
    ReturnValues: "ALL_NEW",
  };

  try {
    const { Attributes } = await docClient.send(
      new UpdateCommand(updateCustomerParams)
    );

    if (status === "active") {
      const enableCommand = new AdminEnableUserCommand({
        UserPoolId: CUSTOMER_POOL_ID,
        Username: cognitoUsername,
      });
      await cognitoClient.send(enableCommand);
    } else if (status === "inactive") {
      const disableCommand = new AdminDisableUserCommand({
        UserPoolId: CUSTOMER_POOL_ID,
        Username: cognitoUsername,
      });
      await cognitoClient.send(disableCommand);
    }

    res.status(200).json(Attributes);
  } catch (error) {
    res.status(500).json({ error: error.message });
    console.error(error);
  }
};

exports.DeleteCustomer = async (req, res) => {
  const { customerId } = req.params;

  const deleteCustomerParams = {
    TableName: CUSTOMERS_TABLE,
    Key: { customerId },
  };

  try {
    const { Item } = await docClient.send(new GetCommand(deleteCustomerParams));

    await docClient.send(new DeleteCommand(deleteCustomerParams));
    const deleteCommand = new AdminDeleteUserCommand({
      UserPoolId: CUSTOMER_POOL_ID,
      Username: Item.email,
    });
    await cognitoClient.send(deleteCommand);

    await stripe.customers.del(Item.customerStripeId);

    res.status(200).json({ message: "Customer deleted" });
  } catch (error) {
    res.status(500).json({ error: error.message });
    console.error(error);
  }
};
