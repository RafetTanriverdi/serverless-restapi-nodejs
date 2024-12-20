const express = require("express");
const serverless = require("serverless-http");
const bodyParser = require("body-parser");

const userRouter = require("./routes/usersRoute");
const productRouter = require("./routes/productsRoute");
const categoryRouter = require("./routes/categoryRoute");
const customersRouter = require("./routes/customersRoute");
const ordersRouter = require("./routes/ordersRoute");
const stripeRouter = require("./routes/stripeRoute");

const app = express();

app.use(bodyParser.json({ limit: "10mb" }));
app.use(bodyParser.urlencoded({ limit: "10mb", extended: true }));

// CORS Middleware
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization"
  );
  if (req.method === "OPTIONS") {
    res.header("Access-Control-Allow-Methods", "PUT, POST, PATCH, DELETE, GET");
    return res.status(200).json({});
  }
  next();
});

//Routes
app.use("/users", userRouter);
app.use("/products", productRouter);
app.use("/categories", categoryRouter);
app.use("/customers", customersRouter);
app.use("/orders", ordersRouter);
app.use("/stripe", stripeRouter);

app.use((req, res, next) => {
  return res.status(404).json({
    error: "Not Found",
  });
});

module.exports.handler = serverless(app);
