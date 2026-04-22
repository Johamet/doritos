import zod from "zod";

const EnvSchema = zod.object({
  NODE_ENV: zod.enum(["development", "production", "test"]).default("development"),
  // useMultiFileAuthState directory
  AUTH_DIR: zod.string().default("auth"),
  // Bot phone number
  BOT_PN: zod.string(),
  BOT_PREFIX: zod.string().default("!"),
});
export default EnvSchema.parse(Bun.env);
