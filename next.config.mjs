// Static export is enabled only for the Cloudflare Pages frontend build
// (STATIC_EXPORT=1). The default build keeps API routes + middleware for the
// Node backend deploy.
const isStaticExport = process.env.STATIC_EXPORT === "1";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  ...(isStaticExport
    ? {
        output: "export",
        images: { unoptimized: true },
      }
    : {}),
};

export default nextConfig;
