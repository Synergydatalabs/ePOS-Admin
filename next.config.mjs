// Minimal Next config for tapapp-admin.
// Matches tap-app pattern: ignore TS build errors so bad-day deploys still ship.

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typescript: {
    ignoreBuildErrors: true,
  },
  // Standalone build produces `.next/standalone/server.js` — matches
  // the other apps' pm2 ecosystem entries (zashx-app, admin-app, etc.)
  // so we can point pm2 at the same script path.
  output: "standalone",
};

export default nextConfig;
