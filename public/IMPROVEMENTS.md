# 🚀 public/ — Улучшения Статических Ресурсов

## 🔴 Критические

### 1. PDF Worker размер
`pdf.worker.min.mjs` — **1MB**. Это грузится при каждом визите.

**Решение**: Загружать worker из CDN:
```tsx
// Вместо локального файла:
pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

// Использовать CDN:
pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;
```

### 2. PWA Manifest
Проверить `manifest.json`:
- Все иконки корректных размеров
- `start_url` правильный
- `theme_color` совпадает с MUI theme
- `screenshots` для install prompt

---

## 🟡 Среднесрочные

### 3. Landing Pages
7 лендингов в `public/`:
- `promo*/`, `saas-landing/`, `visa-aggregator-landing/`, `coffee-subscription-premium/`

Они занимают место в hosting бандле. **Переместить** на отдельные Firebase Hosting sites:
```json
// firebase.json
{
  "hosting": [
    { "target": "app", "public": "build" },
    { "target": "landing", "public": "public/saas-landing" }
  ]
}
```

### 4. Asset Compression
- Оптимизировать PNG → WebP (экономия 30-50%)
- Добавить `srcset` для разных разрешений экрана
- Service Worker: precache критических ресурсов

### 5. Favicon Set
Проверить что есть все размеры:
- `favicon.ico` (16x16, 32x32)
- `apple-touch-icon.png` (180x180)
- `icon-192.png`, `icon-512.png` (для PWA)
- `maskable_icon.png` (для Android adaptive icons)

---

## 🟢 Долгосрочные

### 6. CDN для медиа
Тяжелые ресурсы (видео, большие изображения) → Firebase Storage + CDN.

### 7. CSP Headers
Настроить Content Security Policy в `firebase.json` hosting headers.
