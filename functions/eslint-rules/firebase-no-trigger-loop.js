/**
 * Custom ESLint Rule: firebase-no-trigger-loop
 *
 * Обнаруживает потенциальные infinite loops в Firebase Functions triggers
 *
 * ОШИБКА выдается если:
 * 1. Функция использует onUpdate или onWrite триггер
 * 2. Внутри функции есть вызов update() или set() на тот же путь
 * 3. НЕТ idempotency guard (проверка change.before/change.after в начале)
 *
 * Примеры:
 *
 * ❌ BAD (выдаст ERROR):
 * ```
 * export const myFunction = functions
 *   .firestore.document('users/{userId}')
 *   .onUpdate(async (change, context) => {
 *     await change.after.ref.update({ count: 1 });  // ← INFINITE LOOP!
 *   });
 * ```
 *
 * ✅ GOOD (no error):
 * ```
 * export const myFunction = functions
 *   .firestore.document('users/{userId}')
 *   .onUpdate(async (change, context) => {
 *     const before = change.before.data();  // ← Idempotency guard
 *     const after = change.after.data();
 *     if (before.field === after.field) return;  // ← Guard check
 *
 *     await change.after.ref.update({ count: 1 });
 *   });
 * ```
 */

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Prevent infinite loops in Firebase onUpdate/onWrite triggers',
      category: 'Possible Errors',
      recommended: true,
      url: 'https://github.com/your-repo/eslint-rules/firebase-no-trigger-loop',
    },
    fixable: null,
    schema: [],
    messages: {
      noTriggerLoop:
        '🚨 DANGER: Potential infinite loop detected! ' +
        'onUpdate/onWrite trigger calls update() on the same document without idempotency guard. ' +
        'This can cause millions of API calls and $$$$ billing. ' +
        'Add: `if (change.before.data()... === change.after.data()...) return;` at the start.',
      missingIdempotencyGuard:
        '⚠️ WARNING: onUpdate/onWrite trigger missing idempotency guard. ' +
        'Add `change.before.data()` check in first 10 lines to prevent infinite loops.',
    },
  },

  create(context) {
    // Отслеживаем состояние анализа
    let currentTriggerType = null; // 'onUpdate', 'onWrite', null
    let currentDocumentPath = null; // 'users/{userId}'
    let hasIdempotencyGuard = false;
    let linesChecked = 0;
    let foundSuspiciousUpdate = false;

    return {
      // Детектируем onUpdate/onWrite триггеры
      CallExpression(node) {
        // Проверяем на паттерн: .onUpdate() или .onWrite()
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.property.type === 'Identifier' &&
          (node.callee.property.name === 'onUpdate' || node.callee.property.name === 'onWrite')
        ) {
          currentTriggerType = node.callee.property.name;

          // Пытаемся извлечь document path
          // Паттерн: functions.firestore.document('users/{userId}').onUpdate(...)
          let documentNode = node.callee.object;
          while (documentNode) {
            if (
              documentNode.type === 'CallExpression' &&
              documentNode.callee.type === 'MemberExpression' &&
              documentNode.callee.property.name === 'document' &&
              documentNode.arguments.length > 0 &&
              documentNode.arguments[0].type === 'Literal'
            ) {
              currentDocumentPath = documentNode.arguments[0].value;
              break;
            }
            documentNode = documentNode.callee ? documentNode.callee.object : null;
          }

          // Сбрасываем флаги для нового триггера
          hasIdempotencyGuard = false;
          linesChecked = 0;
          foundSuspiciousUpdate = false;
        }

        // Если мы внутри onUpdate/onWrite - проверяем на update()/set()
        if (currentTriggerType && node.callee.type === 'MemberExpression') {
          const methodName = node.callee.property.name;

          // Опасные методы: update, set
          if (methodName === 'update' || methodName === 'set') {
            // Проверяем что это вызов на change.after.ref
            const sourceCode = context.getSourceCode();
            const callText = sourceCode.getText(node.callee.object);

            if (
              callText.includes('change.after.ref') ||
              callText.includes('change.before.ref') ||
              callText.includes('snap.ref') ||
              callText.includes('change.ref')
            ) {
              foundSuspiciousUpdate = true;

              // Если нет idempotency guard - ОШИБКА!
              if (!hasIdempotencyGuard) {
                context.report({
                  node,
                  messageId: 'noTriggerLoop',
                });
              }
            }
          }
        }
      },

      // Детектируем idempotency guards
      // Паттерн: const before = change.before.data()
      VariableDeclarator(node) {
        if (!currentTriggerType) return;

        linesChecked++;

        // Проверяем только первые 15 строк функции
        if (linesChecked > 15) return;

        const sourceCode = context.getSourceCode();

        if (node.init) {
          const initText = sourceCode.getText(node.init);

          // Ищем паттерны idempotency guard
          if (
            initText.includes('change.before.data()') ||
            initText.includes('change.after.data()') ||
            initText.includes('snap.data()')
          ) {
            hasIdempotencyGuard = true;
          }
        }
      },

      // Детектируем сравнения before/after (еще один паттерн guard)
      IfStatement(node) {
        if (!currentTriggerType) return;

        linesChecked++;

        if (linesChecked > 15) return;

        const sourceCode = context.getSourceCode();
        const testText = sourceCode.getText(node.test);

        // Ищем сравнения before === after
        if (
          (testText.includes('before') && testText.includes('after')) ||
          testText.includes('changed')
        ) {
          hasIdempotencyGuard = true;
        }
      },

      // В конце function expression - проверяем результаты
      'FunctionExpression:exit'(node) {
        if (!currentTriggerType) return;

        // Если нашли update() но нет guard - WARNING
        if (foundSuspiciousUpdate && !hasIdempotencyGuard) {
          context.report({
            node,
            messageId: 'missingIdempotencyGuard',
          });
        }

        // Сбрасываем состояние
        currentTriggerType = null;
        currentDocumentPath = null;
        hasIdempotencyGuard = false;
        foundSuspiciousUpdate = false;
        linesChecked = 0;
      },

      'ArrowFunctionExpression:exit'(node) {
        if (!currentTriggerType) return;

        if (foundSuspiciousUpdate && !hasIdempotencyGuard) {
          context.report({
            node,
            messageId: 'missingIdempotencyGuard',
          });
        }

        currentTriggerType = null;
        currentDocumentPath = null;
        hasIdempotencyGuard = false;
        foundSuspiciousUpdate = false;
        linesChecked = 0;
      },
    };
  },
};
