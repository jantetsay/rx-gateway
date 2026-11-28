import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships WASM and must load from node_modules at runtime, not be bundled.
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
