/** Phase Z: the shape set. Five failure situations, eight variants (shape 1 has three, shape 2 two). */
import type { Shape } from "../shape.js";
import { fabricationVeto } from "./fabrication-veto.js";
import { honestDecline } from "./honest-decline.js";
import { honestDeclineAfterOne } from "./honest-decline-after-1.js";
import { iterationCap } from "./iteration-cap.js";
import { noCallStall } from "./no-call-stall.js";
import { pendingWrite, pendingWriteStubbornCap14, pendingWriteStubbornCap16 } from "./pending-write.js";
import { unreadInputAbspath, unreadInputFilename, unreadInputProse } from "./unread-input.js";

export const SHAPES: readonly Shape[] = [
  unreadInputProse,
  unreadInputFilename,
  unreadInputAbspath,
  honestDecline,
  honestDeclineAfterOne,
  noCallStall,
  fabricationVeto,
  iterationCap,
  pendingWrite,
  pendingWriteStubbornCap14,
  pendingWriteStubbornCap16,
];

/** Look a shape up by id; `undefined` when unknown. */
export function findShape(id: string): Shape | undefined {
  return SHAPES.find((s) => s.id === id);
}

export {
  fabricationVeto,
  honestDecline,
  honestDeclineAfterOne,
  iterationCap,
  noCallStall,
  pendingWrite,
  pendingWriteStubbornCap14,
  pendingWriteStubbornCap16,
  unreadInputAbspath,
  unreadInputFilename,
  unreadInputProse,
};
