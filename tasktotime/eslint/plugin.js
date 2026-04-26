/**
 * ESLint plugin slot for tasktotime custom rules.
 *
 * Wires up the local rule files. Root `.eslintrc` references this plugin
 * via `plugins: ['tasktotime']` after adding `rulePaths`.
 */

'use strict';

module.exports = {
  rules: {
    'hexagonal-domain-purity': require('./hexagonal-domain-purity'),
  },
};
