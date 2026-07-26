const ORDER_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ORDER_CODE_LENGTH = 8;

export function generateOrderCode(length = ORDER_CODE_LENGTH): string {
  let code = '';

  for (let index = 0; index < length; index += 1) {
    const characterIndex = Math.floor(Math.random() * ORDER_CODE_ALPHABET.length);
    code += ORDER_CODE_ALPHABET[characterIndex];
  }

  return code;
}
