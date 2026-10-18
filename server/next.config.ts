import type { NextConfig } from "next";

const config: NextConfig = {
  // Keep native/binary-flavored deps out of the bundler so their internal
  // require('bufferutil') / dynamic imports resolve against node_modules
  // at runtime instead of being partially inlined.
  serverExternalPackages: ["ws", "bufferutil", "utf-8-validate", "@neondatabase/serverless"],
};

export default config;
