import zod from "zod";
import process from "node:process";

process.loadEnvFile();
const EnvSchema = zod.object({
  AUTH_DIR: zod.string().default("auth"),
  BOT_PN: zod.string(),
  BOT_PREFIX: zod.string().default("!"),
});
export default EnvSchema.parse(process.env);
