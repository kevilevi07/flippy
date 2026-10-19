import type { NextConfig } from "next";

const config: NextConfig = {
  serverExternalPackages: ["ws", "bufferutil", "utf-8-validate", "@neondatabase/serverless"],
};

export default config;
