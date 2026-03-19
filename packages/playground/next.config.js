/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    '@kernlang/core',
    '@kernlang/react',
    '@kernlang/express',
    '@kernlang/fastapi',
    '@kernlang/native',
    '@kernlang/terminal',
    '@kernlang/vue',
  ],
};

export default nextConfig;
