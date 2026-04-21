// React adapter for self-docs.js
// Usage:
//   <SelfDocsPage
//     pageId="users"
//     spec={{ title, owner, purpose, inputs, outputs, features, ... }}
//   >
//     <YourPageContent />
//   </SelfDocsPage>

import { useEffect, ReactNode } from 'react';

declare global {
  interface Window {
    SelfDocs: {
      config: (opts: any) => void;
      registerPage: (id: string, spec: any) => any;
      mount: (id: string) => void;
    };
  }
}

interface PageSpec {
  title: string;
  owner?: string;
  purpose?: string;
  inputs?: { name: string; from: string; required?: boolean }[];
  outputs?: { name: string; to: string; trigger?: string }[];
  features?: string[];
  advantages?: string[];
  benefits?: string[];
  agents?: string[];
  apis?: string[];
  devNotes?: {
    rules?: string[];
    access?: { roles?: string[]; envVars?: string[]; permissions?: string[] };
    gotchas?: { author: string; date: string; note: string }[];
    changelog?: { author: string; date: string; change: string }[];
  };
}

export function SelfDocsPage({
  pageId,
  spec,
  children,
}: {
  pageId: string;
  spec: PageSpec;
  children: ReactNode;
}) {
  useEffect(() => {
    // Ensure self-docs.js was loaded via <script> in index.html or via bundler
    if (!window.SelfDocs) {
      console.warn('[SelfDocs] window.SelfDocs not found. Add <script src="/self-docs.js"></script> to index.html.');
      return;
    }
    window.SelfDocs.registerPage(pageId, spec);
    // Mount after children render
    const t = setTimeout(() => window.SelfDocs.mount(pageId), 50);
    return () => clearTimeout(t);
  }, [pageId]);

  return (
    <>
      {/* Your page needs a #page-content wrapper for UC/TZ footers to inject into */}
      <div id="page-content">{children}</div>
    </>
  );
}

// ─── USAGE EXAMPLE ──────────────────────────────────────────────────────────
export function UsersPage() {
  return (
    <SelfDocsPage
      pageId="users"
      spec={{
        title: 'Users',
        owner: 'admin',
        purpose: 'CRUD for application users — invite, roles, deactivate.',
        inputs: [
          { name: 'users[]', from: 'UserService', required: true },
        ],
        outputs: [
          { name: 'invite-user', to: 'UserService.invite', trigger: '+ button' },
          { name: 'deactivate', to: 'UserService.deactivate', trigger: 'row action' },
        ],
        features: ['Sortable table', 'Invite flow', 'Role editor'],
        advantages: ['Bulk invite via CSV', 'Soft-delete (reversible)'],
        benefits: ['Onboarding 10 users in < 1 min', 'Zero accidental permanent deletes'],
        agents: ['auth-guard', 'email-sender'],
        apis: ['GET /api/users', 'POST /api/users/invite', 'POST /api/users/:id/deactivate'],
        devNotes: {
          rules: [
            'Soft-delete only. Never DELETE from DB — historical audit needs this.',
            'Role changes trigger JWT refresh on next request — explain to user.',
          ],
          access: {
            roles: ['admin', 'owner'],
            envVars: ['SENDGRID_API_KEY'],
            permissions: ['users.read', 'users.invite', 'users.deactivate'],
          },
          gotchas: [
            { author: 'alice', date: '2025-01-10', note: 'CSV invite: trim whitespace in email — caused duplicates' },
          ],
          changelog: [
            { author: 'seed', date: '2025-01-01', change: 'Initial' },
          ],
        },
      }}
    >
      <h1>Users</h1>
      {/* ... your content ... */}
    </SelfDocsPage>
  );
}
