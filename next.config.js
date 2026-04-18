/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @vercel/nft can't trace readFileSync() calls whose paths are
  // built dynamically (e.g. process.cwd() + join). The admin Deploy
  // tab's migrate-db route reads drizzle/*.sql at runtime — without
  // this include the file is missing from the serverless bundle and
  // the endpoint 500s in production. Route-scoped so non-admin
  // serverless cold-starts don't pay for the inclusion.
  outputFileTracingIncludes: {
    '/api/admin/deploy/migrate-db': ['./drizzle/*.sql'],
  },
  // Rewrites `import { X } from 'pkg'` into direct deep imports so
  // unused exports get tree-shaken. Phosphor is imported in 26 files
  // across the app; without this, each icon import pulls the whole
  // icon set. Recharts gets the same treatment — only a handful of
  // chart primitives are used (AreaChart/LineChart/BarChart/ScatterChart)
  // but barrel imports otherwise ship the full library.
  experimental: {
    optimizePackageImports: ['@phosphor-icons/react', 'recharts'],
  },
};

module.exports = nextConfig;
