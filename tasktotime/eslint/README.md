# tasktotime/eslint — hexagonal purity rule

Custom ESLint rule that enforces zero Firebase / MUI / framework imports inside `tasktotime/domain/**` and `tasktotime/ports/**`.

## Files

- `hexagonal-domain-purity.js` — the rule (CommonJS)
- `plugin.js` — exports the rule under the `tasktotime` plugin namespace

## How to wire into root ESLint config

The repo currently uses `oxlint` (Rust-based, not ESLint). When the time
comes to enable ESLint runs (e.g. for CI hexagonal gating), add the
following to `.eslintrc.cjs` (or create one):

```js
// .eslintrc.cjs
const path = require('path');

module.exports = {
  // ... existing config ...
  plugins: ['tasktotime'],
  // Tell ESLint how to resolve the local plugin
  // (option A — via package resolution, by adding to package.json devDeps:
  //    "tasktotime-eslint": "file:./tasktotime/eslint"
  //  then plugin name is `tasktotime-eslint`.)
  // (option B — programmatic load below):
  //
  // settings: {
  //   'tasktotime/eslint-plugin-path': path.resolve(__dirname, 'tasktotime/eslint/plugin.js'),
  // },

  overrides: [
    {
      files: ['tasktotime/domain/**/*.ts', 'tasktotime/ports/**/*.ts'],
      rules: {
        'tasktotime/hexagonal-domain-purity': 'error',
        'no-restricted-imports': ['error', {
          patterns: [
            { group: ['firebase', 'firebase/*', 'firebase-admin', 'firebase-admin/*', '@firebase/*'],
              message: 'tasktotime/domain and tasktotime/ports are pure layers — no Firebase imports. Use a port instead.' },
            { group: ['firebase-functions', 'firebase-functions/*'],
              message: 'No firebase-functions in domain/ports — wrap in adapter under tasktotime/adapters/.' },
            { group: ['@mui/*', 'react', 'react-*', '@emotion/*', '@xyflow/*', 'dagre'],
              message: 'No UI libs in domain/ports — these belong in tasktotime/ui/.' },
            { group: ['typeorm', 'prisma', '@prisma/*', 'sequelize', 'pg', 'mongoose'],
              message: 'No ORM in domain/ports — use ports.' },
            { group: ['express', 'koa', '@nestjs/*', 'fastify'],
              message: 'No HTTP frameworks in domain — wrap in tasktotime/adapters/http/.' },
            { group: ['@sendgrid/*', '@google-cloud/*', 'aws-sdk', '@aws-sdk/*', 'twilio', 'telegraf'],
              message: 'No 3rd party SDKs in domain — wrap in adapter via port.' },
            { group: ['*/adapters/*', '../adapters/*', '../../adapters/*'],
              message: 'domain and ports MUST NOT import from adapters (Dependency Inversion).' },
            { group: ['*/ui/*', '../ui/*', '../../ui/*'],
              message: 'domain and ports MUST NOT import from ui/.' },
          ],
        }],
      },
    },
  ],
};
```

## CI gate

Add to `package.json` once ESLint is in use:

```json
{
  "scripts": {
    "lint:hexagonal": "eslint 'tasktotime/domain/**/*.ts' 'tasktotime/ports/**/*.ts' --max-warnings 0"
  }
}
```

A single forbidden import → `npm run lint:hexagonal` exits non-zero, CI fails.

## Adding a new forbidden package

1. Open `hexagonal-domain-purity.js`
2. Append a regex to `FORBIDDEN_PACKAGES`
3. Add a unit test under `tasktotime/eslint/__tests__/` (Phase 1.5 — not yet
   wired)

## Why a custom rule on top of `no-restricted-imports`?

Path patterns in `no-restricted-imports` cover most cases, but the custom
rule additionally checks:

- `require()` calls (some legacy interop)
- Dynamic `import()` expressions (e.g. lazy loading)
- `export ... from` re-exports (sneaky surface area)

Both rules stack — defense in depth.
