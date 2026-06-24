// Docker healthcheck for the worker. Plain Node (no tsx/esbuild) so it starts
// fast. Exits 0 if the heartbeat file written by src/worker.ts is fresh,
// otherwise 1 -> the container is marked unhealthy.
import { readFileSync } from 'node:fs';

const file = process.env.HEARTBEAT_FILE ?? '/tmp/rift-worker-heartbeat';
const maxAgeMs = Number(process.env.HEARTBEAT_MAX_AGE_MS ?? 180_000); // 3 min

try {
  const ts = Number(readFileSync(file, 'utf8').trim());
  const age = Date.now() - ts;
  if (Number.isFinite(age) && age >= 0 && age <= maxAgeMs) {
    process.exit(0);
  }
  console.error(`unhealthy: heartbeat is ${age}ms old (max ${maxAgeMs}ms)`);
  process.exit(1);
} catch (err) {
  console.error('unhealthy: no heartbeat:', err instanceof Error ? err.message : err);
  process.exit(1);
}
