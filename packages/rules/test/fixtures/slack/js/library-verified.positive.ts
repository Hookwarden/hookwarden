import { App, ExpressReceiver } from "@slack/bolt";

const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET ?? "",
});

const app = new App({
  token: process.env.SLACK_BOT_TOKEN ?? "",
  receiver,
});

app.event("app_mention", async ({ event, say }) => {
  await say(`Hello, <@${event.user}>`);
});

receiver.app.listen(3000);
