import { describe, expect, it } from "bun:test";
import { replaceDraft, restoreDraft } from "./chat-draft.js";

describe("replaceDraft", () => {
  it("sets the text with nothing stashed when the composer is empty", () => {
    expect(replaceDraft("", "/docs add ")).toEqual({ message: "/docs add ", stash: null });
  });
  it("treats a whitespace-only composer as empty", () => {
    expect(replaceDraft("   \n", "Hello")).toEqual({ message: "Hello", stash: null });
  });
  it("stashes a non-empty draft it replaces", () => {
    expect(replaceDraft("half written thought", "Starter prompt")).toEqual({
      message: "Starter prompt",
      stash: "half written thought",
    });
  });
  it("does not stash a command the user is completing (typed prefix)", () => {
    expect(replaceDraft("/co", "/compact")).toEqual({ message: "/compact", stash: null });
    expect(replaceDraft("/", "/")).toEqual({ message: "/", stash: null });
  });
  it("does not stash the chip command the quickbar inserted", () => {
    expect(replaceDraft("/docs", "/docs add ", "/docs")).toEqual({ message: "/docs add ", stash: null });
    expect(replaceDraft("/docs ", "/docs add ", "/docs")).toEqual({ message: "/docs add ", stash: null });
  });
  it("still stashes the user's draft when a chip command is not what the composer holds", () => {
    expect(replaceDraft("my draft", "/docs add ", "/docs")).toEqual({ message: "/docs add ", stash: "my draft" });
  });
});

describe("restoreDraft (a swap)", () => {
  it("puts the stash back and stashes the replacement it displaces", () => {
    expect(restoreDraft("Starter prompt", "my draft")).toEqual({ message: "my draft", stash: "Starter prompt" });
  });
  it("puts the stash back with nothing to stash when the composer is empty", () => {
    expect(restoreDraft("  ", "my draft")).toEqual({ message: "my draft", stash: null });
  });
  it("keeps the rewound message (edited or not) as the new stash: Edit, then Restore, loses nothing", () => {
    // Observed live 2026-11-10: Edit (rewind) put the old message in the composer and stashed the draft;
    // Restore used to replace the composer with the draft and the rewound text was gone.
    const edit = replaceDraft("my draft", "old message to rerun");
    expect(edit).toEqual({ message: "old message to rerun", stash: "my draft" });
    const restored = restoreDraft("old message to rerun, edited", edit.stash!);
    expect(restored).toEqual({ message: "my draft", stash: "old message to rerun, edited" });
    // Restoring again swaps back.
    expect(restoreDraft(restored.message, restored.stash!)).toEqual({ message: "old message to rerun, edited", stash: "my draft" });
  });
  it("stashes nothing when the composer already holds the stash", () => {
    expect(restoreDraft("my draft", "my draft")).toEqual({ message: "my draft", stash: null });
  });
});
