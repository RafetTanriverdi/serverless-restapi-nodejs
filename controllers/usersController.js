const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  AdminUpdateUserAttributesCommand,
  AdminDeleteUserCommand,
  AdminCreateUserCommand,
  CognitoIdentityProviderClient,
  AdminGetUserCommand,
} = require("@aws-sdk/client-cognito-identity-provider");
const {
  PutCommand,
  DynamoDBDocumentClient,
  UpdateCommand,
  DeleteCommand,
  GetCommand,
  ScanCommand,
  QueryCommand,
} = require("@aws-sdk/lib-dynamodb");

const USERS_TABLE = process.env.USERS_TABLE;
const USER_POOL_ID = process.env.USER_POOL_ID;

const dynamoClient = new DynamoDBClient();
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const cognitoClient = new CognitoIdentityProviderClient();


exports.ListUsers = async (req, res) => {

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, PATCH, DELETE");
  const params = {
    TableName: USERS_TABLE,
    FilterExpression: "ownerId = :ownerId",
    ExpressionAttributeValues: {
      ":ownerId": req.user.sub,
    },
  };

  try {
   
    const { Items } = await docClient.send(new ScanCommand(params));
    const filteredItems = Items.filter((item) => item.userId !== req.user.sub);
    res.json(filteredItems);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Could not retrieve users" });
  }
};


exports.GetUser = async (req, res) => {
  const { userId } = req.params;
  const requesterId = req.user.sub;

  const params = {
    TableName: USERS_TABLE,
    Key: { userId },
  };

  try {
    const { Item } = await docClient.send(new GetCommand(params));
    if (Item) {
      if (Item.ownerId === requesterId || Item.userId === requesterId) {
  
        res.json(Item);
      } else {
        res.status(403).json({ message: "Access denied" });
      }
    } else {
      res.status(404).json({ message: 'Could not find user with provided "userId"' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Could not retrieve user" });
  }
};


exports.CreateUser = async (req, res) => {
  const { name, role, permissions, email, phoneNumber } = req.body;

 
  if (typeof name !== "string") {
    return res.status(400).json({ message: '"name" must be a string' });
  } else if (typeof role !== "string") {
    return res.status(400).json({ message: '"role" must be a string' });
  } else if (!Array.isArray(permissions)) {
    return res.status(400).json({ message: '"permissions" must be an array' });
  } else if (typeof email !== "string") {
    return res.status(400).json({ message: '"email" must be a string' });
  } else if (typeof phoneNumber !== "string") {
    return res.status(400).json({ message: '"phoneNumber" must be a string' });
  }

  const queryParams = {
    TableName: USERS_TABLE,
    IndexName: "EmailIndex",
    KeyConditionExpression: "email = :email",
    ExpressionAttributeValues: {
      ":email": email,
    },
  };

  try {
    const { Items } = await docClient.send(new QueryCommand(queryParams));
    if (Items.length > 0) {
      return res.status(400).json({ message: "A user with this email already exists" });
    }
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Could not check email uniqueness" });
  }


  const cognitoParams = {
    UserPoolId: USER_POOL_ID,
    Username: email,
    UserAttributes: [
      { Name: "email", Value: email },
      { Name: "name", Value: name },
      { Name: "custom:phone_number", Value: phoneNumber },
      { Name: "custom:role", Value: role },
      { Name: "custom:permissions", Value: permissions.join(",") },
    ],
    DesiredDeliveryMediums: ["EMAIL"],
  };

  let cognitoUser;
  try {
    cognitoUser = await cognitoClient.send(new AdminCreateUserCommand(cognitoParams));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Could not create user in Cognito" });
  }

  let userStatus = "pending"; 
  try {
    const getUserParams = {
      UserPoolId: USER_POOL_ID,
      Username: email,
    };
    const userData = await cognitoClient.send(new AdminGetUserCommand(getUserParams));
    userStatus = userData.UserStatus || userStatus;
  } catch (error) {
    console.error("Error fetching user status from Cognito:", error);
  }


  const ownerId = req.user.sub;
  const userId = cognitoUser.User.Attributes.find((attr) => attr.Name === "sub").Value;
  const createdAt = new Date().toISOString();
  const updatedAt = createdAt;

  const dynamoParams = {
    TableName: USERS_TABLE,
    Item: {
      userId,
      ownerId,
      name,
      role,
      permissions,
      email,
      phoneNumber,
      status: userStatus,  
      createdAt,
      updatedAt,
    },
  };

  try {
    await docClient.send(new PutCommand(dynamoParams));
    res.json({
      userId,
      ownerId,
      name,
      role,
      permissions,
      email,
      phoneNumber,
      status: userStatus,
      createdAt,
      updatedAt,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Could not create user in DynamoDB" });
  }
};


exports.PatchUser = async (req, res) => {
  const { userId } = req.params;
  const { name, role, permissions, phoneNumber } = req.body;


  const getUserParams = {
    TableName: USERS_TABLE,
    Key: { userId },
  };

  try {
    const { Item } = await docClient.send(new GetCommand(getUserParams));
    if (!Item || (Item.ownerId !== req.user.sub && Item.userId !== req.user.sub)) {
      return res.status(403).json({ message: "Access denied" });
    }

    const cognitoParams = {
      UserPoolId: USER_POOL_ID,
      Username: Item.email,
      UserAttributes: [
        {
          Name: "name",
          Value: name,
        },
        {
          Name: "custom:phone_number",
          Value: phoneNumber,
        },
        {
          Name: "custom:role",
          Value: role,
        },
        {
          Name: "custom:permissions",
          Value: permissions.join(","),  
        },
      ],
    };

    await cognitoClient.send(new AdminUpdateUserAttributesCommand(cognitoParams));

    const dynamoParams = {
      TableName: USERS_TABLE,
      Key: { userId },
      UpdateExpression: "SET #name = :name, #role = :role, #permissions = :permissions, #phoneNumber = :phoneNumber, updatedAt = :updatedAt",
      ExpressionAttributeNames: { 
        "#name": "name",
        "#role": "role",
        "#permissions": "permissions", 
        "#phoneNumber": "phoneNumber" 
      },
      ExpressionAttributeValues: {
        ":name": name,
        ":role": role,
        ":permissions": permissions,
        ":phoneNumber": phoneNumber,
        ":updatedAt": new Date().toISOString(),
        ":ownerId": req.user.sub
      },
      ConditionExpression: "ownerId = :ownerId", 
      ReturnValues: "ALL_NEW",
    };

    const { Attributes } = await docClient.send(new UpdateCommand(dynamoParams));
    res.json(Attributes);
  } catch (error) {
    console.error("Update error:", error);
    res.status(500).json({ message: "Could not update user" });
  }
};




exports.DeleteUser = async (req, res) => {
  const { userId } = req.params;

  const getUserParams = {
    TableName: USERS_TABLE,
    Key: { userId },
  };

  try {
    const { Item } = await docClient.send(new GetCommand(getUserParams));
    if (!Item || (Item.ownerId !== req.user.sub && Item.userId !== req.user.sub)) {
      return res.status(403).json({ message: "Access denied" });
    }


    await docClient.send(new DeleteCommand(getUserParams));


    const cognitoParams = {
      UserPoolId: USER_POOL_ID,
      Username: Item.email, 
    };

    await cognitoClient.send(new AdminDeleteUserCommand(cognitoParams));

    res.json({ message: "User deleted successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Could not delete user" });
  }
};
