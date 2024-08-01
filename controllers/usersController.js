const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { PutCommand, DynamoDBDocumentClient, UpdateCommand, DeleteCommand, GetCommand, ScanCommand, QueryCommand } = require("@aws-sdk/lib-dynamodb");
const { CognitoIdentityProviderClient, AdminCreateUserCommand } = require("@aws-sdk/client-cognito-identity-provider");
const { v4: uuidv4 } = require("uuid");

const USERS_TABLE = process.env.USERS_TABLE;
const USER_POOL_ID = process.env.USER_POOL_ID;

const dynamoClient = new DynamoDBClient();
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const cognitoClient = new CognitoIdentityProviderClient();

exports.ListUsers = async (req, res) => {
  const params = {
    TableName: USERS_TABLE,
    FilterExpression: "ownerId = :ownerId",
    ExpressionAttributeValues: {
      ":ownerId": req.user.sub,
    },
  };

  try {
    const { Items } = await docClient.send(new ScanCommand(params));
    res.json(Items);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not retrieve users" });
  }
};

exports.GetUser = async (req, res) => {
  if (req.params.userId !== req.user.sub) {
    return res.status(403).json({ error: "Access denied" });
  }

  const params = {
    TableName: USERS_TABLE,
    Key: { userId: req.params.userId },
  };

  try {
    const { Item } = await docClient.send(new GetCommand(params));
    if (Item) {
      res.json(Item);
    } else {
      res.status(404).json({ error: 'Could not find user with provided "userId"' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not retrieve user" });
  }
};

exports.CreateUser = async (req, res) => {
  const { name, role, skills, email, temporaryPassword } = req.body;
  if (typeof name !== "string") {
    return res.status(400).json({ error: '"name" must be a string' });
  } else if (typeof role !== "string") {
    return res.status(400).json({ error: '"role" must be a string' });
  } else if (!Array.isArray(skills)) {
    return res.status(400).json({ error: '"skills" must be an array' });
  } else if (typeof email !== "string") {
    return res.status(400).json({ error: '"email" must be a string' });
  }

  // Email'in benzersiz olduğunu kontrol et
  const queryParams = {
    TableName: USERS_TABLE,
    IndexName: "EmailIndex",
    KeyConditionExpression: "email = :email",
    ExpressionAttributeValues: {
      ":email": email
    }
  };

  try {
    const { Items } = await docClient.send(new QueryCommand(queryParams));
    if (Items.length > 0) {
      return res.status(400).json({ error: "A user with this email already exists" });
    }
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Could not check email uniqueness" });
  }

  // Cognito'da kullanıcı oluştur
  const username = uuidv4(); // Email yerine UUID kullan
  const cognitoParams = {
    UserPoolId: USER_POOL_ID,
    Username: username,
    TemporaryPassword: temporaryPassword,
    UserAttributes: [
      {
        Name: "email",
        Value: email
      },
      {
        Name: "name",
        Value: name
      },
    ],
  };

  try {
    await cognitoClient.send(new AdminCreateUserCommand(cognitoParams));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Could not create user in Cognito" });
  }

  // DynamoDB'de kullanıcı oluştur
  const ownerId = req.user.sub;
  const userId = uuidv4();
  const createdAt = new Date().toISOString();
  const updatedAt = createdAt;

  const dynamoParams = {
    TableName: USERS_TABLE,
    Item: { userId, ownerId, name, role, skills, email, createdAt, updatedAt },
  };

  try {
    await docClient.send(new PutCommand(dynamoParams));
    res.json({ userId, ownerId, name, role, skills, email, createdAt, updatedAt });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not create user in DynamoDB" });
  }
};

exports.PatchUser = async (req, res) => {
  if (req.params.userId !== req.user.sub) {
    return res.status(403).json({ error: "Access denied" });
  }

  const { name, role, skills } = req.body;
  if (typeof name !== "string") {
    return res.status(400).json({ error: '"name" must be a string' });
  } else if (typeof role !== "string") {
    return res.status(400).json({ error: '"role" must be a string' });
  } else if (!Array.isArray(skills)) {
    return res.status(400).json({ error: '"skills" must be an array' });
  }

  const params = {
    TableName: USERS_TABLE,
    Key: { userId: req.params.userId },
    UpdateExpression: "SET #name = :name, role = :role, skills = :skills, updatedAt = :updatedAt",
    ExpressionAttributeNames: { "#name": "name" },
    ExpressionAttributeValues: {
      ":name": name,
      ":role": role,
      ":skills": skills,
      ":updatedAt": new Date().toISOString(),
    },
    ReturnValues: "ALL_NEW",
  };

  try {
    const { Attributes } = await docClient.send(new UpdateCommand(params));
    res.json(Attributes);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not update user" });
  }
};

exports.DeleteUser = async (req, res) => {
  if (req.params.userId !== req.user.sub) {
    return res.status(403).json({ error: "Access denied" });
  }

  const params = {
    TableName: USERS_TABLE,
    Key: { userId: req.params.userId },
  };

  try {
    await docClient.send(new DeleteCommand(params));
    res.json({ message: "User deleted successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not delete user" });
  }
};
