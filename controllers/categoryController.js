const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { PutCommand, DynamoDBDocumentClient, UpdateCommand, DeleteCommand, GetCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const { v4: uuidv4 } = require("uuid");
const client = new DynamoDBClient();
const docClient = DynamoDBDocumentClient.from(client);
const CATEGORIES_TABLE = process.env.CATEGORIES_TABLE;

exports.CreateCategory = async (req, res) => {
  const { categoryName } = req.body;
  const ownerId = req.user.sub;
  const categoryId = uuidv4();
  const createdAt = new Date().toISOString();
  const updatedAt = createdAt;

  const params = {
    TableName: CATEGORIES_TABLE,
    Item: {
      categoryId,
      ownerId,
      categoryName,
      productCount: 0,
      createdAt,
      updatedAt,
    },
  };

  try {
    await docClient.send(new PutCommand(params));
    res.json({
      categoryId,
      ownerId,
      categoryName,
      productCount: 0,
      createdAt,
      updatedAt,
    });
  } catch (error) {
    console.error("Error creating category: ", error);
    res.status(500).json({ error: "Could not create category" });
  }
};

exports.GetCategory = async (req, res) => {
  const { categoryId } = req.params;
  const ownerId = req.user.sub;

  const params = {
    TableName: CATEGORIES_TABLE,
    Key: { categoryId },
  };

  try {
    const { Item } = await docClient.send(new GetCommand(params));
    if (Item && Item.ownerId === ownerId) {
      res.json(Item);
    } else {
      res.status(404).json({ error: 'Could not find category or access denied' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not retrieve category" });
  }
};

exports.ListCategories = async (req, res) => {
  const ownerId = req.user.sub;

  const params = {
    TableName: CATEGORIES_TABLE,
    FilterExpression: "ownerId = :ownerId",
    ExpressionAttributeValues: {
      ":ownerId": ownerId,
    },
  };

  try {
    const { Items } = await docClient.send(new ScanCommand(params));
    res.json(Items);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not retrieve categories" });
  }
};

exports.UpdateCategory = async (req, res) => {
  const { categoryId } = req.params;
  const { categoryName } = req.body;
  const ownerId = req.user.sub;
  const updatedAt = new Date().toISOString();

  const params = {
    TableName: CATEGORIES_TABLE,
    Key: { categoryId },
    UpdateExpression: "SET categoryName = :categoryName, updatedAt = :updatedAt",
    ExpressionAttributeValues: {
      ":categoryName": categoryName,
      ":updatedAt": updatedAt,
      ":ownerId": ownerId,
    },
    ConditionExpression: "ownerId = :ownerId", // Sadece kategori sahibi güncelleyebilir
    ReturnValues: "ALL_NEW",
  };

  try {
    const { Attributes } = await docClient.send(new UpdateCommand(params));
    res.json(Attributes);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not update category" });
  }
};

exports.DeleteCategory = async (req, res) => {
  const { categoryId } = req.params;
  const ownerId = req.user.sub;

  const params = {
    TableName: CATEGORIES_TABLE,
    Key: { categoryId },
    ConditionExpression: "ownerId = :ownerId", // Sadece kategori sahibi silebilir
    ExpressionAttributeValues: {
      ":ownerId": ownerId,
    },
  };

  try {
    await docClient.send(new DeleteCommand(params));
    res.json({ message: "Category deleted successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not delete category" });
  }
};
