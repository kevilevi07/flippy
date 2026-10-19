import type { NextConfig } from "next";

const GH = "https://github.com/kevilevi07/flippy/releases/latest/download";

const config: NextConfig = {
  serverExternalPackages: ["ws", "bufferutil", "utf-8-validate", "@neondatabase/serverless"],
  // Redirect single-binary downloads to the GitHub Release so users can grab
  // trupx with one curl/wget line, ngrok-style.
  async redirects() {
    return [
      { source: "/trupx-linux-x64",       destination: `${GH}/trupx-linux-x64`,       permanent: false },
      { source: "/trupx-linux-aarch64",   destination: `${GH}/trupx-linux-aarch64`,   permanent: false },
      { source: "/trupx-darwin-x64",      destination: `${GH}/trupx-darwin-x64`,      permanent: false },
      { source: "/trupx-darwin-aarch64",  destination: `${GH}/trupx-darwin-aarch64`,  permanent: false },
    ];
  },
};

export default config;
