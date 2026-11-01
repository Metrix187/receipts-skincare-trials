# Prototype security notes

Receipts is a hackathon prototype, not a production health-data service. The anonymous owner cookie is an identifier, not authenticated access control. Use synthetic demo data in a public deployment until real authentication, authorization, request limits, abuse controls, and a security review are implemented.

The local Claude-key setup endpoint only accepts same-origin requests on localhost in development. Production credentials belong in the hosting provider's secret configuration. Photos are encrypted in the database, but the optional developer inspection script can explicitly export decrypted copies outside the app; users must manage those exports separately. Deleting local photos cannot delete material already sent to YouCam.

`npm audit --omit=dev` on November 1, 2026 reports three high-severity entries for the single Prisma → @prisma/config → deepmerge-ts dependency chain, [GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx). The advisory concerns recursive object graphs; plain JSON alone does not trigger it. npm suggests a major Prisma upgrade. We have not tested that migration and do not claim the dependency tree is fully free of vulnerabilities. Next.js and Zod were updated to address the previously reported critical and high advisories. Re-run `npm audit` before deploying.
