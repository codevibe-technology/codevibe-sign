import type { DefaultTheme } from 'vitepress';
import type { SearchStart } from '../theme/search.ts';
import { findOperation, resources, webhookEvents, type Operation } from './model.ts';
import { pagePath, REFERENCE_DIR } from './render.ts';

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A sidebar entry for an operation: its name, with the method on the right. */
const operationText = (op: Pick<Operation, 'summary' | 'method'>) =>
  `<span class="api-nav-item"><span>${escapeHtml(op.summary)}</span><span class="api-method" data-method="${op.method}">${op.method.toUpperCase()}</span></span>`;

/** The sidebar of the HTTP API section: guides first, then one group per resource. */
export function apiSidebar(): DefaultTheme.SidebarItem[] {
  return [
    {
      text: 'Get started',
      items: [
        { text: 'Overview', link: '/http-api' },
        { text: 'Quickstart', link: '/http-api/quickstart' },
        { text: 'Authentication', link: '/http-api/authentication' },
        { text: 'Errors', link: '/http-api/errors' },
        { text: 'Pagination and retries', link: '/http-api/conventions' },
        { text: 'Local sandbox', link: '/http-api/sandbox' },
        { text: 'Versioning and changelog', link: '/http-api/changelog' },
      ],
    },
    {
      text: 'Reference',
      items: [{ text: 'All endpoints', link: '/http-api/reference' }],
    },
    ...resources().map((resource) => ({
      text: resource.name,
      link: pagePath(resource),
      collapsed: false,
      items: resource.operations.map((op) => ({
        text: operationText(op),
        link: `${pagePath(resource)}#${op.anchor}`,
      })),
    })),
    {
      text: 'Webhooks',
      link: `/${REFERENCE_DIR}/webhooks`,
      collapsed: false,
      items: [
        { text: 'Verify a delivery', link: `/${REFERENCE_DIR}/webhooks#verify-a-delivery` },
        ...webhookEvents().map((event) => ({
          text: event.summary,
          link: `/${REFERENCE_DIR}/webhooks#${event.anchor}`,
        })),
      ],
    },
  ];
}

/** Operations offered in the search box before anything is typed, most used first. */
const SHORTCUTS = [
  'createEnvelope',
  'getEnvelope',
  'listEnvelopes',
  'sendEnvelope',
  'voidEnvelope',
  'downloadDocument',
];

export function searchStart(): SearchStart {
  const all = resources();
  const api = SHORTCUTS.map((id) => {
    const op = findOperation(id);
    const resource = all.find((r) => r.operations.some((o) => o.id === id));
    if (!op || !resource) throw new Error(`Search shortcut ${id} is not in the API document`);
    return {
      text: op.summary,
      link: `${pagePath(resource)}#${op.anchor}`,
      method: op.method.toUpperCase(),
      hint: op.path,
    };
  });
  return {
    popular: [
      { text: 'Quickstart: your first envelope', link: '/http-api/quickstart', hint: 'HTTP API' },
      { text: 'Send your first envelope', link: '/guides/first-envelope', hint: 'Guide' },
      { text: 'Authentication and API keys', link: '/http-api/authentication', hint: 'HTTP API' },
      {
        text: 'Webhooks and signature verification',
        link: `/${REFERENCE_DIR}/webhooks#verify-a-delivery`,
        hint: 'Reference',
      },
      { text: 'Self-host with Docker', link: '/getting-started/docker', hint: 'Get started' },
      { text: 'Verify a sealed PDF', link: '/guides/verify-pdf', hint: 'Guide' },
      { text: 'Errors reference', link: '/http-api/errors', hint: 'HTTP API' },
    ],
    api,
  };
}
