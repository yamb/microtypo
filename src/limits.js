export function failure(code, message, cause) {
  return Object.assign(new Error(message, cause === undefined ? undefined : { cause }), { code });
}

export function input(condition, message) {
  if (!condition) {
    throw failure('YAMB_CONTENT_INPUT', message);
  }
}

export function string(value, field) {
  const limit = 5000000;
  input(typeof value === 'string', `${field} must be a string`);

  if (value.length > limit) {
    throw Object.assign(failure('YAMB_CONTENT_LIMIT', `${field} exceeds ${limit} UTF-16 units`), {
      field
    });
  }

  return value;
}
