import { config } from './config.js';
import { createApp } from './app.js';
import { migrate } from './db/migrate.js';
import { seed } from './db/seed.js';

await migrate();
await seed();

createApp().listen(config.port, () => {
  console.log(`Sogester API em http://localhost:${config.port}/api/v1`);
});
