import { describe, expect, test } from "bun:test";
import {
  escapeMarkdownV2,
  isEntityParseFailure,
  mapTelegramFailure,
  parseTelegramFailure,
  parseTelegramUpdate,
  redactToken,
  splitTelegramText,
  toMarkdownV2,
} from "../src/adapters/telegram-protocol.js";

const SELF = { id: 99, username: "RaBot" };
const never = () => false;
const SPECIALS = "_*[]()~`>#+-=|{}.!\\";

/** Deterministic PRNG so a fuzz failure reproduces. */
const rng = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
};

const randomText = (next: () => number, alphabet: readonly string[], length: number): string =>
  Array.from({ length }, () => alphabet[Math.floor(next() * alphabet.length)] ?? "").join("");

describe("escapeMarkdownV2", () => {
  test("fuzz: every special character is escaped and unescaping restores the input", () => {
    const next = rng(7);
    const alphabet = [...SPECIALS, "a", "Z", "9", " ", "\n", "é", "漢", "😀", "\\\\"];
    for (let i = 0; i < 300; i++) {
      const input = randomText(next, alphabet, 1 + Math.floor(next() * 60));
      const escaped = escapeMarkdownV2(input);
      // Every special is preceded by an odd run of backslashes, i.e. it is itself escaped.
      for (let j = 0; j < escaped.length; j++) {
        if (!SPECIALS.includes(escaped[j] ?? "") || escaped[j] === "\\") continue;
        let run = 0;
        while (escaped[j - 1 - run] === "\\") run++;
        expect(run % 2).toBe(1);
      }
      expect(escaped.replace(/\\([_*[\]()~`>#+\-=|{}.!\\])/g, "$1")).toBe(input);
    }
  });
});

/** A coarse MarkdownV2 validity check: nothing special is left bare outside code, links and escapes. */
const looksValidMarkdownV2 = (out: string): boolean => {
  const counts: Record<string, number> = { "*": 0, _: 0, "~": 0 };
  let i = 0;
  while (i < out.length) {
    const c = out[i] ?? "";
    if (c === "\\") {
      i += 2;
    } else if (out.startsWith("```", i)) {
      const close = out.indexOf("```", i + 3);
      if (close < 0) return false;
      i = close + 3;
    } else if (c === "`") {
      let j = i + 1;
      while (j < out.length && out[j] !== "`") j += out[j] === "\\" ? 2 : 1;
      if (j >= out.length) return false;
      i = j + 1;
    } else if (c === "[") {
      const m = /^\[[^\]]*\]\((?:\\[\s\S]|[^)\\])*\)/.exec(out.slice(i));
      if (!m) return false;
      i += m[0].length;
    } else if (".!-+=#>|{}()[]".includes(c)) {
      return false;
    } else {
      if (c in counts) counts[c] = (counts[c] ?? 0) + 1;
      i++;
    }
  }
  return Object.values(counts).every((n) => n % 2 === 0);
};

describe("toMarkdownV2", () => {
  test("converts bold, italic, strike, links, headings and code; escapes the rest", () => {
    expect(toMarkdownV2("**bold** and _it_ and ~~gone~~")).toBe("*bold* and _it_ and ~gone~");
    expect(toMarkdownV2("[docs](https://x.test/a_(b))")).toBe("[docs](https://x.test/a_(b\\))");
    expect(toMarkdownV2("# Title.")).toBe("*Title\\.*");
    expect(toMarkdownV2("use `a.b()` now.")).toBe("use `a.b()` now\\.");
    expect(toMarkdownV2("```ts\nconst a = 1; // x_y.\n```")).toBe("```ts\nconst a = 1; // x_y.\n```");
  });

  test("snake_case, stray markers, lists and punctuation are escaped, not interpreted", () => {
    expect(toMarkdownV2("snake_case_name")).toBe("snake\\_case\\_name");
    expect(toMarkdownV2("2 * 3 = 6")).toBe("2 \\* 3 \\= 6");
    expect(toMarkdownV2("- item (a)\n1. two!")).toBe("\\- item \\(a\\)\n1\\. two\\!");
  });

  test("code spans only escape backtick and backslash", () => {
    expect(toMarkdownV2("`a\\b`")).toBe("`a\\\\b`");
  });

  test("fuzz: markdown-ish input always yields output Telegram can parse", () => {
    const next = rng(42);
    const alphabet = ["**", "*", "_", "~~", "`", "```", "[", "]", "(", ")", "#", "-", ".", "!", "\n", " ", "a", "b_c", "https://x.test", "\\", "é"];
    for (let i = 0; i < 400; i++) {
      const input = randomText(next, alphabet, 1 + Math.floor(next() * 40));
      const out = toMarkdownV2(input);
      expect({ input, out, valid: looksValidMarkdownV2(out) }).toEqual({ input, out, valid: true });
    }
  });
});

describe("splitTelegramText", () => {
  const wellFormed = (s: string) => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);

  test("short text is one message", () => {
    expect(splitTelegramText("hi")).toEqual(["hi"]);
  });

  test("every part is within the limit and no content is lost (long unbroken text)", () => {
    const text = "x".repeat(10_000);
    const parts = splitTelegramText(text, 4096);
    expect(parts.every((p) => p.length <= 4096)).toBe(true);
    expect(parts.join("")).toBe(text);
  });

  test("never splits a surrogate pair, even on a hard cut through emoji", () => {
    const text = "😀".repeat(5000);
    const parts = splitTelegramText(text, 4095);
    expect(parts.every((p) => p.length <= 4095 && wellFormed(p))).toBe(true);
    expect(parts.join("")).toBe(text);
  });

  test("never splits a grapheme cluster (ZWJ family emoji) on a hard cut", () => {
    const family = "👨‍👩‍👧";
    const text = family.repeat(1000);
    for (const part of splitTelegramText(text, 4096)) expect(part.length % family.length).toBe(0);
  });

  test("prefers paragraph, then line, then word boundaries", () => {
    const text = `${"a".repeat(3000)}\n\n${"b".repeat(3000)}`;
    expect(splitTelegramText(text, 4096)).toEqual(["a".repeat(3000), "b".repeat(3000)]);
    const words = `${"w ".repeat(2500)}end`;
    const parts = splitTelegramText(words, 4096);
    expect(parts.every((p) => p.length <= 4096 && !p.startsWith(" ") && !p.endsWith("  "))).toBe(true);
    expect(parts.join(" ").replace(/\s+/g, " ")).toBe(words.replace(/\s+/g, " "));
  });

  test("a code fence open at a cut is closed and reopened", () => {
    const text = `\`\`\`\n${"line\n".repeat(1500)}\`\`\``;
    const parts = splitTelegramText(text, 4096);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) {
      expect(p.length).toBeLessThanOrEqual(4096);
      expect((p.match(/```/g) ?? []).length % 2).toBe(0);
    }
  });
});

describe("mapTelegramFailure", () => {
  const map = (status: number, body: unknown) =>
    mapTelegramFailure("tg", parseTelegramFailure(status, body), (t) => redactToken(t, "1:secret"));
  const body = (code: number, description: string, parameters?: unknown) => ({
    ok: false,
    error_code: code,
    description,
    ...(parameters ? { parameters } : {}),
  });

  test("maps Telegram codes to typed kinds", () => {
    expect(map(401, body(401, "Unauthorized")).kind).toBe("auth");
    expect(map(403, body(403, "Forbidden: bot was blocked by the user")).kind).toBe("forbidden");
    expect(map(403, body(403, "Forbidden: bot was kicked from the group chat")).kind).toBe("forbidden");
    expect(map(404, body(404, "Not Found")).kind).toBe("not_found");
    expect(map(400, body(400, "Bad Request: chat not found")).kind).toBe("not_found");
    expect(map(400, body(400, "Bad Request: message is too long")).kind).toBe("too_large");
    expect(map(413, body(413, "Request Entity Too Large")).kind).toBe("too_large");
    expect(map(502, body(502, "Bad Gateway")).kind).toBe("network");
    expect(map(400, body(400, "Bad Request: wrong file_id")).kind).toBe("unknown");
  });

  test("429 carries retry_after as retryAfterMs and is retryable", () => {
    const error = map(429, body(429, "Too Many Requests: retry after 7", { retry_after: 7 }));
    expect(error.kind).toBe("rate_limited");
    expect(error.retryable).toBe(true);
    expect(error.retryAfterMs).toBe(7000);
  });

  test("409 is non-retryable with an explicit message", () => {
    const error = map(409, body(409, "Conflict: terminated by other getUpdates request"));
    expect(error.retryable).toBe(false);
    expect(error.message).toContain("409");
    expect(error.message).toContain("getUpdates");
  });

  test("the token is scrubbed from the retained description and never in the message", () => {
    const error = map(401, body(401, "Unauthorized for https://api.telegram.org/bot1:secret/getMe"));
    expect(JSON.stringify(error.cause)).not.toContain("1:secret");
    expect(error.message).not.toContain("secret");
    expect(redactToken("bot123456:AAFakeBotTokenForTestsOnly_abcdef123 x", "")).not.toContain("AAFake");
  });

  test("an entity parse failure is recognised so the adapter can retry as plain text", () => {
    expect(isEntityParseFailure(map(400, body(400, "Bad Request: can't parse entities: Character '.' must be escaped")))).toBe(true);
    expect(isEntityParseFailure(map(400, body(400, "Bad Request: chat not found")))).toBe(false);
  });
});

describe("parseTelegramUpdate", () => {
  const base = { update_id: 10 };
  const dm = (over: Record<string, unknown> = {}) => ({
    ...base,
    message: { message_id: 5, date: 1_700_000_000, chat: { id: 7, type: "private" }, from: { id: 7, is_bot: false, first_name: "Ann", last_name: "Lee" }, text: "hi", ...over },
  });
  const group = (over: Record<string, unknown> = {}) =>
    dm({ chat: { id: -100123, type: "supergroup", title: "G" }, from: { id: 8, is_bot: false, username: "bob" }, ...over });

  test("a DM: ids are namespaced per chat, full name is the display name, mentionsSelf is true", () => {
    const e = parseTelegramUpdate(dm(), SELF, never);
    expect(e).toMatchObject({ kind: "message", id: "7:5", chatId: "7", userId: "7", displayName: "Ann Lee", isGroup: false, mentionsSelf: true, isEcho: false, timestamp: 1_700_000_000_000 });
  });

  test("a group keeps the individual sender and is not addressed unless mentioned", () => {
    const e = parseTelegramUpdate(group(), SELF, never);
    expect(e).toMatchObject({ chatId: "-100123", userId: "8", displayName: "bob", isGroup: true, mentionsSelf: false });
  });

  test("mentions: @username (case-insensitive), /cmd@bot, text_mention and reply to the bot", () => {
    const mention = group({ text: "hey @rabot go", entities: [{ type: "mention", offset: 4, length: 6 }] });
    expect(parseTelegramUpdate(mention, SELF, never)).toMatchObject({ mentionsSelf: true });
    const other = group({ text: "hey @someone go", entities: [{ type: "mention", offset: 4, length: 8 }] });
    expect(parseTelegramUpdate(other, SELF, never)).toMatchObject({ mentionsSelf: false });
    const cmd = group({ text: "/start@RaBot", entities: [{ type: "bot_command", offset: 0, length: 12 }] });
    expect(parseTelegramUpdate(cmd, SELF, never)).toMatchObject({ mentionsSelf: true });
    const bare = group({ text: "/start", entities: [{ type: "bot_command", offset: 0, length: 6 }] });
    expect(parseTelegramUpdate(bare, SELF, never)).toMatchObject({ mentionsSelf: false });
    const textMention = group({ text: "you", entities: [{ type: "text_mention", offset: 0, length: 3, user: { id: 99 } }] });
    expect(parseTelegramUpdate(textMention, SELF, never)).toMatchObject({ mentionsSelf: true });
    const reply = group({ reply_to_message: { message_id: 3, from: { id: 99, is_bot: true } } });
    expect(parseTelegramUpdate(reply, SELF, never)).toMatchObject({ mentionsSelf: true, replyTo: "3" });
  });

  test("echo: this bot, any bot, or a message id this adapter sent", () => {
    expect(parseTelegramUpdate(dm({ from: { id: 99, is_bot: true } }), SELF, never)).toMatchObject({ isEcho: true });
    expect(parseTelegramUpdate(dm({ from: { id: 55, is_bot: true } }), SELF, never)).toMatchObject({ isEcho: true });
    expect(parseTelegramUpdate(dm(), SELF, (id) => id === "7:5")).toMatchObject({ isEcho: true });
    expect(parseTelegramUpdate(dm(), SELF, never)).toMatchObject({ isEcho: false });
  });

  test("forum topics: threadId is kept and the topic-root reply is not a user reply", () => {
    const topic = group({ is_topic_message: true, message_thread_id: 40, reply_to_message: { message_id: 40 } });
    expect(parseTelegramUpdate(topic, SELF, never)).toMatchObject({ threadId: "40" });
    expect(parseTelegramUpdate(topic, SELF, never)).not.toHaveProperty("replyTo");
    const real = group({ is_topic_message: true, message_thread_id: 40, reply_to_message: { message_id: 44 } });
    expect(parseTelegramUpdate(real, SELF, never)).toMatchObject({ threadId: "40", replyTo: "44" });
  });

  test("channel posts use the channel as the sender", () => {
    const post = { ...base, channel_post: { message_id: 2, date: 1, chat: { id: -100999, type: "channel", title: "News" }, text: "post" } };
    expect(parseTelegramUpdate(post, SELF, never)).toMatchObject({ userId: "-100999", displayName: "News", isGroup: true, mentionsSelf: false });
  });

  test("photos use the largest size; documents keep name and type; captions are the text", () => {
    const e = parseTelegramUpdate(
      dm({ text: undefined, caption: "look", photo: [{ file_id: "s", file_size: 10, width: 1, height: 1 }, { file_id: "l", file_size: 900, width: 9, height: 9 }], document: { file_id: "d", file_name: "a.pdf", mime_type: "application/pdf" } }),
      SELF,
      never,
    );
    expect(e).toMatchObject({ text: "look" });
    expect(e.kind === "message" && e.files.map((f) => [f.fileId, f.filename, f.contentType])).toEqual([
      ["l", "photo-l.jpg", "image/jpeg"],
      ["d", "a.pdf", "application/pdf"],
    ]);
  });

  test("edits, callbacks, service messages and empty messages are ignored", () => {
    expect(parseTelegramUpdate({ ...base, edited_message: { message_id: 1 } }, SELF, never).kind).toBe("ignore");
    expect(parseTelegramUpdate({ ...base, callback_query: {} }, SELF, never).kind).toBe("ignore");
    expect(parseTelegramUpdate(dm({ text: undefined, new_chat_members: [{}] }), SELF, never).kind).toBe("ignore");
    expect(parseTelegramUpdate("junk", SELF, never).kind).toBe("ignore");
  });
});
