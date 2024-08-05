const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  AdminUpdateUserAttributesCommand,
  AdminDeleteUserCommand,
  AdminCreateUserCommand,
  CognitoIdentityProviderClient,
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

// Sadece kendi eklediğiniz kullanıcıları listelemek için
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
    res.json(Items);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not retrieve users" });
  }
};

// Sadece kendi bilgilerini veya kendi eklediğiniz kullanıcıları almak için
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
        // Eğer istek yapan kullanıcı ekleyense veya kendi bilgilerini alıyorsa
        res.json(Item);
      } else {
        res.status(403).json({ error: "Access denied" });
      }
    } else {
      res.status(404).json({ error: 'Could not find user with provided "userId"' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not retrieve user" });
  }
};

// Yeni bir kullanıcı oluşturmak için
exports.CreateUser = async (req, res) => {
  const { name, role, permissions, email, phoneNumber } = req.body;

  if (typeof name !== "string") {
    return res.status(400).json({ error: '"name" must be a string' });
  } else if (typeof role !== "string") {
    return res.status(400).json({ error: '"role" must be a string' });
  } else if (!Array.isArray(permissions)) {
    return res.status(400).json({ error: '"permissions" must be an array' });
  } else if (typeof email !== "string") {
    return res.status(400).json({ error: '"email" must be a string' });
  } else if (typeof phoneNumber !== "string") {
    return res.status(400).json({ error: '"phoneNumber" must be a string' });
  }

  // Email'in benzersiz olduğunu kontrol et
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
      return res.status(400).json({ error: "A user with this email already exists" });
    }
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Could not check email uniqueness" });
  }

  // Cognito'da kullanıcı oluştur
  const cognitoParams = {
    UserPoolId: USER_POOL_ID,
    Username: email, // Username olarak email kullanılıyor
    UserAttributes: [
      {
        Name: "email",
        Value: email,
      },
      {
        Name: "name",
        Value: name,
      },
      {
        Name: "custom:phone_number", // Özel attribute
        Value: phoneNumber,
      },
      {
        Name: "custom:role", // Role için özel attribute
        Value: role,
      },
      {
        Name: "custom:permissions", // Permissions için özel attribute
        Value: permissions.join(","),
      },
    ],
    DesiredDeliveryMediums: ["EMAIL"], // Doğrulama kodunu email ile gönder
  };

  let cognitoUser;
  try {
    cognitoUser = await cognitoClient.send(new AdminCreateUserCommand(cognitoParams));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Could not create user in Cognito" });
  }

  // Cognito'dan dönen `sub`'ı kullanarak DynamoDB'de kullanıcı oluştur
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
      createdAt,
      updatedAt,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not create user in DynamoDB" });
  }
};

// Kullanıcı bilgilerini güncellemek için
exports.PatchUser = async (req, res) => {
  const { userId } = req.params;
  const { name, role, permissions, phoneNumber } = req.body;

  // Geçerli kullanıcının bilgileri alınıyor
  const getUserParams = {
    TableName: USERS_TABLE,
    Key: { userId },
  };

  try {
    const { Item } = await docClient.send(new GetCommand(getUserParams));
    if (!Item || (Item.ownerId !== req.user.sub && Item.userId !== req.user.sub)) {
      return res.status(403).json({ error: "Access denied" });
    }

    // Cognito'da attribute güncelleme
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
          Value: permissions.join(","),  // Converting array to comma-separated string
        },
      ],
    };

    await cognitoClient.send(new AdminUpdateUserAttributesCommand(cognitoParams));

    // DynamoDB'de attribute güncelleme
    const dynamoParams = {
      TableName: USERS_TABLE,
      Key: { userId },
      UpdateExpression: "SET #name = :name, #role = :role, #permissions = :permissions, #phoneNumber = :phoneNumber, updatedAt = :updatedAt",
      ExpressionAttributeNames: { 
        "#name": "name",
        "#role": "role",
        "#permissions": "permissions", // Using alias for permissions
        "#phoneNumber": "phoneNumber" // Using alias for phoneNumber
      },
      ExpressionAttributeValues: {
        ":name": name,
        ":role": role,
        ":permissions": permissions,
        ":phoneNumber": phoneNumber,
        ":updatedAt": new Date().toISOString(),
        ":ownerId": req.user.sub
      },
      ConditionExpression: "ownerId = :ownerId", // Sadece kullanıcı sahibi güncelleyebilir
      ReturnValues: "ALL_NEW",
    };

    const { Attributes } = await docClient.send(new UpdateCommand(dynamoParams));
    res.json(Attributes);
  } catch (error) {
    console.error("Update error:", error);
    res.status(500).json({ error: "Could not update user" });
  }
};



// Kullanıcıyı silmek için
exports.DeleteUser = async (req, res) => {
  const { userId } = req.params;

  // Silinmek istenen kullanıcı kendi mi yoksa sahibi mi kontrol ediliyor
  const getUserParams = {
    TableName: USERS_TABLE,
    Key: { userId },
  };

  try {
    const { Item } = await docClient.send(new GetCommand(getUserParams));
    if (!Item || (Item.ownerId !== req.user.sub && Item.userId !== req.user.sub)) {
      return res.status(403).json({ error: "Access denied" });
    }

    // DynamoDB'deki kullanıcıyı sil
    await docClient.send(new DeleteCommand(getUserParams));

    // Cognito'daki kullanıcıyı sil
    const cognitoParams = {
      UserPoolId: USER_POOL_ID,
      Username: Item.email, // Email kullanılarak kullanıcıyı sil
    };

    await cognitoClient.send(new AdminDeleteUserCommand(cognitoParams));

    res.json({ message: "User deleted successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not delete user" });
  }
};
