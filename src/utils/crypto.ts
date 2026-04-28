export function validateBase64Key(key: string, context: string): Buffer {
  const trimmed = key.replace(/\s/g, '');
  if (trimmed.length < 44) {
    throw new Error(`${context} is too short - must be a base64 string encoding exactly 32 bytes`);
  }
  const buf = Buffer.from(trimmed, 'base64');
  if (buf.length !== 32) {
    throw new Error(`${context} does not decode to 32 bytes (got ${buf.length})`);
  }
  return buf;
}
