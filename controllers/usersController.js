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
const PRODUCTS_TABLE = process.env.PRODUCTS_TABLE;
const CATEGORIES_TABLE = process.env.CATEGORIES_TABLE;

const dynamoClient = new DynamoDBClient();
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const cognitoClient = new CognitoIdentityProviderClient();

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

  const getCurrentuserParams = {
    TableName: USERS_TABLE,
    Key: { userId: req.user.sub },
  };

  const { Item: currentUser } = await docClient.send(
    new GetCommand(getCurrentuserParams)
  );

  try {
    const { Items } = await docClient.send(new QueryCommand(queryParams));
    if (Items.length > 0) {
      return res
        .status(400)
        .json({ message: "A user with this email already exists" });
    }
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Could not check email uniqueness" });
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
    cognitoUser = await cognitoClient.send(
      new AdminCreateUserCommand(cognitoParams)
    );
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Could not create user in Cognito" });
  }

  let userStatus = "pending";
  try {
    const getUserParams = {
      UserPoolId: USER_POOL_ID,
      Username: email,
    };
    const userData = await cognitoClient.send(
      new AdminGetUserCommand(getUserParams)
    );
    userStatus = userData.UserStatus || userStatus;
  } catch (error) {
    res.status(500).json({ message: "Could not retrieve user status" });
  }

  const ownerId = req.user.sub;
  const userId = cognitoUser.User.Attributes.find(
    (attr) => attr.Name === "sub"
  ).Value;
  const createdAt = new Date().toISOString();
  const updatedAt = createdAt;

  const familyId = currentUser.familyId || ownerId;

  const dynamoParams = {
    TableName: USERS_TABLE,
    Item: {
      userId,
      ownerId,
      familyId,
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
      familyId,
      status: userStatus,
      createdAt,
      updatedAt,
    });
  } catch (error) {
    res.status(500).json({ message: "Could not create user in DynamoDB" });
  }
};

exports.ListUsers = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, OPTIONS, PUT, PATCH, DELETE"
  );

  const userId = req.user.sub;

  const getUserParams = {
    TableName: USERS_TABLE,
    Key: { userId },
  };

  try {
    const { Item: currentUser } = await docClient.send(
      new GetCommand(getUserParams)
    );
    if (!currentUser) {
      return res.status(404).json({ message: "User not found" });
    }

    const familyId = currentUser.familyId;

    const listUsersParams = {
      TableName: USERS_TABLE,
      FilterExpression:
        "familyId = :familyId AND userId <> :userId AND userId <> :familyId",
      ExpressionAttributeValues: {
        ":familyId": familyId,
        ":userId": userId,
      },
    };

    const { Items } = await docClient.send(new ScanCommand(listUsersParams));
    res.json(Items);
  } catch (error) {
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
      res
        .status(404)
        .json({ message: 'Could not find user with provided "userId"' });
    }
  } catch (error) {
    res.status(500).json({ message: "Could not retrieve user" });
  }
};

exports.PatchUser = async (req, res) => {
  const { userId } = req.params;
  const { name, role, permissions, phoneNumber, gender, birthday } = req.body;

  console.log(permissions, "permissions");
  const getUserParams = {
    TableName: USERS_TABLE,
    Key: { userId },
  };

  try {
    const { Item } = await docClient.send(new GetCommand(getUserParams));
    if (!Item) {
      return res.status(404).json({ message: "User not found" });
    }

    const updatedName = name || Item.name;
    const updatedRole = role || Item.role;
    const updatedPermissions = Array.isArray(permissions)
      ? permissions
      : Item.permissions;
    const updatedPhoneNumber = phoneNumber || Item.phoneNumber;
    const updatedGender = gender || Item.gender;
    const updatedBirthday = birthday || Item.birthday;

    const userAttributes = [
      { Name: "name", Value: updatedName },
      { Name: "custom:phone_number", Value: updatedPhoneNumber },
      { Name: "custom:role", Value: updatedRole },
      { Name: "custom:permissions", Value: updatedPermissions.join(",") },
    ];

    if (updatedGender && process.env.ENABLE_CUSTOM_GENDER) {
      userAttributes.push({ Name: "custom:gender", Value: updatedGender });
    }

    if (updatedBirthday && process.env.ENABLE_CUSTOM_BIRTHDAY) {
      userAttributes.push({ Name: "custom:birthday", Value: updatedBirthday });
    }

    const cognitoParams = {
      UserPoolId: USER_POOL_ID,
      Username: Item.email,
      UserAttributes: userAttributes,
    };

    await cognitoClient.send(
      new AdminUpdateUserAttributesCommand(cognitoParams)
    );

    const updatedAt = new Date().toISOString();

    const dynamoParams = {
      TableName: USERS_TABLE,
      Key: { userId },
      UpdateExpression:
        "SET #name = :name, #role = :role, #permissions = :permissions, #phoneNumber = :phoneNumber, updatedAt = :updatedAt" +
        (updatedGender ? ", #gender = :gender" : "") +
        (updatedBirthday ? ", #birthday = :birthday" : ""),
      ExpressionAttributeNames: {
        "#name": "name",
        "#role": "role",
        "#permissions": "permissions",
        "#phoneNumber": "phoneNumber",
        ...(updatedGender && { "#gender": "gender" }),
        ...(updatedBirthday && { "#birthday": "birthday" }),
      },
      ExpressionAttributeValues: {
        ":name": updatedName,
        ":role": updatedRole,
        ":permissions": updatedPermissions,
        ":phoneNumber": updatedPhoneNumber,
        ":updatedAt": updatedAt,
        ...(updatedGender && { ":gender": updatedGender }),
        ...(updatedBirthday && { ":birthday": updatedBirthday }),
      },
      ReturnValues: "ALL_NEW",
    };

    const { Attributes } = await docClient.send(
      new UpdateCommand(dynamoParams)
    );

    res.json(Attributes);
  } catch (error) {
    console.error("Error updating user:", error);
    res.status(500).json({ message: "Could not update user" });
  }
};

