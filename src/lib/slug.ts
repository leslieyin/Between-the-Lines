/** 分享短链的 slug：URL 安全、不可猜、不需要依赖 nanoid。 */

const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz"; // 去掉 0/1/l/o 这类易混字符

/**
 * 8 字节 → base32 字母表 → 12 位。约 60 bit 熵。
 * 分享链接是「有链接就能看」的模型，所以熵要够高，不能让人枚举出来别人的对话。
 */
export function makeShareSlug(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) {
    out += ALPHABET[byte % ALPHABET.length]!;
    out += ALPHABET[(byte >> 3) % ALPHABET.length]!;
  }
  return out.slice(0, 12);
}

export function isValidSlug(value: string): boolean {
  return /^[23456789abcdefghjkmnpqrstuvwxyz]{12}$/.test(value);
}
