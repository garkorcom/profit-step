import React from 'react';
import { LandingMetadata } from '../../../infrastructure/types';
import legacyHtml from './legacy.html?raw';

export const metadata: LandingMetadata = {
  title: 'saas-landing',
  description: 'Автоматически перенесенная промо-страница',
  status: 'Archived',
  tech: ['HTML'],
};

export default function Landing() {
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
