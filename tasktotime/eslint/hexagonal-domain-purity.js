/**
 * tasktotime/hexagonal-domain-purity — ESLint custom rule.
 *
 * Enforces hexagonal architecture purity inside `tasktotime/domain/**` and
 * `tasktotime/ports/**`:
 *   - No imports from `firebase-*`, `@firebase/*`, `firebase-functions`
 *   - No imports from UI libs (`@mui/*`, `react`, `@xyflow/*`, `dagre`)
 *   - No imports from ORMs (`prisma`, `typeorm`, ...)
 *   - No imports from HTTP frameworks (`express`, `koa`, `@nestjs/*`, ...)
 *   - No imports from filesystem / network primitives
 *   - No imports FROM `adapters/` or `ui/` (dependency-inversion direction)
 *
 * Catches `import`, `require()`, dynamic `import()`, and `export ... from`.
 *
 * See blueprint section §4.2 for rationale.
 */

'use strict';

const FORBIDDEN_PACKAGES = [
  // Firebase
  /^firebase($|\/)/,
  /^firebase-admin($|\/)/,
  /^@firebase\//,
  /^firebase-functions($|\/)/,
  // UI
  /^@mui\//,
  /^react($|-|\/)/,
  /^@emotion\//,
  /^@xyflow\//,
  /^dagre$/,
  // ORM
  /^typeorm$/,
  /^prisma$/,
  /^@prisma\//,
  /^sequelize$/,
  /^pg$/,
  /^mongoose$/,
  // HTTP
  /^express$/,
  /^koa$/,
  /^@nestjs\//,
  /^fastify$/,
  // 3rd-party SDKs
  /^@sendgrid\//,
  /^@google-cloud\//,
  /^aws-sdk$/,
  /^@aws-sdk\//,
  /^twilio$/,
  /^telegraf$/,
  /^node-telegram-bot-api$/,
  // Filesystem / process (domain must be runtime-agnostic)
  /^fs($|\/)/,
  /^child_process$/,
  /^http$/,
  /^https$/,
  /^net$/,
];

function isForbidden(source) {
  return FORBIDDEN_PACKAGES.some((re) => re.test(source));
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid impure imports inside tasktotime/domain and tasktotime/ports',
      recommended: true,
    },
    schema: [],
    messages: {
      forbiddenImport:
        'Forbidden import "{{source}}" in {{layer}}. Hexagonal purity requires I/O via ports. ' +
        'If you need {{source}}, wrap it in tasktotime/adapters/<adapter>/ and inject via a port interface.',
      adapterImport:
        '{{layer}} layer cannot import from adapters/. Reverse the dependency: define a port interface in ports/ and have the adapter implement it.',
      uiImport:
        '{{layer}} layer cannot import from ui/. UI depends on domain, not the reverse.',
    },
  },

  create(context) {
    const filename = (
      context.getFilename ? context.getFilename() : context.filename
    ).replace(/\\/g, '/');
    const isDomain = /\/tasktotime\/domain\//.test(filename);
    const isPorts = /\/tasktotime\/ports\//.test(filename);
    if (!isDomain && !isPorts) return {};

    const layer = isDomain ? 'tasktotime/domain' : 'tasktotime/ports';

    function check(source, node) {
      if (typeof source !== 'string') return;
      if (isForbidden(source)) {
        context.report({
          node,
          messageId: 'forbiddenImport',
          data: { source, layer },
        });
        return;
      }
      if (/(^|\/)adapters(\/|$)/.test(source)) {
        context.report({ node, messageId: 'adapterImport', data: { layer } });
        return;
      }
      if (/(^|\/)ui(\/|$)/.test(source)) {
        context.report({ node, messageId: 'uiImport', data: { layer } });
      }
    }

    return {
      ImportDeclaration(node) {
        check(node.source.value, node);
      },
      ImportExpression(node) {
        if (node.source.type === 'Literal') check(node.source.value, node);
      },
      'CallExpression[callee.name="require"]'(node) {
        const arg = node.arguments[0];
        if (arg && arg.type === 'Literal') check(arg.value, node);
      },
      ExportAllDeclaration(node) {
        check(node.source.value, node);
      },
      ExportNamedDeclaration(node) {
        if (node.source) check(node.source.value, node);
      },
    };
  },
};
