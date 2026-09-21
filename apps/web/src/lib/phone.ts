export function formatPhone(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.startsWith("996") && d.length === 12) {
    return `+996 ${d.slice(3, 6)} ${d.slice(6, 9)} ${d.slice(9)}`;
  }
  if (d.startsWith("7") && d.length === 11) {
    return `+7 ${d.slice(1, 4)} ${d.slice(4, 7)} ${d.slice(7, 9)} ${d.slice(9)}`;
  }
  return phone;
}
