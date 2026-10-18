import type { NextConfig } from "next";

const config: NextConfig = {
  // Produce a self-contained ".next/standalone" bundle so Fly.io's Dockerfile
  // can run the server without the full node_modules folder.
  output: "standalone",
  serverExternalPackages: ["ws", "bufferutil", "utf-8-validate"],
};

export default config;
