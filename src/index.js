import { MicroTypo, VERSION } from 'microtypo';

import pkg from '../package.json' with { type: 'json' };
import { execution } from './execution.js';
import { input, LIMIT, string } from './limits.js';

function settings(options) {
  input(options && Object.getPrototypeOf(options) === Object.prototype, 'Expected native options');

  for (const key of Reflect.ownKeys(options)) {
    input(key === 'presets' || key === 'rules', `Unsupported MicroTypo option: ${String(key)}`);
  }

  const config = {
    ...structuredClone(options),
    input: 'html',
    html: false,
    entities: false,
    maxInputLength: LIMIT,
    maxProcessingMs: 10000
  };
  void new MicroTypo(config);

  return config;
}

function html(value, field) {
  input(value && typeof value === 'object', `${field} must contain HTML`);
  input(
    !('tree' in value || 'plain' in value || 'feedHtml' in value),
    `${field} must contain HTML before cleanup`
  );

  return string(value.html, `${field}.html`);
}

function fields(post) {
  input(post && typeof post === 'object' && !Array.isArray(post), 'Expected HtmlPost');
  input(
    post.cover && typeof post.cover === 'object' && !Array.isArray(post.cover),
    'Expected cover'
  );

  const result = {
    title: string(post.title, 'title'),
    text: html(post.text, 'text')
  };

  if (post.preview !== undefined) {
    result.preview = html(post.preview, 'preview');
  }

  if (post.cover.alt !== undefined) {
    result.alt = string(post.cover.alt, 'alt');
  }

  if (post.cover.caption !== undefined) {
    result.caption = string(post.cover.caption, 'caption');
  }

  return result;
}

export function microtypo(options = {}) {
  const owner = execution(settings(options));

  return {
    name: 'microtypo',
    version: `${pkg.version}/microtypo-${VERSION}`,
    close: owner.close,
    [Symbol.asyncDispose]: owner.close,

    async transform(value, ctx = {}) {
      const payload = fields(value);
      const result = {
        ...value,
        text: { ...value.text },
        cover: { ...value.cover }
      };

      if (payload.preview !== undefined) {
        result.preview = { ...value.preview };
      }

      const { title, text, preview, ...cover } = await owner.run(payload, ctx);
      result.title = title;
      result.text.html = text;

      if (payload.preview !== undefined) {
        result.preview.html = preview;
      }

      Object.assign(result.cover, cover);

      return result;
    }
  };
}
