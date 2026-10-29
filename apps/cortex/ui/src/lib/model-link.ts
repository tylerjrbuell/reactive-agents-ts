/** Cortex route for a provider/model page. Model ids may hold ':' and '/', so each segment is encoded on its own. */
export function modelHref(provider: string, model: string): string {
  const segs = model.split("/").map(encodeURIComponent).join("/");
  return `/models/${encodeURIComponent(provider)}/${segs}`;
}

/** Route for a provider alone (shows its model list). */
export function providerHref(provider: string): string {
  return `/models/${encodeURIComponent(provider)}`;
}
