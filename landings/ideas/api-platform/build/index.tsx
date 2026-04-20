import React from 'react';
import { LandingMetadata } from '../../../infrastructure/types';

// Используем ?raw синтаксис Vite для импорта HTML файла как строки
import legacyHtml from './legacy.html?raw';

export const metadata: LandingMetadata = {
  title: 'API Platform',
  description: 'Garkor CRM Platform — Developer portal and API documentation landing.',
  status: 'Live',
  tech: ['HTML', 'Vanilla JS', 'Tailwind CSS CDN'],
};

export default function ApiPlatformLanding() {
  return (
    <iframe
      title={metadata.title}
      srcDoc={legacyHtml}
      style={{
        width: '100%',
        height: '100vh',
        border: 'none',
        display: 'block'
      }}
    />
  );
}