const AWS = require("aws-sdk");
const apigatewaymanagementapi = new AWS.ApiGatewayManagementApi({
  endpoint: "31zsiurny9.execute-api.us-east-1.amazonaws.com/production",
});

exports.DeleteUser = async (req, res) => {
  const { userId } = req.params;

  const getUserParams = {
    TableName: USERS_TABLE,
    Key: { userId },
  };

  try {
    const { Item } = await docClient.send(new GetCommand(getUserParams));
    if (
      !Item ||
      (Item.ownerId !== req.user.sub &&
        Item.userId !== req.user.sub &&
        Item.familyId !== req.userId)
    ) {
      return res.status(403).json({ message: "Access denied" });
    }

    const connectionId = Item.connectionId;

    const permissions = Item.permissions;

    if (connectionId) {
      const message = JSON.stringify({ action: "clearLocalStorage" });
      try {
        await apigatewaymanagementapi
          .postToConnection({
            ConnectionId: connectionId,
            Data: message,
          })
          .promise();
      } catch (error) {
        if (error.statusCode === 410) {
          console.warn(
            "Connection ID has expired or is no longer valid:",
            connectionId
          );
        } else {
          res.status(500).json({ message: "Could not send message" });
        }
      }
    }

    await docClient.send(new DeleteCommand(getUserParams));
    await cognitoClient.send(
      new AdminDeleteUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: Item.email,
      })
    );

    res.json({ message: "User deleted successfully" });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Could not delete user" });
  }
};

exports.GetMyProfile = async (req, res) => {
  const userId = req.user.sub;

  const params = {
    TableName: USERS_TABLE,
    Key: { userId },
  };

  try {
    const { Item } = await docClient.send(new GetCommand(params));
    if (Item) {
      res.json(Item);
    } else {
      res.status(404).json({ message: "User not found" });
    }
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Could not retrieve user" });
  }
};
exports.UpdateMyProfile = async (req, res) => {
  const userId = req.user.sub;
  console.log(res, req);
  const { name, phoneNumber, birthday, gender } = req.body;

  const getUserParams = {
    TableName: USERS_TABLE,
    Key: { userId },
  };

  try {
    const { Item } = await docClient.send(new GetCommand(getUserParams));
    if (!Item) {
      return res.status(404).json({ message: "User not found" });
    }

    const userAttributes = [
      { Name: "name", Value: updatedName },
      { Name: "custom:phone_number", Value: updatedPhoneNumber },
      { Name: "custom:role", Value: updatedRole },
    ];

    const cognitoParams = {
      UserPoolId: USER_POOL_ID,
      Username: Item.email,
      UserAttributes: userAttributes,
    };

    const updatedName = name || Item.name;
    const updatedPhoneNumber = phoneNumber || Item.phoneNumber;
    const updatedGender = gender || Item.gender;
    const updatedBirthday = birthday || Item.birthday;
    const updatedAt = new Date().toISOString();

    const dynamoParams = {
      TableName: USERS_TABLE,
      Key: { userId },
      UpdateExpression:
        "SET #name = :name, #phoneNumber = :phoneNumber, updatedAt = :updatedAt" +
        (updatedGender ? ", #gender = :gender" : "") +
        (updatedBirthday ? ", #birthday = :birthday" : ""),
      ExpressionAttributeNames: {
        "#name": "name",
        "#phoneNumber": "phoneNumber",
        ...(updatedGender && { "#gender": "gender" }),
        ...(updatedBirthday && { "#birthday": "birthday" }),
      },
      ExpressionAttributeValues: {
        ":name": updatedName,
        ":phoneNumber": updatedPhoneNumber,
        ":updatedAt": updatedAt,
        ...(updatedGender && { ":gender": updatedGender }),
        ...(updatedBirthday && { ":birthday": updatedBirthday }),
      },
      ReturnValues: "ALL_NEW",
    };
    try {
      await cognitoClient.send(
        new AdminUpdateUserAttributesCommand(cognitoParams)
      );

      const { Attributes } = await docClient.send(
        new UpdateCommand(dynamoParams)
      );
      res.json(Attributes);
    } catch (error) {
      console.error("Error updating user:", error);
      res.status(500).json({ message: "Could not update user" });
    }
  } catch (error) {
    console.log(error);
    return res.status(500).json({ message: "Could not retrieve user" });
  }
};
