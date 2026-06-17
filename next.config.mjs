/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The realtime poker server runs as a separate Node process (src/lib/realtime/server.ts).
  // Next.js handles HTTP/SSR; WebSocket gameplay is served by the standalone `npm run ws` process.
  experimental: {
    serverComponentsExternalPackages: ["@prisma/client", "bs58"],
  },
  webpack: (config) => {
    // Privy (react-auth v3) + Solana wallet adapters lazily reference optional
    // peer deps for features we don't use (Stripe onramp, Farcaster mini-apps,
    // React Native storage, etc.). Resolve them to empty modules so the webpack
    // production build doesn't fail on the missing optional packages.
    const optionalStubs = [
      "@stripe/crypto",
      "@farcaster/mini-app-solana",
      "@farcaster/frame-sdk",
      "@farcaster/miniapp-sdk",
      "@react-native-async-storage/async-storage",
      "pino-pretty",
    ];
    config.resolve.alias = {
      ...config.resolve.alias,
      ...Object.fromEntries(optionalStubs.map((m) => [m, false])),
    };
    config.externals = config.externals || [];
    return config;
  },
};

export default nextConfig;
