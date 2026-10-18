import { spawnManaged } from "../../server/processes.mjs";
const child = spawnManaged(
  process.execPath,
  [
    "-e",
    `process.on('SIGTERM',()=>{}); console.log(JSON.stringify({pid:process.pid}));setInterval(()=>{},1000);`,
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
