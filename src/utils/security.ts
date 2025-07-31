// src/utils/security.ts
import DOMPurify from 'dompurify';

const purify = DOMPurify(window);

purify.addHook('beforeSanitizeElements', (node: Node) => {
  if (node instanceof Element) {
    const tag = node.tagName.toLowerCase();
    if (
      tag === 'script' ||
      tag === 'iframe' ||
      node.hasAttribute('onerror') ||
      node.hasAttribute('onclick') ||
      node.hasAttribute('onload')
    ) {
      return null;
    }
  }
  return node;
});

const policyName = 'weedlend-policy';
let sanitizePolicy: TrustedTypePolicy | undefined;

if (window.trustedTypes?.createPolicy) {
  try {
    sanitizePolicy = window.trustedTypes.createPolicy(policyName, {
      createHTML: (input: string) =>
        purify.sanitize(input, { RETURN_TRUSTED_TYPE: false }) as string,
      createScript: () => {
        throw new Error('Scripts are not allowed');
      },
      createScriptURL: () => {
        throw new Error('Script URLs are not allowed');
      },
    });
  } catch (error) {
    console.warn('Trusted Types not supported or policy creation failed:', error);
  }
}

export function sanitizeHTML(html: string): string {
  try {
    const config = {
      ALLOWED_TAGS: [
        'span', 'p', 'div', 'b', 'i', 'strong', 'em', 'ul', 'li', 'a', 'img',
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      ],
      ALLOWED_ATTR: [
        'class', 'aria-label', 'aria-hidden', 'href', 'src', 'alt', 'title', 'style',
      ],
      FORBID_TAGS: ['script', 'iframe', 'object', 'embed'],
      FORBID_ATTR: ['onerror', 'onclick', 'onload', 'onchange', 'onmouseover', 'onmouseout', 'onfocus', 'onblur'],
      ALLOWED_URI_REGEXP: /^(?:https?:\/\/|data:image\/)/,
      RETURN_TRUSTED_TYPE: false,
    };

    const sanitized = purify.sanitize(html, config) as string;
    // Convert TrustedHTML to string if Trusted Types policy is active
    return sanitizePolicy ? String(sanitizePolicy.createHTML(sanitized)) : sanitized;
  } catch (error) {
    console.error('Sanitization failed:', error);
    return '';
  }
}