import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // pdfjs-dist must NOT be bundled into the server chunks: its legacy build does a
  // dynamic import("./pdf.worker.mjs") and a createRequire("@napi-rs/canvas") that only
  // resolve when the package is loaded from node_modules at runtime. Bundled, the worker
  // import points at an unemitted chunk ("Cannot find module .../pdf.worker.mjs"). The
  // Dockerfile overlays the full pdfjs-dist (worker + standard_fonts + cmaps) for this.
  serverExternalPackages: ["better-sqlite3", "pdfjs-dist"],
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
