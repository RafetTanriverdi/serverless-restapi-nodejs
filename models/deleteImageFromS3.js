const AWS = require("aws-sdk");
const s3 = new AWS.S3();

exports.deleteImageS3 = async (imageUrl) => {
  const params = {
    Bucket: process.env.S3_BUCKET_NAME,
    Key: imageUrl.split('/').pop(), 
  };

  try {
    await s3.deleteObject(params).promise();
  } catch (error) {
    console.error("Error deleting image from S3:", error);
    throw error;
  }
};

