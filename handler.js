const express = require("express");
const serverless = require("serverless-http");
const bodyParser = require('body-parser');
const userRouter = require("./routes/usersRoute");
const productRouter = require("./routes/productsRoute");
const categoryRouter = require("./routes/categoryRoute");
require('dotenv').config();

const app = express();

app.use(express.json());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

// CORS Middleware
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
  if (req.method === "OPTIONS") {
    res.header("Access-Control-Allow-Methods", "PUT, POST, PATCH, DELETE, GET");
    return res.status(200).json({});
  }
  next();
});

// Middleware to add timestamps
app.use((req, res, next) => {
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
    req.body.createdAt = new Date().toISOString();
    req.body.updatedAt = new Date().toISOString();
  }
  next();
});

//Routes
app.use("/users", userRouter);
app.use("/products", productRouter);
app.use('/categories',categoryRouter)

app.use((req, res, next) => {
  return res.status(404).json({
    error: "Not Found",
  });
});

module.exports.handler = serverless(app);
