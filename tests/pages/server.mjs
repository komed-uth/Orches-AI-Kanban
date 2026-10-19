import express from "express";
const app = express();
app.use(express.static("docs"));
app.listen(4320, "127.0.0.1");
