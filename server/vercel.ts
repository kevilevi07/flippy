import { type VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  framework: "nextjs",
  functions: {
    // Hold the WS as long as the plan allows (Hobby: 300s, Pro: 800s).
    "app/api/tunnel/route.ts": { maxDuration: 300 },
    // Catch-all needs headroom to await the CLI reply.
    "app/t/[tid]/[[...path]]/route.ts": { maxDuration: 60 },
  },
};
