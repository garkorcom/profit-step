/**
 * Custom ESLint Rules Registry
 * Регистрирует наши custom правила для использования в .eslintrc.js
 */

module.exports = {
  rules: {
    'firebase-no-trigger-loop': require('./firebase-no-trigger-loop'),
  },
};
