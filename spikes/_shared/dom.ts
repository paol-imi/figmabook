/** UI-iframe helpers: copying text and downloading files without extra permissions. */

/**
 * Copies text through a temporary text area and `execCommand('copy')`, which works inside
 * Figma's plugin iframe where `navigator.clipboard` is usually blocked. Returns success.
 */
export function copyText(doc: Document, text: string): boolean {
  const area = doc.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  doc.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = doc.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}

/** Starts a file download from the iframe with an `<a download>` click. Returns whether it was attempted. */
export function downloadFile(doc: Document, name: string, data: BlobPart, type = 'application/json'): boolean {
  const view = doc.defaultView;
  if (!view || typeof view.URL?.createObjectURL !== 'function') return false;
  const url = view.URL.createObjectURL(new Blob([data], { type }));
  const link = doc.createElement('a');
  link.href = url;
  link.download = name;
  link.style.display = 'none';
  doc.body.appendChild(link);
  link.click();
  link.remove();
  view.setTimeout(() => view.URL.revokeObjectURL(url), 10_000);
  return true;
}
