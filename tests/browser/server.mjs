import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from '../../server/app.mjs';
const dataDir = await mkdtemp(join(tmpdir(), 'orches-browser-'));
const application = await createApplication({ dataDir });
application.app.listen(4319, '127.0.0.1');
async function shutdown() {
  await application.close();
  await rm(dataDir, { recursive: true, force: true });
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
