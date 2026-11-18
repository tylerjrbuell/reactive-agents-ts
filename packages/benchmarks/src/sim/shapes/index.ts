/** Phase Z: the shape set. Five failure situations, six variants (shape 1 has two). */
import type { Shape } from "../shape.js";
import { fabricationVeto } from "./fabrication-veto.js";
import { honestDecline } from "./honest-decline.js";
import { iterationCap } from "./iteration-cap.js";
import { noCallStall } from "./no-call-stall.js";
import { unreadInputFilename, unreadInputProse } from "./unread-input.js";

export const SHAPES: readonly Shape[] = [
  unreadInputProse,
  unreadInputFilename,
  honestDecline,
  noCallStall,
  fabricationVeto,
  iterationCap,
];

/** Look a shape up by id; `undefined` when unknown. */
export function findShape(id: string): Shape | undefined {
  return SHAPES.find((s) => s.id === id);
}

export { fabricationVeto, honestDecline, iterationCap, noCallStall, unreadInputFilename, unreadInputProse };
