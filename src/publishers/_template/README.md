# Publisher adapter template

Copy this directory to `src/publishers/<publisher-id>/` with `npm run publisher:create -- <publisher-id>`.

Replace the manifest values, raw response type, API request in `adapter.ts`, and field mapping in `normalizer.ts`. Keep credentials in the server configuration and register the completed adapter only after its fixture contract test passes. This directory is intentionally not imported by the publisher registry.
