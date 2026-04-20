import React from 'react';
import { LandingMetadata } from '../../../infrastructure/types';

// Используем ?raw синтаксис Vite для импорта HTML файла как строки
import legacyHtml from './legacy.html?raw';

export const metadata: LandingMetadata = {
  title: 'Услуги электрика ($0 Down)',
  description: 'Старый автономный промо-лендинг (Anything Electric), портированный в экосистему CRM',
  status: 'Archived',
  tech: ['HTML', 'Vanilla JS', 'Tailwind CSS CDN'],
};

export default function PromoLanding() {
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
