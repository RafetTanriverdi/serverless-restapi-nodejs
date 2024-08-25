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
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { uploadImageToS3 } = require("../models/s3Upload");
const { deleteImageS3 } = require("../models/deleteImageFromS3");

const {
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
} = require("@aws-sdk/client-cognito-identity-provider");

const cognitoClient = new CognitoIdentityProviderClient();

const PRODUCTS_TABLE = process.env.PRODUCTS_TABLE;
const USERS_TABLE = process.env.USERS_TABLE;
const client = new DynamoDBClient();
const docClient = DynamoDBDocumentClient.from(client);

exports.ListProducts = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, OPTIONS, PUT, PATCH, DELETE"
  );

  const ownerId = req.user.sub;

  const getUserParams = {
    TableName: USERS_TABLE,
    Key: { userId: ownerId },
  };

  try {
    const { Item: currentUser } = await docClient.send(
      new GetCommand(getUserParams)
    );
    if (!currentUser) {
      return res.status(404).json({ message: "User not found" });
    }

    const familyId = currentUser.familyId;

    const params = {
      TableName: PRODUCTS_TABLE,
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
    res.status(500).json({ message: "Could not retrieve products" });
  }
};

exports.GetProduct = async (req, res) => {
  const { productId } = req.params;
  const ownerId = req.user.sub;

  const getUserParams = {
    TableName: USERS_TABLE,
    Key: { userId: ownerId },
  };

  try {
    const { Item: currentUser } = await docClient.send(
      new GetCommand(getUserParams)
    );
    if (!currentUser) {
      return res.status(404).json({ message: "User not found" });
    }

    const familyId = currentUser.familyId;

    const params = {
      TableName: PRODUCTS_TABLE,
      Key: { productId },
    };

    const { Item } = await docClient.send(new GetCommand(params));
    if (
      Item &&
      (Item.familyId === familyId || Item.ownerId === ownerId) &&
      Item.active
    ) {
      res.json(Item);
    } else {
      res
        .status(404)
        .json({ message: "Could not find product or access denied" });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Could not retrieve product" });
  }
};

exports.CreateProduct = async (req, res) => {
  const {
    productName,
    price,
    description,
    images, 
    categoryId,
    stock = 0,
    active = true,
    sharedStatus,
  } = req.body;

  const ownerId = req.user.sub;

  const getUserParams = {
    TableName: USERS_TABLE,
    Key: { userId: ownerId },
  };

  let familyId;
  try {
    const { Item } = await docClient.send(new GetCommand(getUserParams));
    if (!Item) {
      return res.status(404).json({ message: "User not found" });
    }
    familyId = Item.familyId || ownerId;
  } catch (error) {
    console.error("Error fetching user data:", error);
    return res.status(500).json({ message: "Could not fetch user data" });
  }

  const cognitoUserParams = {
    UserPoolId: process.env.USER_POOL_ID,
    Username: req.user.sub,
  };

  try {
    const cognitoUser = await cognitoClient.send(
      new AdminGetUserCommand(cognitoUserParams)
    );
    const ownerName = cognitoUser.UserAttributes.find(
      (attr) => attr.Name === "name"
    ).Value;

    const categoryParams = {
      TableName: process.env.CATEGORIES_TABLE,
      Key: { categoryId },
    };
    const categoryData = await docClient.send(new GetCommand(categoryParams));

    if (!categoryData.Item) {
      return res.status(400).json({ message: "Invalid categoryId" });
    }
    const categoryName = categoryData.Item.categoryName;

  
    const imageUrls = [];
    for (const { imageBase64, imageMimeType } of images) {
      try {
        const imageUrl = await uploadImageToS3(
          Buffer.from(imageBase64, "base64"),
          imageMimeType
        );
        imageUrls.push(imageUrl);
      } catch (error) {
        console.error("Image upload failed:", error);
        return res.status(500).json({ message: "Image upload failed" });
      }
    }

    const productId = uuidv4();
    const createdAt = new Date().toISOString();
    const updatedAt = createdAt;

    const stripeProduct = await stripe.products.create({
      name: productName,
      description,
      images: imageUrls, 
      metadata: {
        stock: stock.toString(),
      },
    });

    const stripePrice = await stripe.prices.create({
      unit_amount: price * 100,
      currency: "usd",
      product: stripeProduct.id,
    });

    const productItem = {
      productId,
      ownerId,
      ownerName,
      productName,
      price,
      description,
      imageUrls, 
      stripeProductId: stripeProduct.id,
      stripePriceId: stripePrice.id,
      categoryId,
      categoryName,
      createdAt,
      updatedAt,
      active,
      stock,
    };

    if (sharedStatus) {
      productItem.familyId = familyId;
    }

    const params = {
      TableName: PRODUCTS_TABLE,
      Item: productItem,
    };

    await docClient.send(new PutCommand(params));

    const updateCategoryParams = {
      TableName: process.env.CATEGORIES_TABLE,
      Key: { categoryId },
      UpdateExpression: "SET productCount = productCount + :inc",
      ExpressionAttributeValues: {
        ":inc": 1,
      },
    };

    await docClient.send(new UpdateCommand(updateCategoryParams));

    res.json(productItem);
  } catch (error) {
    console.error("Error creating product: ", error);
    res.status(500).json({ message: "Could not create product" });
  }
};
exports.PatchProduct = async (req, res) => {
  const { productId } = req.params;
  const {
    productName,
    price,
    description,
    images = [],
    imageUrls = [], 
    categoryId,
    active,
    stock,
    sharedStatus,
  } = req.body;

  const userId = req.user.sub;
  const updatedAt = new Date().toISOString();

  let stripeProductId;

  try {
    const getProductParams = {
      TableName: PRODUCTS_TABLE,
      Key: { productId },
    };

    const { Item: product } = await docClient.send(
      new GetCommand(getProductParams)
    );

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    const getUserParams = {
      TableName: USERS_TABLE,
      Key: { userId },
    };

    const { Item: user } = await docClient.send(new GetCommand(getUserParams));

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (product.familyId !== user.familyId && product.ownerId !== userId) {
      return res.status(403).json({ message: "Access denied" });
    }

    stripeProductId = product.stripeProductId;

  
    for (const { imageBase64, imageMimeType } of images) {
      try {
        const imageUrl = await uploadImageToS3(
          Buffer.from(imageBase64, "base64"),
          imageMimeType
        );
        imageUrls.push(imageUrl);
      } catch (error) {
        console.error("Image upload failed:", error);
        return res.status(500).json({ message: "Image upload failed" });
      }
    }

  } catch (error) {
    console.error("Error fetching product:", error);
    return res.status(500).json({ message: "Error fetching product" });
  }

  let categoryName;
  if (categoryId) {
    try {
      const categoryParams = {
        TableName: process.env.CATEGORIES_TABLE,
        Key: { categoryId },
      };
      const categoryData = await docClient.send(new GetCommand(categoryParams));

      if (!categoryData.Item) {
        return res.status(400).json({ message: "Invalid categoryId" });
      }
      categoryName = categoryData.Item.categoryName;
    } catch (error) {
      console.error("Error fetching category:", error);
      return res.status(500).json({ message: "Error fetching category" });
    }
  }

  try {
    await stripe.products.update(stripeProductId, {
      name: productName,
      description,
      ...(imageUrls.length > 0 && { images: imageUrls }),  
      active: active !== undefined ? active : true,
      metadata: {
        stock: stock.toString(),
      },
    });
  } catch (error) {
    console.error("Stripe product update failed:", error);
    return res.status(500).json({
      message: `Could not update product in Stripe: ${error.message}`,
    });
  }

  try {
    const existingPrices = await stripe.prices.list({
      product: stripeProductId,
    });

    for (const existingPrice of existingPrices.data) {
      await stripe.prices.update(existingPrice.id, { active: false });
    }

    const stripePrice = await stripe.prices.create({
      unit_amount: price * 100,
      currency: "usd",
      product: stripeProductId,
    });

    const params = {
      TableName: PRODUCTS_TABLE,
      Key: { productId },
      UpdateExpression:
        `SET #productName = :productName, price = :price, description = :description, updatedAt = :updatedAt, 
         stripePriceId = :stripePriceId, stock = :stock, imageUrls = :imageUrls` + 
        (categoryId ? ", categoryId = :categoryId, categoryName = :categoryName" : "") +
        (active !== undefined ? ", active = :active" : "") +
        (sharedStatus ? ", familyId = :familyId" : ""),
      ExpressionAttributeNames: { "#productName": "productName" },
      ExpressionAttributeValues: {
        ":productName": productName,
        ":price": price,
        ":description": description,
        ":updatedAt": updatedAt,
        ":stripePriceId": stripePrice.id,
        ":stock": stock,
        ":imageUrls": imageUrls, 
        ...(categoryId && { ":categoryId": categoryId, ":categoryName": categoryName }),
        ...(active !== undefined && { ":active": active }),
        ...(sharedStatus && { ":familyId": product.familyId }),
      },
      ReturnValues: "ALL_NEW",
    };

    const { Attributes } = await docClient.send(new UpdateCommand(params));
    res.json(Attributes);
  } catch (error) {
    console.error("DynamoDB update failed:", error);
    return res.status(500).json({
      message: `Could not update product in DynamoDB: ${error.message}`,
    });
  }
};


exports.DeleteProduct = async (req, res) => {
  const { productId } = req.params;
  const userId = req.user.sub;

  const getProductParams = {
    TableName: PRODUCTS_TABLE,
    Key: { productId },
  };

  const getUserParams = {
    TableName: USERS_TABLE,
    Key: { userId },
  };

  try {
    const [productResult, userResult] = await Promise.all([
      docClient.send(new GetCommand(getProductParams)),
      docClient.send(new GetCommand(getUserParams)),
    ]);

    const product = productResult.Item;
    const user = userResult.Item;

    if (!product || !user) {
      return res.status(404).json({ message: "Product or User not found" });
    }

    if (product.familyId !== user.familyId) {
      if (product.ownerId !== userId) {
        return res.status(403).json({ message: "Access denied" });
      }
    }

    try {
      for (const imageUrl of product.imageUrls || []) {
        await deleteImageS3(imageUrl); 
      }
    } catch (error) {
      console.error("Error deleting images from S3:", error);
      return res
        .status(500)
        .json({ message: "Could not delete images from S3" });
    }

  
    try {
      await stripe.products.update(product.stripeProductId, {
        active: false,
      });
    
    } catch (error) {
      console.error("Error marking product as inactive in Stripe:", error);
      return res
        .status(500)
        .json({ message: "Could not update product in Stripe" });
    }


    const updateCategoryParams = {
      TableName: process.env.CATEGORIES_TABLE,
      Key: { categoryId: product.categoryId },
      UpdateExpression: "SET productCount = productCount - :dec",
      ConditionExpression: "productCount > :zero",
      ExpressionAttributeValues: {
        ":dec": 1,
        ":zero": 0,
      },
      ReturnValues: "UPDATED_NEW",
    };

    try {
      await docClient.send(new UpdateCommand(updateCategoryParams));
    } catch (error) {
      console.error("Error updating category product count:", error);
      return res
        .status(500)
        .json({ message: "Could not update category product count" });
    }

  
    const deleteParams = {
      TableName: PRODUCTS_TABLE,
      Key: { productId },
      ConditionExpression: "productId = :productId",
      ExpressionAttributeValues: {
        ":productId": productId,
      },
    };

    try {
      await docClient.send(new DeleteCommand(deleteParams));
      res.json({ message: "Product deleted successfully" });
    } catch (error) {
      console.error("Error deleting product from DynamoDB:", error);
      res
        .status(500)
        .json({ message: "Could not delete product from database" });
    }
  } catch (error) {
    console.error("General error:", error);
    res.status(500).json({ message: "Could not process request" });
  }
};
