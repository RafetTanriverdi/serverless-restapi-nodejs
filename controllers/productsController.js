const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { PutCommand, DynamoDBDocumentClient, UpdateCommand, DeleteCommand, GetCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const { v4: uuidv4 } = require("uuid");
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { uploadImageToS3 } = require('../models/s3Upload');
const PRODUCTS_TABLE = process.env.PRODUCTS_TABLE;
const client = new DynamoDBClient();
const docClient = DynamoDBDocumentClient.from(client);

exports.ListProducts = async (req, res) => {
  const params = {
    TableName: PRODUCTS_TABLE,
  };

  try {
    const { Items } = await docClient.send(new ScanCommand(params));
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, PATCH, DELETE");
    res.json(Items);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not retrieve products" });
  }
};

exports.GetProduct = async (req, res) => {
  const { productId } = req.params;

  const params = {
    TableName: PRODUCTS_TABLE,
    Key: { productId },
  };

  try {
    const { Item } = await docClient.send(new GetCommand(params));
    if (Item) {
      res.json(Item);
    } else {
      res.status(404).json({ error: 'Could not find product with provided "productId"' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not retrieve product" });
  }
};


exports.CreateProduct = async (req, res) => {
  const { name, price, description, imageBase64, imageMimeType } = req.body;
  if (typeof name !== "string") {
    return res.status(400).json({ error: '"name" must be a string' });
  } else if (typeof price !== "number") {
    return res.status(400).json({ error: '"price" must be a number' });
  } else if (typeof description !== "string") {
    return res.status(400).json({ error: '"description" must be a string' });
  }

  let imageUrl;
  try {
    imageUrl = await uploadImageToS3(Buffer.from(imageBase64, 'base64'), imageMimeType);
  } catch (error) {
    return res.status(500).json({ error: "Image upload failed" });
  }

  const ownerId = req.user.sub;
  const productId = uuidv4();
  const createdAt = new Date().toISOString();
  const updatedAt = createdAt;

  try {
    const stripeProduct = await stripe.products.create({
      name,
      description,
      images: [imageUrl], // Resim URL'sini burada Stripe ürününe ekliyoruz
    });

    const stripePrice = await stripe.prices.create({
      unit_amount: price * 100,
      currency: 'usd',
      product: stripeProduct.id,
    });

    const params = {
      TableName: PRODUCTS_TABLE,
      Item: {
        productId,
        ownerId,
        name,
        price,
        description,
        imageUrl,
        stripeProductId: stripeProduct.id,
        stripePriceId: stripePrice.id,
        createdAt,
        updatedAt,
      },
    };

    await docClient.send(new PutCommand(params));
    res.json({
      productId,
      ownerId,
      name,
      price,
      description,
      imageUrl,
      stripeProductId: stripeProduct.id,
      stripePriceId: stripePrice.id,
      createdAt,
      updatedAt,
    });
  } catch (error) {
    console.error("Error creating product: ", error);
    res.status(500).json({ error: "Could not create product" });
  }
};

exports.PatchProduct = async (req, res) => {
  const { productId } = req.params;
  const { name, price, description, imageBase64, imageMimeType } = req.body;

  const ownerId = req.user.sub;
  const updatedAt = new Date().toISOString();

  let imageUrl;
  if (imageBase64 && imageMimeType) {
    try {
      imageUrl = await uploadImageToS3(Buffer.from(imageBase64, 'base64'), imageMimeType);
    } catch (error) {
      return res.status(500).json({ error: "Image upload failed" });
    }
  }

  const params = {
    TableName: PRODUCTS_TABLE,
    Key: { productId },
    UpdateExpression: "SET #name = :name, price = :price, description = :description, updatedAt = :updatedAt" + (imageUrl ? ", imageUrl = :imageUrl" : ""),
    ExpressionAttributeNames: { "#name": "name" },
    ExpressionAttributeValues: {
      ":name": name,
      ":price": price,
      ":description": description,
      ":updatedAt": updatedAt,
      ...(imageUrl && { ":imageUrl": imageUrl }),
      ":ownerId": ownerId,
    },
    ConditionExpression: "ownerId = :ownerId",
    ReturnValues: "ALL_NEW",
  };

  try {
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

  const params = {
    TableName: PRODUCTS_TABLE,
    Key: { productId },
    ConditionExpression: "ownerId = :ownerId",
    ExpressionAttributeValues: {
      ":ownerId": ownerId,
    },
  };

  try {
    await docClient.send(new DeleteCommand(params));
    res.json({ message: "Product deleted successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not delete product" });
  }
};
