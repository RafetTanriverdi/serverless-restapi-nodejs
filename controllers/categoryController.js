const { DynamoDBClient, QueryCommand } = require("@aws-sdk/client-dynamodb");
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
const PRODUCTS_TABLE = process.env.PRODUCTS_TABLE;

exports.CreateCategory = async (req, res) => {
  const { categoryName, sharedStatus } = req.body;
  const ownerId = req.user.sub;
  const categoryId = uuidv4();
  const createdAt = new Date().toISOString();
  const updatedAt = createdAt;

  const userParams = {
    TableName: USERS_TABLE,
    Key: { userId: ownerId },
  };

  let familyId;
  let ownerName;

  try {
    const userData = await docClient.send(new GetCommand(userParams));
    if (userData.Item) {
      ownerName = userData.Item.name;
      familyId = userData.Item.familyId || ownerId;
    } else {
      return res.status(404).json({ message: "User not found" });
    }
  } catch (error) {
    console.error("Error fetching user data:", error);
    return res.status(500).json({ message: "Could not fetch user data" });
  }

  const categoryItem = {
    categoryId,
    ownerId,
    ownerName,
    categoryName,
    productCount: 0,
    createdAt,
    updatedAt,
  };

  if (sharedStatus) {
    categoryItem.familyId = familyId;
  }

  const params = {
    TableName: CATEGORIES_TABLE,
    Item: categoryItem,
  };

  try {
    await docClient.send(new PutCommand(params));
    res.json(categoryItem);
  } catch (error) {
    console.error("Error creating category: ", error);
    res.status(500).json({ message: "Could not create category" });
  }
};

exports.GetCategory = async (req, res) => {
  const { categoryId } = req.params;
  const ownerId = req.user.sub;

  const userParams = {
    TableName: USERS_TABLE,
    Key: { userId: ownerId },
  };

  try {
    const { Item: currentUser } = await docClient.send(
      new GetCommand(userParams)
    );
    if (!currentUser) {
      return res.status(404).json({ message: "User not found" });
    }

    const familyId = currentUser.familyId;

    const params = {
      TableName: CATEGORIES_TABLE,
      Key: { categoryId },
    };

    const { Item } = await docClient.send(new GetCommand(params));
    if (Item && (Item.familyId === familyId || Item.ownerId === ownerId)) {
      res.json(Item);
    } else {
      res
        .status(404)
        .json({ message: "Could not find category or access denied" });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Could not retrieve category" });
  }
};

exports.ListCategories = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, OPTIONS, PUT, PATCH, DELETE"
  );

  const ownerId = req.user.sub;

  const userParams = {
    TableName: USERS_TABLE,
    Key: { userId: ownerId },
  };

  try {
    const { Item: currentUser } = await docClient.send(
      new GetCommand(userParams)
    );
    if (!currentUser) {
      return res.status(404).json({ message: "User not found" });
    }

    const familyId = currentUser.familyId;

    const params = {
      TableName: CATEGORIES_TABLE,
      FilterExpression: "familyId = :familyId OR ownerId = :ownerId",
      ExpressionAttributeValues: {
        ":familyId": familyId,
        ":ownerId": ownerId,
      },
    };

    const { Items } = await docClient.send(new ScanCommand(params));
    res.json(Items);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Could not retrieve categories" });
  }
};

exports.UpdateCategory = async (req, res) => {
  const { categoryId } = req.params;
  const { categoryName, sharedStatus } = req.body;
  const userId = req.user.sub;
  const updatedAt = new Date().toISOString();

  const userParams = {
    TableName: USERS_TABLE,
    Key: { userId },
  };

  try {
    const { Item: currentUser } = await docClient.send(
      new GetCommand(userParams)
    );
    if (!currentUser) {
      return res.status(404).json({ message: "User not found" });
    }

    const familyId = currentUser.familyId;

    const getCategoryParams = {
      TableName: CATEGORIES_TABLE,
      Key: { categoryId },
    };

    const categoryData = await docClient.send(
      new GetCommand(getCategoryParams)
    );

    if (!categoryData.Item) {
      return res.status(404).json({ message: "Category not found" });
    }

    if (
      categoryData.Item.ownerId !== userId &&
      categoryData.Item.familyId !== familyId
    ) {
      return res.status(403).json({ message: "Access denied" });
    }

    const updateExpression = [
      "SET categoryName = :categoryName",
      "updatedAt = :updatedAt",
    ];
    const expressionAttributeValues = {
      ":categoryName": categoryName,
      ":updatedAt": updatedAt,
    };

    if (sharedStatus) {
      updateExpression.push("familyId = :familyId");
      expressionAttributeValues[":familyId"] = familyId;
    }

    const updateCategoryParams = {
      TableName: CATEGORIES_TABLE,
      Key: { categoryId },
      UpdateExpression: updateExpression.join(", "),
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: "ALL_NEW",
    };

    const { Attributes } = await docClient.send(
      new UpdateCommand(updateCategoryParams)
    );

    const scanProductParams = {
      TableName: PRODUCTS_TABLE,
      FilterExpression: "categoryId = :categoryId",
      ExpressionAttributeValues: {
        ":categoryId": categoryId,
      },
    };

    const productsResult = await docClient.send(
      new ScanCommand(scanProductParams)
    );
    const products = productsResult.Items;

    if (!products || products.length === 0) {
      return res
        .status(200)
        .json({ message: "Category updated but no related products found" });
    }

    const updateProductPromises = products.map(async (product) => {
      const updateProductCategoryNameParams = {
        TableName: PRODUCTS_TABLE,
        Key: { productId: product.productId },
        UpdateExpression: "SET categoryName = :categoryName",
        ExpressionAttributeValues: {
          ":categoryName": categoryName,
        },
      };

      return docClient.send(new UpdateCommand(updateProductCategoryNameParams));
    });

    await Promise.all(updateProductPromises);

    res.json(Attributes);
  } catch (error) {
    console.error("Error updating category and associated products:", error);
    res
      .status(500)
      .json({ message: "Could not update category or associated products" });
  }
};

exports.DeleteCategory = async (req, res) => {
  const { categoryId } = req.params;
  const userId = req.user.sub;

  const getUserParams = {
    TableName: USERS_TABLE,
    Key: { userId },
  };

  try {
    const [categoryResult, userResult] = await Promise.all([
      docClient.send(
        new GetCommand({ TableName: CATEGORIES_TABLE, Key: { categoryId } })
      ),
      docClient.send(new GetCommand(getUserParams)),
    ]);

    const category = categoryResult.Item;
    const user = userResult.Item;

    if (!category || !user) {
      return res.status(404).json({ message: "Category or User not found" });
    }

    if (category.familyId !== user.familyId) {
      if (category.ownerId !== userId) {
        return res.status(403).json({ message: "Access denied" });
      }
    }

    if (category.productCount > 0) {
      return res.status(400).json({
        message:
          "Cannot delete category: There are products linked to this category. Please delete the products first.",
      });
    }
    const deleteParams = {
      TableName: CATEGORIES_TABLE,
      Key: { categoryId },
      ConditionExpression: "categoryId = :categoryId",
      ExpressionAttributeValues: {
        ":categoryId": categoryId,
      },
    };

    try {
      await docClient.send(new DeleteCommand(deleteParams));
      res.json({ message: "Category deleted successfully" });
    } catch (error) {
      console.error("Error deleting category:", error);
      res.status(500).json({ message: "Could not delete category" });
    }
  } catch (error) {
    console.error("Error fetching category or user data:", error);
    res.status(500).json({ message: "Could not process request" });
  }
};
