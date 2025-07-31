import createDOMPurify from 'dompurify';
import type { DOMPurify as DOMPurifyType } from 'dompurify';
import { JSDOM } from 'jsdom';

const window = new JSDOM('').window as unknown as Window & typeof globalThis;
const DOMPurify: DOMPurifyType = createDOMPurify(window);

DOMPurify.addHook('beforeSanitizeElements', (node: Node) => {
  if (node.nodeType === 1) {
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (
      tag === 'script' ||
      tag === 'iframe' ||
      el.hasAttribute('onerror') ||
      el.hasAttribute('onclick') ||
      el.hasAttribute('onload')
    ) {
      return null;
    }
  }
  return node;
});

export function sanitizeHTML(html: string): string {
  try {
    return DOMPurify.sanitize(html, {
      ALLOWED_TAGS: [
        'span', 'p', 'div', 'b', 'i', 'strong', 'em', 'ul', 'li', 'a', 'img',
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      ],
      ALLOWED_ATTR: [
        'class', 'aria-label', 'aria-hidden', 'href', 'src', 'alt', 'title', 'style',
      ],
      FORBID_TAGS: ['script', 'iframe', 'object', 'embed'],
      FORBID_ATTR: [
        'onerror', 'onclick', 'onload', 'onchange',
        'onmouseover', 'onmouseout', 'onfocus', 'onblur',
      ],
      ALLOWED_URI_REGEXP: /^(?:https?:\/\/|data:image\/)/,
    });
  } catch (error) {
    console.error('Sanitization failed:', error);
    return '';
  }
}