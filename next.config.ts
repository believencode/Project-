import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The embedded Postgres (WebAssembly) and the Postgres client run as plain Node packages.
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
};

export default nextConfig;
