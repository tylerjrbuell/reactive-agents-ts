/**
 * Svelte action: focus the element when it mounts. For inputs that appear
 * because the user asked for them (an inline rename), where the `autofocus`
 * attribute would also fire on page load and trips `a11y_autofocus`.
 */
export function focusOnMount(node: HTMLElement): void {
  node.focus();
}
