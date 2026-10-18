import { createApplication } from "./app.mjs";
const application = await createApplication({
  dataDir: process.env.ORCHES_DATA_DIR,
});
const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 3000);
application.app.listen(port, host, () =>
  console.log(`Orches AI Kanban: http://${host}:${port}`),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await application.close();
    process.exit(0);
  });
