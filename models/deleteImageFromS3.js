const AWS = require("aws-sdk");
const s3 = new AWS.S3();

exports.deleteImageFromS3 = async (imageUrl) => {
  const params = {
    Bucket: process.env.S3_BUCKET_NAME, // S3 bucket adını .env dosyasından alın
    Key: imageUrl.split('/').pop(), // Dosya adını imageUrl'den çıkar
  };

  try {
    await s3.deleteObject(params).promise();
  } catch (error) {
    console.error("Error deleting image from S3:", error);
    throw error;
  }
};
