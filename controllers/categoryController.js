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
  const familyOwnerId = req.user.familyOwnerId || req.user.sub;
  const ownerId = req.user.sub;
  const categoryId = uuidv4();
  const createdAt = new Date().toISOString();
  const updatedAt = createdAt;

  const userParams = {
    TableName: USERS_TABLE,
    Key: { userId: ownerId },
  };

  let ownerName;
  let ownerIds = [ownerId, familyOwnerId];

  try {
    const userData = await docClient.send(new GetCommand(userParams));
    if (userData.Item) {
      ownerName = userData.Item.name;
    } else {
      return res.status(404).json({ message: "User not found" });
    }
  } catch (error) {
    console.error("Error fetching user data:", error);
    return res.status(500).json({ message: "Could not fetch user data" });
  }

  const params = {
    TableName: CATEGORIES_TABLE,
    Item: {
      categoryId,
      ownerIds,
      ownerName,
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
      ownerName,
      categoryName,
      productCount: 0,
      createdAt,
      updatedAt,
    });
  } catch (error) {
    console.error("Error creating category: ", error);
    res.status(500).json({ message: "Could not create category" });
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
      res.status(404).json({ message: "Could not find category or access denied" });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Could not retrieve category" });
  }
};

exports.ListCategories = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, PATCH, DELETE");
  const ownerId = req.user.sub;

  const params = {
    TableName: CATEGORIES_TABLE,
    FilterExpression: "contains(ownerIds, :ownerId)",
    ExpressionAttributeValues: {
      ":ownerId": ownerId,
    },
  };

  try {
    const { Items } = await docClient.send(new ScanCommand(params));
    res.json(Items);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Could not retrieve categories" });
  }
};

exports.UpdateCategory = async (req, res) => {
  const { categoryId } = req.params;
  const { categoryName } = req.body;
  const ownerId = req.user.sub;
  const updatedAt = new Date().toISOString();

  const getCategoryParams = {
    TableName: CATEGORIES_TABLE,
    Key: { categoryId },
  };

  try {
    const categoryData = await docClient.send(new GetCommand(getCategoryParams));

    if (!categoryData.Item) {
      return res.status(404).json({ message: "Category not found" });
    }

    if (!categoryData.Item.ownerIds || !categoryData.Item.ownerIds.includes(ownerId)) {
      return res.status(403).json({ message: "Access denied or ownerIds missing" });
    }

    const updateCategoryParams = {
      TableName: CATEGORIES_TABLE,
      Key: { categoryId },
      UpdateExpression: "SET categoryName = :categoryName, updatedAt = :updatedAt",
      ExpressionAttributeValues: {
        ":categoryName": categoryName,
        ":updatedAt": updatedAt,
      },
      ReturnValues: "ALL_NEW",
    };

    const { Attributes } = await docClient.send(new UpdateCommand(updateCategoryParams));

    const updateProductParams = {
      TableName: PRODUCTS_TABLE,
      IndexName: 'categoryId-index',
      KeyConditionExpression: 'categoryId = :categoryId',
      ExpressionAttributeValues: {
        ':categoryId': categoryId,
      },
    };

    const { Items: products } = await docClient.send(new QueryCommand(updateProductParams));

    for (const product of products) {
      const updateProductCategoryNameParams = {
        TableName: PRODUCTS_TABLE,
        Key: { productId: product.productId },
        UpdateExpression: "SET categoryName = :categoryName",
        ExpressionAttributeValues: {
          ":categoryName": categoryName,
        },
      };

      await docClient.send(new UpdateCommand(updateProductCategoryNameParams));
    }

    res.json(Attributes);
  } catch (error) {
    console.error("Error updating category and associated products:", error);
    res.status(500).json({ message: "Could not update category or associated products" });
  }
};

exports.DeleteCategory = async (req, res) => {
  const { categoryId } = req.params;
  const ownerId = req.user.sub;

  const getCategoryParams = {
    TableName: CATEGORIES_TABLE,
    Key: { categoryId },
  };

  try {
    const { Item } = await docClient.send(new GetCommand(getCategoryParams));

    if (!Item) {
      return res.status(404).json({ message: "Category not found" });
    }

    if (!Item.ownerIds || !Item.ownerIds.includes(ownerId)) {
      return res.status(403).json({ message: "Access denied or ownerIds missing" });
    }

    if (Item.productCount > 0) {
      return res.status(400).json({ message: "Cannot delete category: There are products linked to this category. Please delete the products first." });
    }

    // Kategori silindiğinde, tüm ürünlerden ve kullanıcılardan da ownerId'yi sil
    const productParams = {
      TableName: PRODUCTS_TABLE,
      FilterExpression: "categoryId = :categoryId",
      ExpressionAttributeValues: {
        ":categoryId": categoryId,
      },
    };

    const { Items: products } = await docClient.send(new ScanCommand(productParams));

    for (const product of products) {
      const updateProductParams = {
        TableName: PRODUCTS_TABLE,
        Key: { productId: product.productId },
        UpdateExpression: "DELETE ownerIds :ownerId",
        ExpressionAttributeValues: {
          ":ownerId": docClient.createSet([ownerId]),
        },
      };
      await docClient.send(new UpdateCommand(updateProductParams));
    }

    const deleteParams = {
      TableName: CATEGORIES_TABLE,
      Key: { categoryId },
      ConditionExpression: "contains(ownerIds, :ownerId)",
      ExpressionAttributeValues: {
        ":ownerId": ownerId,
      },
    };

    await docClient.send(new DeleteCommand(deleteParams));
    res.json({ message: "Category deleted successfully" });
  } catch (error) {
    if (error.name === 'ConditionalCheckFailedException') {
      res.status(400).json({ message: "Failed to delete category: Condition check failed" });
    } else {
      console.error("Error deleting category:", error);
      res.status(500).json({ message: "Could not delete category" });
    }
  }
};
