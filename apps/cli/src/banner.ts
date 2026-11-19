// Import version from package.json
import pkg from "../package.json" with { type: "json" };
import { colorEnabled } from "./ui.js";

/** ANSI codes for the banner, or empty strings when color is off (NO_COLOR, non-TTY). */
function palette(color: boolean) {
  const c = (code: string): string => (color ? code : "");
  return {
    PURPLE: c("\x1b[38;5;99m"),
    INDIGO: c("\x1b[38;5;63m"),
    VIOLET: c("\x1b[38;5;135m"),
    LAVENDER: c("\x1b[38;5;183m"),
    DIM: c("\x1b[2m"),
    RESET: c("\x1b[0m"),
    BOLD: c("\x1b[1m"),
  };
}

/** The `rax` banner; plain text when `color` is false. */
export function renderBanner(color: boolean = colorEnabled()): string {
  const { PURPLE, INDIGO, VIOLET, LAVENDER, DIM, RESET, BOLD } = palette(color);
  return `
${PURPLE}  ╔══════════════════════════════════════════╗${RESET}
${PURPLE}  ║${RESET}                                          ${PURPLE}║${RESET}
${PURPLE}  ║${RESET}       ${INDIGO}┏━┓  ${VIOLET}┏━┓${RESET}   ${LAVENDER}┏━┓  ╻${RESET}                  ${PURPLE}║${RESET}
${PURPLE}  ║${RESET}       ${INDIGO}┣┳┛  ${VIOLET}┣━┫${RESET}   ${LAVENDER}┏╋┛┏╋┛${RESET}                  ${PURPLE}║${RESET}
${PURPLE}  ║${RESET}       ${INDIGO}╹┗╸  ${VIOLET}╹ ╹${RESET}   ${LAVENDER}╹   ╹ ${RESET}                  ${PURPLE}║${RESET}
${PURPLE}  ║${RESET}                                          ${PURPLE}║${RESET}
${PURPLE}  ║${RESET}   ${BOLD}${INDIGO}R${VIOLET}eactive ${INDIGO}A${VIOLET}gents e${INDIGO}X${VIOLET}ecutable${RESET}             ${PURPLE}║${RESET}
${PURPLE}  ║${RESET}   ${DIM}Type-safe AI agents on Effect-TS${RESET}       ${PURPLE}║${RESET}
${PURPLE}  ║${RESET}                                          ${PURPLE}║${RESET}
${PURPLE}  ╚══════════════════════════════════════════╝${RESET}
`;
}

export const VERSION = pkg.version;

export function printBanner() {
  console.log(renderBanner());
}

export function printVersion() {
  const { INDIGO, DIM, RESET } = palette(colorEnabled());
  console.log(`${INDIGO}rax${RESET} ${DIM}v${VERSION}${RESET}`);
}
