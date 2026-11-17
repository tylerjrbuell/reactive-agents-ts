import { writable } from "svelte/store";
import type { RunStopKind } from "../run-stop.js";

/**
 * The stop kind of the Continue card currently offered under the chat thread, `undefined`
 * when none is. `ChatContinueCard` owns the lookup and publishes it here so the latest
 * reply can drop its generic ending note and show one card per stop
 * (`endingSupersededByContinue`, `lib/loop-stop-resume.ts`).
 */
export const continueOffer = writable<RunStopKind | undefined>(undefined);
