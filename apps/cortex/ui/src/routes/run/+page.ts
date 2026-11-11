import { redirect } from "@sveltejs/kit";

/** `/run` has no page of its own: it redirects to the Runs list (Bench spec section 8). */
export function load(): never {
  redirect(307, "/runs");
}
