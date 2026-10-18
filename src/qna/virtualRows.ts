export function virtualRowWindow(count: number, scrollTop: number, height: number) {
 const visible = Math.max(1, Math.ceil(Math.max(0, height) / 36));
 const start = Math.max(0, Math.min(Math.floor(Math.max(0, scrollTop) / 36) - 8, Math.max(0, count - visible - 8)));
 const end = Math.min(count, start + visible + 16);
 return {start, end, before: start * 36, after: (count - end) * 36};
}
