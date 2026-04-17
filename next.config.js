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
};

module.exports = nextConfig;
