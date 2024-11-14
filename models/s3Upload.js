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
    console.error("Error uploading image to S3: ", error);

    if (error.code === "NetworkingError") {
      console.error("Network error occurred during S3 upload");
    } else if (error.code === "AccessDenied") {
      console.error("Access denied. Check S3 bucket permissions");
    }

    throw new Error("Image upload failed");
  }
};
