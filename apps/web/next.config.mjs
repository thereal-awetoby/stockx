/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // shared package ships TypeScript source
  transpilePackages: ["@stockx/shared"],
};
export default nextConfig;
