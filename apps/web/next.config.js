/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@perpet/shared'],
  experimental: {
    serverComponentsExternalPackages: ['@node-rs/bcrypt'],
  },
};

module.exports = nextConfig;
