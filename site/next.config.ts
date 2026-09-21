import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Marketing and legal pages are fully static.
  output: "export",
  trailingSlash: true,
};

export default nextConfig;
