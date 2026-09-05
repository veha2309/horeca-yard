import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PublicSite } from '../src/public.js';
import { Admin } from '../src/admin.js';
import { useSiteMotion } from '../src/motion.js';
import { Notifications } from '../src/notifications.js';

let dom: JSDOM,
  root: Root,
  reduced = false;
const observers: any[] = [];
const mockProduct = {
  id: '38b8fe14-e5b1-4cc3-8c42-d0af6c942d50',
  name: 'French Fries',
  brand: 'McCain',
  category: 'Frozen Foods',
  packSize: '2.5 kg',
  moq: '1 carton (4 bags)',
  minQuantity: 4,
  image: '/images/mccain-french-fries.jpg',
  description: 'Wholesale fries',
  published: true,
  featured: true,
  availability: 'On request',
};
before(() => {
  dom = new JSDOM('<!doctype html><html><body><div id="test-root"></div></body></html>', {
    url: 'http://localhost:3000',
  });
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    location: dom.window.location,
    history: dom.window.history,
    HTMLElement: dom.window.HTMLElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    FormData: dom.window.FormData,
    IS_REACT_ACT_ENVIRONMENT: true,
  }))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  Object.defineProperty(dom.window, 'matchMedia', {
    value: () => ({ matches: reduced, addEventListener() {}, removeEventListener() {} }),
  });
  (globalThis as any).addEventListener = dom.window.addEventListener.bind(dom.window);
  (globalThis as any).removeEventListener = dom.window.removeEventListener.bind(dom.window);
  (dom.window.HTMLDialogElement.prototype as any).showModal = function () {
    this.setAttribute('open', '');
  };
  class Observer {
    elements = new Set<Element>();
    constructor(public callback: any) {
      observers.push(this);
    }
    observe(e: Element) {
      this.elements.add(e);
    }
    unobserve(e: Element) {
      this.elements.delete(e);
    }
    disconnect() {
      this.elements.clear();
    }
  }
  (globalThis as any).IntersectionObserver = Observer;
});
beforeEach(() => {
  reduced = false;
  observers.length = 0;
  dom.window.document.getElementById('test-root')!.innerHTML = '';
  root = createRoot(dom.window.document.getElementById('test-root')!);
  globalThis.fetch = (async (input: any) => {
    const path = String(input);
    const body = path.startsWith('/api/admin/notifications')
      ? { cursor: '0', notifications: [], events: [], changed: false, unread: 0 }
      : path === '/api/catalogue'
        ? {
            products: [mockProduct],
            categories: [{ id: 'category', name: 'Frozen Foods' }],
            brands: [{ id: 'brand', name: 'McCain' }],
            settings: { phone: '9818180167' },
          }
        : path === '/api/admin/me'
          ? { id: 'owner', name: 'Owner', email: 'admin@test.example', role: 'Owner' }
          : path === '/api/admin/reports'
            ? {
                newEnquiries: 0,
                orderTotal: 0,
                orders: 0,
                outstanding: 0,
                conversion: 0,
                lowStock: [],
                expiring: [],
              }
            : path.endsWith('/products')
              ? [mockProduct]
              : path.endsWith('/brands')
                ? [{ id: 'b', name: 'McCain' }]
                : path.endsWith('/categories')
                  ? [{ id: 'c', name: 'Frozen Foods' }]
                  : [];
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
});
afterEach(async () => {
  await act(async () => root.unmount());
});
after(() => {
  dom.window.close();
});
const click = async (element: Element) => {
  await act(async () => {
    element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  });
};

test('scroll reveal survives React StrictMode and activates at the viewport', async () => {
  function Example() {
    useSiteMotion([]);
    return React.createElement('div', { className: 'section-heading' }, 'Reveal me');
  }
  await act(async () =>
    root.render(React.createElement(React.StrictMode, null, React.createElement(Example))),
  );
  const element = document.querySelector('.section-heading')!;
  assert.ok(element.classList.contains('scroll-reveal'));
  assert.equal(element.classList.contains('in-view'), false);
  const observer = [...observers].reverse().find((o) => o.elements.has(element));
  assert.ok(observer, 'StrictMode must leave a live observer');
  await act(async () => observer.callback([{ isIntersecting: true, target: element }]));
  assert.ok(element.classList.contains('in-view'));
  assert.equal(observer.elements.has(element), false);
});
test('reduced motion leaves content visible without scroll observers', async () => {
  reduced = true;
  function Example() {
    useSiteMotion([]);
    return React.createElement('div', { className: 'section-heading' }, 'Always visible');
  }
  await act(async () => root.render(React.createElement(Example)));
  assert.equal(
    document.querySelector('.section-heading')!.classList.contains('scroll-reveal'),
    false,
  );
  assert.equal(observers.length, 0);
});
test('catalogue opens details and adds the minimum quantity to the enquiry basket', async () => {
  await act(async () => root.render(React.createElement(PublicSite)));
  await click(document.querySelector('[aria-label="View French Fries"]')!);
  assert.ok(document.querySelector('dialog[open]'));
  const add = Array.from(document.querySelectorAll('button')).find((b) =>
    b.textContent?.includes('Add to wholesale enquiry'),
  )!;
  await click(add);
  const qty = document.querySelector<HTMLInputElement>('[aria-label="Quantity of French Fries"]');
  assert.ok(qty);
  assert.equal(qty.value, '4');
  await click(document.querySelector('[aria-label="Increase French Fries"]')!);
  assert.equal(qty.value, '5');
  await click(document.querySelector('[aria-label="Remove French Fries"]')!);
  assert.ok(document.body.textContent?.includes('Your enquiry is empty'));
});
test('owner navigation opens the product editor with complete saved fields', async () => {
  dom.window.history.replaceState({}, '', '/admin');
  await act(async () => root.render(React.createElement(Admin)));
  const products = Array.from(document.querySelectorAll('.admin-sidebar nav button')).find(
    (b) => b.textContent === 'Products',
  )!;
  await click(products);
  assert.ok(document.body.textContent?.includes('French Fries'));
  await click(document.querySelector('[aria-label="Open French Fries"]')!);
  const labels = Array.from(document.querySelectorAll('dialog label')).map((l) => l.textContent);
  assert.ok(labels.some((l) => l?.includes('Product name')));
  assert.ok(labels.some((l) => l?.includes('HSN code')));
  assert.ok(labels.some((l) => l?.includes('Minimum packs')));
  assert.ok(document.querySelector('input[type="file"]'));
});

test('sidebar displays section counts and clears them after notifications are read', async () => {
  const fallback = globalThis.fetch;
  let read = false;
  globalThis.fetch = (async (input: any, init: any) => {
    if (String(input).startsWith('/api/admin/notifications')) {
      if (String(input).endsWith('/read')) read = true;
      return new Response(
        JSON.stringify({
          cursor: '45',
          notifications: [],
          events: [],
          changed: false,
          unread: read ? 0 : 45,
          sections: read ? {} : { enquiries: 42, orders: 3 },
        }),
      );
    }
    return fallback(input, init);
  }) as typeof fetch;
  dom.window.history.replaceState({}, '', '/admin');
  await act(async () => root.render(React.createElement(Admin)));
  const badges = [...document.querySelectorAll('.section-unread')];
  assert.deepEqual(badges.map((b) => b.textContent).sort(), ['3', '42']);
  assert.ok(
    badges.find((b) => b.textContent === '42')?.parentElement?.textContent?.includes('Enquiries'),
  );
  await click(document.querySelector('[aria-label="Notifications, 45 unread"]')!);
  await click(
    [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Mark all read'))!,
  );
  assert.equal(document.querySelectorAll('.section-unread').length, 0);
});

test('live notifications display incoming updates and persist mark-read without login', async () => {
  let revision = 0,
    updates = 0,
    reads = 0;
  const user = { id: 'owner', name: 'Owner', email: 'owner@test.example', role: 'Owner' as const };
  globalThis.fetch = (async (input: any) => {
    if (String(input).endsWith('/read')) {
      reads++;
      return new Response('{}');
    }
    return new Response(
      JSON.stringify({
        cursor: String(revision),
        user,
        unread: revision && !reads ? 1 : 0,
        changed: revision === 1 && !reads,
        events:
          revision === 1 && !reads
            ? [
                {
                  id: '1',
                  entity: 'enquiries',
                  recordId: 'e',
                  message: 'New enquiry received',
                  actorId: null,
                },
              ]
            : [],
        notifications: revision
          ? [
              {
                id: '1',
                entity: 'enquiries',
                recordId: 'e',
                message: 'New enquiry received',
                createdAt: new Date().toISOString(),
                unread: !reads,
              },
            ]
          : [],
      }),
    );
  }) as typeof fetch;
  await act(async () =>
    root.render(
      React.createElement(Notifications, {
        user,
        onUpdate: () => updates++,
        onNavigate() {},
        onUser() {},
        onExpired() {
          assert.fail('must stay signed in');
        },
      }),
    ),
  );
  revision = 1;
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  await act(async () => {
    window.dispatchEvent(new dom.window.Event('focus'));
  });
  assert.equal(updates, 1);
  assert.ok(document.querySelector('.live-toast')?.textContent?.includes('New enquiry received'));
  await click(document.querySelector('[aria-label="Notifications, 1 unread"]')!);
  const read = [...document.querySelectorAll('button')].find((b) =>
    b.textContent?.includes('Mark all read'),
  )!;
  await click(read);
  assert.equal(reads, 1);
  assert.ok(document.querySelector('[aria-label="Notifications"]'));
});
