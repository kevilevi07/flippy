import { type VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  framework: "nextjs",
  functions: {
    // Hold the CLI's WS as long as the plan allows (Hobby: 300s, Pro: 800s).
    "app/api/tunnel/route.ts": { maxDuration: 300 },
    // Catch-all awaits a tunnel reply + proxies public HTTP/WS traffic.
    "app/[tid]/[[...path]]/route.ts": { maxDuration: 300 },
  },
};
