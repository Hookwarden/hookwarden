import express from "express";

const app = express();
app.use(express.json());

app.post("/slack/events", async (req, res) => {
  // BUG: no signature verification at all.
  const event = req.body;
  console.log("Slack event:", event.type);
  res.status(200).send("");
});

app.listen(3000);
