const AWS = require("aws-sdk");

const { DynamoDBClient, ScanCommand } = require("@aws-sdk/client-dynamodb");
const {
  GetCommand,
  DynamoDBDocumentClient,
  UpdateCommand,
  DeleteCommand,
} = require("@aws-sdk/lib-dynamodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const client = new DynamoDBClient();
const docClient = DynamoDBDocumentClient.from(client);
const ORDERS_TABLE = process.env.ORDERS_TABLE;

const { unmarshall } = AWS.DynamoDB.Converter;

exports.ListOrders = async (req, res) => {

  const listOrdersParams = {
    TableName: ORDERS_TABLE,
  };

  try {
    const { Items } = await docClient.send(new ScanCommand(listOrdersParams));
    const formattedItems = Items.map((item) => unmarshall(item));
    res.status(200).json(formattedItems);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.GetOrder = async (req, res) => {
  const { orderId } = req.params;

  const getOrderParams = {
    TableName: ORDERS_TABLE,
    Key: { orderId },
  };

  try {
    const { Item } = await docClient.send(new GetCommand(getOrderParams));

    if (!Item) {
      return res.status(404).json({ message: "Order not found" });
    }

    console.log("Item:", Item);
    res.status(200).json(Item);
  } catch (error) {
    console.error("Error getting order:", error); 
    res.status(500).json({ error: error.message });
  }
};

exports.UpdateOrder = async (req, res) => {
  const { orderId } = req.params;
  const { status } = req.body;

  const currentTimestamp = new Date().toISOString();

  const updateOrderParams = {
    TableName: ORDERS_TABLE,
    Key: { orderId },
    UpdateExpression:
      "set #currentStatus = :status, #statusHistory = list_append(if_not_exists(#statusHistory, :empty_list), :newStatus)",
    ExpressionAttributeNames: {
      "#currentStatus": "currentStatus",
      "#statusHistory": "statusHistory",
    },
    ExpressionAttributeValues: {
      ":status": status,
      ":newStatus": [
        {
          status: status,
          timestamp: currentTimestamp,
        },
      ],
      ":empty_list": [],
    },
    ReturnValues: "ALL_NEW",
  };

  try {
    const { Attributes } = await docClient.send(
      new UpdateCommand(updateOrderParams)
    );
    res.status(200).json(Attributes);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.DeleteOrder = async (req, res) => {
  const { orderId } = req.params;

  const deleteOrderParams = {
    TableName: ORDERS_TABLE,
    Key: { orderId },
  };

  try {
    await docClient.send(new DeleteCommand(deleteOrderParams));
    res.status(200).json({ message: "Order deleted" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};


exports.RefundOrder = async (req, res) => {
  const { orderId } = req.body;

  const status = "Item returned";
  const currentTimestamp = new Date().toISOString();

  const updateOrderParams = {
    TableName: ORDERS_TABLE,
    Key: { orderId },
    UpdateExpression:
      "set #currentStatus = :status, #statusHistory = list_append(if_not_exists(#statusHistory, :empty_list), :newStatus)",
    ExpressionAttributeNames: {
      "#currentStatus": "currentStatus",
      "#statusHistory": "statusHistory",
    },
    ExpressionAttributeValues: {
      ":status": status,
      ":newStatus": [
        {
          status: status,
          timestamp: currentTimestamp,
        },
      ],
      ":empty_list": [],
    },
    ReturnValues: "ALL_NEW",
  };

  try {
    const refund = await stripe.refunds.create({
      charge: orderId, 
    });

    if (!refund) {
      return res.status(400).json({ message: "Refund creation failed" });
    }

    const { Attributes } = await docClient.send(
      new UpdateCommand(updateOrderParams)
    );

    res.status(200).json({ message: "Order refunded", refund, Attributes });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
