/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  images: {
    // Product images come from arbitrary retailer CDNs, so we can't allowlist hosts.
    unoptimized: true,
  },
};

export default nextConfig;
