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
const { deleteImageFromS3 } = require("../models/deleteImageFromS3");
const PRODUCTS_TABLE = process.env.PRODUCTS_TABLE;
const USERS_TABLE = process.env.USERS_TABLE;
const client = new DynamoDBClient();
const docClient = DynamoDBDocumentClient.from(client);

exports.ListProducts = async (req, res) => {
  const ownerId = req.user.sub; // Mevcut kullanıcı kimliği

  const params = {
    TableName: PRODUCTS_TABLE,
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
    if (Item && Item.ownerIds.includes(ownerId)) {
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
  const { name, price, description, imageBase64, imageMimeType, categoryId } = req.body;

  // Kategori kontrolü
  const categoryParams = {
    TableName: process.env.CATEGORIES_TABLE,
    Key: { categoryId },
  };

  const categoryData = await docClient.send(new GetCommand(categoryParams));

  if (!categoryData.Item) {
    return res.status(400).json({ error: "Invalid categoryId" });
  }

  let imageUrl;
  try {
    imageUrl = await uploadImageToS3(Buffer.from(imageBase64, "base64"), imageMimeType);
  } catch (error) {
    return res.status(500).json({ error: "Image upload failed" });
  }

  const ownerId = req.user.sub; // Ürünü oluşturan kullanıcının ID'si
  const productId = uuidv4();
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

  try {
    const stripeProduct = await stripe.products.create({
      name,
      description,
      images: [imageUrl],
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
        ownerIds, // Sahipler dizisi
        name,
        price,
        description,
        imageUrl,
        stripeProductId: stripeProduct.id,
        stripePriceId: stripePrice.id,
        categoryId,
        categoryName: categoryData.Item.name,
        createdAt,
        updatedAt,
      },
    };

    await docClient.send(new PutCommand(params));

    // Kategoriye bağlı ürün sayısını artır
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
      categoryId,
      categoryName: categoryData.Item.name,
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
  const {
    name,
    price,
    description,
    imageBase64,
    imageMimeType,
    stripeProductId,
    active,
    additionalOwnerIds,
  } = req.body;

  const ownerId = req.user.sub;
  const updatedAt = new Date().toISOString();

  // Eski resmi silip, yeni resmi yükleme işlemi
  let imageUrl;
  if (imageBase64 && imageMimeType) {
    try {
      // Eski ürünü alalım
      const getProductParams = {
        TableName: PRODUCTS_TABLE,
        Key: { productId },
      };

      const { Item } = await docClient.send(new GetCommand(getProductParams));

      // Eğer eski bir resim varsa, bunu S3'ten silelim
      if (Item && Item.imageUrl) {
        await deleteImageFromS3(Item.imageUrl);
      }

      // Yeni resmi S3'e yükleyelim
      imageUrl = await uploadImageToS3(Buffer.from(imageBase64, 'base64'), imageMimeType);
    } catch (error) {
      return res.status(500).json({ error: "Image upload failed" });
    }
  }

  // Stripe ürününü güncelle
  try {
    await stripe.products.update(stripeProductId, {
      name,
      description,
      ...(imageUrl && { images: [imageUrl] }),
      active: active !== undefined ? active : true,
    });

    const stripePrice = await stripe.prices.create({
      unit_amount: price * 100,
      currency: "usd",
      product: stripeProductId,
    });

    const params = {
      TableName: PRODUCTS_TABLE,
      Key: { productId },
      UpdateExpression:
        `SET #name = :name, price = :price, description = :description, updatedAt = :updatedAt, stripePriceId = :stripePriceId, ownerIds = list_append(ownerIds, :additionalOwnerIds)` +
        (imageUrl ? ", imageUrl = :imageUrl" : ""),
      ExpressionAttributeNames: { "#name": "name" },
      ExpressionAttributeValues: {
        ":name": name,
        ":price": price,
        ":description": description,
        ":updatedAt": updatedAt,
        ":stripePriceId": stripePrice.id,
        ":additionalOwnerIds": additionalOwnerIds || [],
        ...(imageUrl && { ":imageUrl": imageUrl }),
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

// S3'teki resmi silmek için bir yardımcı fonksiyon ekleyelim
async function deleteImageFromS3(imageUrl) {
  const s3Params = {
    Bucket: process.env.S3_BUCKET_NAME,
    Key: imageUrl.split('.amazonaws.com/')[1] // URL'den dosya yolunu çıkartır
  };

  try {
    await s3.deleteObject(s3Params).promise();
  } catch (error) {
    console.error("Error deleting image from S3: ", error);
  }
}


exports.DeleteProduct = async (req, res) => {
  const { productId } = req.params;
  const ownerId = req.user.sub;

  const getProductParams = {
    TableName: PRODUCTS_TABLE,
    Key: { productId },
  };

  try {
    // İlk olarak ürünü alalım
    const { Item } = await docClient.send(new GetCommand(getProductParams));
    if (Item && Item.ownerIds.includes(ownerId)) {
      // Stripe'dan ürünü sil
      await stripe.products.del(Item.stripeProductId);

      // S3'den görüntüyü sil
      if (Item.imageUrl) {
        try {
          await deleteImageFromS3(Item.imageUrl);
        } catch (error) {
          console.error("Error deleting image from S3:", error);
          return res.status(500).json({ error: "Could not delete image from S3" });
        }
      }

      const params = {
        TableName: PRODUCTS_TABLE,
        Key: { productId },
        ConditionExpression: "contains(ownerIds, :ownerId)", // Sadece ürün sahibi silebilir
        ExpressionAttributeValues: {
          ":ownerId": ownerId,
        },
      };

      await docClient.send(new DeleteCommand(params));
      res.json({ message: "Product deleted successfully" });
    } else {
      res.status(404).json({ error: "Could not find product or access denied" });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not delete product" });
  }
};

