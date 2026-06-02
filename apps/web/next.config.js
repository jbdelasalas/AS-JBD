/** @type {import('next').NextConfig} */
const withPWA = require('next-pwa')({
  dest: 'public',
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === 'development',
  buildExcludes: [/middleware-manifest\.json$/],
});

const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@perpet/shared'],
  experimental: {
    serverComponentsExternalPackages: ['@node-rs/bcrypt'],
  },
};

module.exports = withPWA(nextConfig);
