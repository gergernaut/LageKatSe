import { config } from "dotenv";
import { fileURLToPath } from "node:url";

// Load the repo-root .env (where .env.example lives). pnpm runs package scripts
// with cwd = the package directory, so a plain cwd-based lookup would miss a
// repo-root .env — resolve the path relative to this file instead. A missing
// file is fine (dotenv is a no-op, built-in defaults apply).
config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });
