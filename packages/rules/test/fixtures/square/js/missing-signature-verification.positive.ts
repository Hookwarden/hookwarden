import express from "express";

const app = express();
app.use(express.json());

app.post("/webhooks/square", async (req, res) => {
  // BUG: no HMAC verification.
  const event = req.body;
  console.log("Square event:", event.event_id);
  res.status(200).end();
});

app.listen(3000);
