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

const PRODUCTS_TABLE = process.env.PRODUCTS_TABLE;
const USERS_TABLE = process.env.USERS_TABLE;
const client = new DynamoDBClient();
const docClient = DynamoDBDocumentClient.from(client);

exports.ListProducts = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, PATCH, DELETE");
  const ownerId = req.user.sub;

  const params = {
    TableName: PRODUCTS_TABLE,
    FilterExpression: "contains(ownerIds, :ownerId) AND active = :active",
    ExpressionAttributeValues: {
      ":ownerId": ownerId,
      ":active": true,
    },
  };

  try {
    const { Items } = await docClient.send(new ScanCommand(params));
    res.json(Items);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not retrieve products" });
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
      res.status(404).json({ error: "Could not find product or access denied" });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not retrieve product" });
  }
};


exports.CreateProduct = async (req, res) => {
  const { name, price, description, imageBase64, imageMimeType, categoryId, stock = 0, active = true } = req.body;

  // Category check
  const categoryParams = {
    TableName: process.env.CATEGORIES_TABLE,
    Key: { categoryId },
  };

  const categoryData = await docClient.send(new GetCommand(categoryParams));

  if (!categoryData.Item) {
    return res.status(400).json({ error: "Invalid categoryId" });
  }

  // Image upload
  let imageUrl;
  try {
    imageUrl = await uploadImageToS3(Buffer.from(imageBase64, "base64"), imageMimeType);
  } catch (error) {
    return res.status(500).json({ error: "Image upload failed" });
  }

  const ownerId = req.user.sub;
  const productId = uuidv4();
  const createdAt = new Date().toISOString();
  const updatedAt = createdAt;

  let ownerIds = [ownerId];

  try {
    // Create product in Stripe
    const stripeProduct = await stripe.products.create({
      name,
      description,
      images: [imageUrl],
      type: "good" // Ensure the product type is 'good' to use SKUs
    });

    // Create price in Stripe
    const stripePrice = await stripe.prices.create({
      unit_amount: price * 100,
      currency: "usd",
      product: stripeProduct.id,
    });

    // Create SKU in Stripe for managing stock
    const stripeSKU = await stripe.skus.create({
      product: stripeProduct.id,
      price: stripePrice.id,
      inventory: {
        type: 'finite',
        quantity: stock,
      },
    });

    // Store product in DynamoDB
    const params = {
      TableName: PRODUCTS_TABLE,
      Item: {
        productId,
        ownerIds,
        name,
        price,
        description,
        imageUrl,
        stripeProductId: stripeProduct.id,
        stripePriceId: stripePrice.id,
        stripeSkuId: stripeSKU.id,
        categoryId,
        categoryName: categoryData.Item.name,
        createdAt,
        updatedAt,
        active,
        stock,
      },
    };

    await docClient.send(new PutCommand(params));

    // Update category product count
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
      name,
      price,
      description,
      imageUrl,
      stripeProductId: stripeProduct.id,
      stripePriceId: stripePrice.id,
      stripeSkuId: stripeSKU.id,
      categoryId,
      categoryName: categoryData.Item.name,
      createdAt,
      updatedAt,
      active,
      stock,
    });
  } catch (error) {
    console.error("Error creating product: ", error);
    res.status(500).json({ error: "Could not create product" });
  }
};


exports.PatchProduct = async (req, res) => {
  const { productId } = req.params;
  const { name, price, description, imageBase64, imageMimeType, stripeProductId, active, stock } = req.body;

  const ownerId = req.user.sub;
  const updatedAt = new Date().toISOString();

  let imageUrl;
  if (imageBase64 && imageMimeType) {
    try {
      const getProductParams = {
        TableName: PRODUCTS_TABLE,
        Key: { productId },
      };

      const { Item } = await docClient.send(new GetCommand(getProductParams));

      if (Item && Item.imageUrl) {
        await deleteImageS3(Item.imageUrl);
      }

      imageUrl = await uploadImageToS3(Buffer.from(imageBase64, 'base64'), imageMimeType);
    } catch (error) {
      return res.status(500).json({ error: "Image upload failed" });
    }
  }

  try {
    await stripe.products.update(stripeProductId, {
      name,
      description,
      ...(imageUrl && { images: [imageUrl] }),
      active: active !== undefined ? active : true,
    });

    const existingPrices = await stripe.prices.list({ product: stripeProductId });

    for (const existingPrice of existingPrices.data) {
      await stripe.prices.del(existingPrice.id);
    }

    const stripePrice = await stripe.prices.create({
      unit_amount: price * 100,
      currency: "usd",
      product: stripeProductId,
    });

    await stripe.skus.update(Item.stripeSkuId, {
      price: stripePrice.id,
      inventory: {
        type: 'finite',
        quantity: stock,
      },
    });

    const params = {
      TableName: PRODUCTS_TABLE,
      Key: { productId },
      UpdateExpression:
        `SET #name = :name, price = :price, description = :description, updatedAt = :updatedAt, stripePriceId = :stripePriceId, stock = :stock` +
        (imageUrl ? ", imageUrl = :imageUrl" : "") +
        (active !== undefined ? ", active = :active" : ""),
      ExpressionAttributeNames: { "#name": "name" },
      ExpressionAttributeValues: {
        ":name": name,
        ":price": price,
        ":description": description,
        ":updatedAt": updatedAt,
        ":stripePriceId": stripePrice.id,
        ":stock": stock,
        ...(imageUrl && { ":imageUrl": imageUrl }),
        ...(active !== undefined && { ":active": active }),
      },
      ConditionExpression: "contains(ownerIds, :ownerId)",
      ReturnValues: "ALL_NEW",
    };

    const { Attributes } = await docClient.send(new UpdateCommand(params));
    res.json(Attributes);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not update product" });
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
    console.log('Retrieved Item:', Item);
    
    if (Item && Item.ownerIds.includes(ownerId)) {
      // Mark product as inactive in Stripe
      try {
        await stripe.products.update(Item.stripeProductId, {
          active: false,
        });
        console.log('Product marked as inactive in Stripe:', Item.stripeProductId);
      } catch (error) {
        console.error("Error marking product as inactive in Stripe:", error);
        return res.status(500).json({ error: "Could not update product in Stripe" });
      }

      // Delete the product from DynamoDB
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
        res.status(500).json({ error: "Could not delete product from database" });
      }
    } else {
      res.status(404).json({ error: "Could not find product or access denied" });
    }
  } catch (error) {
    console.error("General error:", error);
    res.status(500).json({ error: "Could not process request" });
  }
};


