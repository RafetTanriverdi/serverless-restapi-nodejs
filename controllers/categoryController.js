const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  PutCommand,
  DynamoDBDocumentClient,
  UpdateCommand,
  DeleteCommand,
  GetCommand,
  ScanCommand,
} = require("@aws-sdk/lib-dynamodb");
const { v4: uuidv4 } = require("uuid");
const client = new DynamoDBClient();
const docClient = DynamoDBDocumentClient.from(client);
const CATEGORIES_TABLE = process.env.CATEGORIES_TABLE;
const USERS_TABLE = process.env.USERS_TABLE;

exports.CreateCategory = async (req, res) => {
  const { categoryName } = req.body;
  const ownerId = req.user.sub;
  const categoryId = uuidv4();
  const createdAt = new Date().toISOString();
  const updatedAt = createdAt;

  // Kullanıcının sahip olduğu ownerId'yi kontrol etme
  const userParams = {
    TableName: USERS_TABLE,
    Key: { userId: ownerId },
  };

  let ownerIds = [ownerId]; // Sahipler dizisi, ilk olarak mevcut kullanıcıyı içerir

  try {
    const userData = await docClient.send(new GetCommand(userParams));
    if (userData.Item && userData.Item.ownerId) {
      ownerIds.push(userData.Item.ownerId); // Kullanıcının sahibi olduğu ownerId'yi ekle
    }
  } catch (error) {
    console.error("Error checking user's ownerId:", error);
    return res.status(500).json({ error: "Could not check user's ownerId" });
  }

  const params = {
    TableName: CATEGORIES_TABLE,
    Item: {
      categoryId,
      ownerIds,
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
      ownerIds,
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
    if (Item && Item.ownerIds.includes(ownerId)) {
      res.json(Item);
    } else {
      res
        .status(404)
        .json({ error: "Could not find category or access denied" });
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
    FilterExpression: "contains(ownerIds, :ownerId)", // ownerIds array'inde mevcut kullanıcı var mı kontrol et
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
    UpdateExpression:
      "SET categoryName = :categoryName, updatedAt = :updatedAt",
    ExpressionAttributeValues: {
      ":categoryName": categoryName,
      ":updatedAt": updatedAt,
    },
    ConditionExpression: "contains(ownerIds, :ownerId)", // Sadece kategori sahipleri güncelleyebilir
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
    ConditionExpression: "contains(ownerIds, :ownerId)", // Sadece kategori sahipleri silebilir
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
