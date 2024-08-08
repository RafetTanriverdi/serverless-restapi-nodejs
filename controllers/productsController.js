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

  const params = {
    TableName: PRODUCTS_TABLE,
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
    res.status(500).json({ message: "Could not retrieve products" });
  }
};

exports.GetProduct = async (req, res) => {
  const { productId } = req.params;
  const ownerId = req.user.sub;

  const params = {
    TableName: PRODUCTS_TABLE,
    Key: { productId },
  };

  try {
    const { Item } = await docClient.send(new GetCommand(params));
    if (Item && Item.ownerIds.includes(ownerId) && Item.active) {
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
    imageBase64,
    imageMimeType,
    categoryId,
    stock = 0,
    active = true,
  } = req.body;

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

    let imageUrl;
    try {
      imageUrl = await uploadImageToS3(
        Buffer.from(imageBase64, "base64"),
        imageMimeType
      );
    } catch (error) {
      console.error("Image upload failed:", error);
      return res.status(500).json({ message: "Image upload failed" });
    }

    const ownerId = req.user.sub;
    const productId = uuidv4();
    const createdAt = new Date().toISOString();
    const updatedAt = createdAt;

    let ownerIds = [ownerId];

    const stripeProduct = await stripe.products.create({
      name: productName, 
      description,
      images: [imageUrl],
      metadata: {
        stock: stock.toString(),
      },
    });

    const stripePrice = await stripe.prices.create({
      unit_amount: price * 100,
      currency: "usd",
      product: stripeProduct.id,
    });

    const params = {
      TableName: PRODUCTS_TABLE,
      Item: {
        productId,
        ownerIds,
        ownerName,
        productName, 
        price,
        description,
        imageUrl,
        stripeProductId: stripeProduct.id,
        stripePriceId: stripePrice.id,
        categoryId,
        categoryName,
        createdAt,
        updatedAt,
        active,
        stock,
      },
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

    res.json({
      productId,
      ownerIds,
      ownerName,
      productName,
      price,
      description,
      imageUrl,
      stripeProductId: stripeProduct.id,
      stripePriceId: stripePrice.id,
      categoryId,
      categoryName,
      createdAt,
      updatedAt,
      active,
      stock,
    });
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
    imageBase64,
    imageMimeType,
    categoryId,
    active,
    stock,
  } = req.body;

  const ownerId = req.user.sub;
  const updatedAt = new Date().toISOString();

  let imageUrl;
  let stripeProductId;

  try {
    const getProductParams = {
      TableName: PRODUCTS_TABLE,
      Key: { productId },
    };

    const { Item } = await docClient.send(new GetCommand(getProductParams));

    if (!Item) {
      return res.status(404).json({ message: "Product not found" });
    }

    stripeProductId = Item.stripeProductId;
    imageUrl = Item.imageUrl;

    if (imageBase64 && imageMimeType) {
      try {
        if (imageUrl) {
          await deleteImageS3(imageUrl);
        }
        imageUrl = await uploadImageToS3(
          Buffer.from(imageBase64, "base64"),
          imageMimeType
        );
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
      ...(imageUrl && { images: [imageUrl] }),
      active: active !== undefined ? active : true,
      metadata: {
        stock: stock.toString(),
      },
    });
  } catch (error) {
    console.error("Stripe product update failed:", error);
    return res.status(500).json({ message: `Could not update product in Stripe: ${error.message}` });
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
         stripePriceId = :stripePriceId, stock = :stock` +
        (imageUrl ? ", imageUrl = :imageUrl" : "") +
        (categoryId ? ", categoryId = :categoryId, categoryName = :categoryName" : "") +
        (active !== undefined ? ", active = :active" : ""),
      ExpressionAttributeNames: { "#productName": "productName" }, 
      ExpressionAttributeValues: {
        ":productName": productName, 
        ":price": price,
        ":description": description,
        ":updatedAt": updatedAt,
        ":stripePriceId": stripePrice.id,
        ":stock": stock,
        ":ownerId": ownerId,
        ...(imageUrl && { ":imageUrl": imageUrl }),
        ...(categoryId && { ":categoryId": categoryId, ":categoryName": categoryName }),
        ...(active !== undefined && { ":active": active }),
      },
      ConditionExpression: "contains(ownerIds, :ownerId)",
      ReturnValues: "ALL_NEW",
    };

    const { Attributes } = await docClient.send(new UpdateCommand(params));
    res.json(Attributes);
  } catch (error) {
    console.error("DynamoDB update failed:", error);
    return res.status(500).json({ message: `Could not update product in DynamoDB: ${error.message}` });
  }
};

exports.DeleteProduct = async (req, res) => {
  const { productId } = req.params;
  const ownerId = req.user.sub;

  const getProductParams = {
    TableName: PRODUCTS_TABLE,
    Key: { productId },
  };

  try {
    const { Item } = await docClient.send(new GetCommand(getProductParams));
    console.log("Retrieved Item:", Item);

    if (Item && Item.ownerIds.includes(ownerId)) {
      try {
        await stripe.products.update(Item.stripeProductId, {
          active: false,
        });
        console.log(
          "Product marked as inactive in Stripe:",
          Item.stripeProductId
        );
      } catch (error) {
        console.error("Error marking product as inactive in Stripe:", error);
        return res
          .status(500)
          .json({ message: "Could not update product in Stripe" });
      }

      const updateCategoryParams = {
        TableName: process.env.CATEGORIES_TABLE,
        Key: { categoryId: Item.categoryId },
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
        console.log("Category product count decremented");
      } catch (error) {
        console.error("Error updating category product count:", error);
        return res.status(500).json({ message: "Could not update category product count" });
      }

      const deleteParams = {
        TableName: PRODUCTS_TABLE,
        Key: { productId },
        ConditionExpression: "contains(ownerIds, :ownerId)",
        ExpressionAttributeValues: {
          ":ownerId": ownerId,
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
    } else {
      res
        .status(404)
        .json({ message: "Could not find product or access denied" });
    }
  } catch (error) {
    console.error("General error:", error);
    res.status(500).json({ message: "Could not process request" });
  }
};
