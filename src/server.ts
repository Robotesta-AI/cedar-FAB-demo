import { createApp } from "./app.js";
import { systemClock } from "./clock.js";
import { settingsFrom } from "./settings.js";
import { seedStore } from "./store.js";

const port = Number(process.env.PORT ?? 3000);
createApp(seedStore(systemClock, settingsFrom(process.env))).listen(port, () => {
  console.log(`Cedar Pay listening on http://localhost:${port}`);
});
