import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Stray package-lock.json files exist above this directory, which makes Next
  // infer the wrong workspace root and mis-trace files. Pin it to this repo.
  outputFileTracingRoot: path.resolve(__dirname),
};

export default nextConfig;
