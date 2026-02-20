const PURPLE = "\x1b[38;5;99m";
const INDIGO = "\x1b[38;5;63m";
const VIOLET = "\x1b[38;5;135m";
const LAVENDER = "\x1b[38;5;183m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

// Import version from package.json
import pkg from "../package.json" with { type: "json" };

export const BANNER = `
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

export const VERSION = pkg.version;

export function printBanner() {
  console.log(BANNER);
}

export function printVersion() {
  console.log(`${INDIGO}rax${RESET} ${DIM}v${VERSION}${RESET}`);
}
