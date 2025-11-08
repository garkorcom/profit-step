import { useEffect } from 'react';

/**
 * Hook для регистрации keyboard shortcuts
 *
 * Поддерживает:
 * - Ctrl/Cmd + клавиша
 * - Alt + клавиша
 * - Shift + клавиша
 * - Одиночные клавиши
 *
 * Примеры:
 * - 'ctrl+r' - Ctrl+R (Cmd+R на Mac)
 * - 'ctrl+arrowright' - Ctrl+→
 * - 'escape' - ESC
 *
 * @param shortcuts - Map клавиша -> callback
 */
export function useKeyboardShortcuts(shortcuts: Record<string, () => void>) {
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // Игнорируем shortcuts если фокус на input/textarea
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        // Разрешаем ESC даже в input
        if (e.key.toLowerCase() !== 'escape') {
          return;
        }
      }

      // Построить key string
      const modifiers: string[] = [];
      if (e.ctrlKey || e.metaKey) modifiers.push('ctrl'); // Meta = Cmd на Mac
      if (e.altKey) modifiers.push('alt');
      if (e.shiftKey) modifiers.push('shift');

      const key = e.key.toLowerCase();
      const fullKey = modifiers.length > 0 ? `${modifiers.join('+')}+${key}` : key;

      // Проверяем наличие shortcut
      if (shortcuts[fullKey]) {
        e.preventDefault();
        shortcuts[fullKey]();
      }
    };

    window.addEventListener('keydown', handleKeyPress);

    return () => {
      window.removeEventListener('keydown', handleKeyPress);
    };
  }, [shortcuts]);
}

/**
 * Форматирует shortcut для отображения пользователю
 * @param shortcut - Строка shortcut (например, 'ctrl+r')
 * @returns Отформатированная строка (например, 'Ctrl+R' или '⌘R' на Mac)
 */
export function formatShortcut(shortcut: string): string {
  const isMac = navigator.platform.toUpperCase().includes('MAC');

  let formatted = shortcut
    .split('+')
    .map((part) => {
      const lower = part.toLowerCase();

      // Заменяем на Mac symbols
      if (isMac) {
        if (lower === 'ctrl') return '⌘';
        if (lower === 'alt') return '⌥';
        if (lower === 'shift') return '⇧';
      }

      // Capitalize first letter
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(isMac ? '' : '+');

  // Заменяем arrow keys на символы
  formatted = formatted.replace(/ArrowRight/gi, '→');
  formatted = formatted.replace(/ArrowLeft/gi, '←');
  formatted = formatted.replace(/ArrowUp/gi, '↑');
  formatted = formatted.replace(/ArrowDown/gi, '↓');

  return formatted;
}
