const AWS = require("aws-sdk");
const s3 = new AWS.S3();
const { v4: uuidv4 } = require("uuid");

exports.uploadImageToS3 = async (imageData, mimeType) => {
  const imageId = uuidv4();
  const params = {
    Bucket: process.env.S3_BUCKET_NAME,
    Key: `products/${imageId}`,
    Body: imageData,
    ContentType: mimeType,
  };

  try {
    const { Location } = await s3.upload(params).promise();
    return Location;
  } catch (error) {

    if (error.code === "NetworkingError") {
     
      res.status(500).json({ error: error.message });
    } else if (error.code === "AccessDenied") {
      res.status(403).json({ error: error.message });                
    }

    throw new Error("Image upload failed");
  }
};
