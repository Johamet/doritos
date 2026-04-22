import env from "./env.js";
import startBot from "./startBot.js";
import cluster from "node:cluster";

if (cluster.isPrimary === true) {
  cluster.fork(env);
  cluster.on("exit", function (_w, code, _s) {
    if (code === 0) {
      cluster.fork(env);
    } else {
      process.exit(1);
    }
  });
} else if (cluster.isWorker === true) {
  await startBot();
}
