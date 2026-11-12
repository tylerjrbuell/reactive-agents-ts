import { describe, expect, test } from "bun:test";
import { get } from "svelte/store";
import { createAttachController, keepThumbs, thumbOf } from "./composer-attachments.js";

const make = (caps: Parameters<typeof createAttachController>[0]["caps"] = () => undefined) => {
  const refused: string[] = [];
  const c = createAttachController({ caps, model: () => "m", refuse: (_t, msg) => refused.push(msg) });
  return { c, refused };
};

describe("attach controller", () => {
  test("a picture becomes a chip with base64 bytes and a thumbnail; take empties the composer", async () => {
    const { c } = make();
    await c.addFiles([new File([new Uint8Array([1, 2, 3])], "p.png", { type: "image/png" })]);
    const [item] = get(c.items);
    expect(item).toMatchObject({ kind: "image", name: "p.png", bytes: 3, dataBase64: "AQID", mediaType: "image/png" });
    expect(item?.thumb).toBe("data:image/png;base64,AQID");
    expect(c.take()).toHaveLength(1);
    expect(get(c.items)).toEqual([]);
  });

  test("a kind the model cannot take is refused with the reason and not added", async () => {
    const { c, refused } = make(() => ({ vision: false, authoritative: true }));
    await c.addFiles([new File(["x"], "p.png", { type: "image/png" }), new File(["hello"], "n.txt", { type: "text/plain" })]);
    expect(get(c.items).map((i) => i.name)).toEqual(["n.txt"]);
    expect(refused).toHaveLength(1);
    expect(refused[0]).toContain("m does not accept pictures");
  });

  test("a file the browser cannot read is refused once, adds nothing, and later files still attach", async () => {
    const { c, refused } = make();
    const gone = new File(["x"], "shot.png", { type: "image/png" });
    gone.arrayBuffer = () => Promise.reject(new DOMException("A requested file or directory could not be found", "NotFoundError"));
    const ok = new File(["hello"], "n.txt", { type: "text/plain" });
    await c.addFiles([gone, ok]);
    expect(refused).toEqual(["shot.png could not be read (the file may have moved or be unreadable)"]);
    expect(get(c.items).map((i) => i.name)).toEqual(["n.txt"]);
  });

  test("tag, remove, clear", () => {
    const { c } = make();
    c.addWorkspaceFile({ path: "src/a.ts", bytes: 9 });
    c.addWorkspaceFile({ path: "src/a.ts", bytes: 9 });
    expect(get(c.items)).toHaveLength(1);
    c.remove(get(c.items)[0]!.id);
    expect(get(c.items)).toEqual([]);
    c.addWorkspaceFile({ path: "b.ts", bytes: 1 });
    c.clear();
    expect(get(c.items)).toEqual([]);
  });

  test("sent thumbnails are kept for the page session by name and size", () => {
    keepThumbs([{ id: "1", kind: "image", name: "t.png", bytes: 4, thumb: "data:image/png;base64,AA==" }]);
    expect(thumbOf("t.png", 4)).toBe("data:image/png;base64,AA==");
    expect(thumbOf("t.png", 5)).toBeUndefined();
  });
});
