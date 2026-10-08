// Nomor WhatsApp jadi kunci kontak. Semua nomor disimpan sebagai digit dengan kode negara, mis. 6281233449021.
export function normalizePhone(input: string): string | null {
  let d = (input || '').replace(/[^0-9+]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  d = d.replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0')) d = '62' + d.slice(1);
  else if (d.startsWith('8')) d = '62' + d;
  if (d.length < 9 || d.length > 15) return null;
  return d;
}

export function formatPhone(d: string): string {
  if (!d) return '';
  if (d.startsWith('62')) {
    const rest = d.slice(2);
    if (rest.startsWith('8')) return `+62 ${rest.slice(0, 3)}-${rest.slice(3, 7)}-${rest.slice(7)}`;
    return `+62 ${rest.slice(0, 3)}-${rest.slice(3, 6)}-${rest.slice(6)}`;
  }
  return '+' + d;
}

// Untuk dikirim ke AI: sembunyikan nomor HP & email.
export function maskPii(text: string): string {
  return text
    .replace(/(\+?62|0)8[0-9\s\-]{7,14}/g, '[nomor disembunyikan]')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email disembunyikan]')
    .replace(/\b(jl\.?|jln\.?|jalan|gg\.?|gang|perum(ahan)?)\s+[^,.\n]{2,60}?(no\.?\s*\d+[a-z]?)?(?=[,.\n]|$)/gi, '[alamat disembunyikan]');
}
