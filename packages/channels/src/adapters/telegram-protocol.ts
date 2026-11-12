import { channelError, type ChannelError } from "../errors.js";

/**
 * Pure Telegram Bot API knowledge: update parsing, MarkdownV2 escaping, text splitting and failure
 * mapping. No effects and no I/O, so it is tested directly and the adapter stays small.
 */

const rec = (u: unknown): Record<string, unknown> | undefined =>
  typeof u === "object" && u !== null && !Array.isArray(u) ? (u as Record<string, unknown>) : undefined;
const str = (u: unknown): string | undefined => (typeof u === "string" && u !== "" ? u : undefined);
const num = (u: unknown): number | undefined => (typeof u === "number" && Number.isFinite(u) ? u : undefined);
const list = (u: unknown): readonly unknown[] => (Array.isArray(u) ? u : []);

/** Telegram's hard limit for one text message, in UTF-16 code units after entity parsing. */
export const TELEGRAM_MAX_TEXT = 4096;

// ── Inbound ───────────────────────────────────────────────────────────────

/** The bot's own identity from `getMe`, used to resolve `mentionsSelf` and echoes. */
export interface TelegramSelf {
  readonly id: number;
  readonly username?: string;
}

/** File metadata from a received message; the bytes are fetched separately (`getFile`). */
export interface TelegramFileRef {
  readonly fileId: string;
  readonly filename: string;
  readonly contentType: string;
  readonly size?: number;
}

/** A parsed update. */
export type TelegramEvent =
  | {
      readonly kind: "message";
      readonly updateId: number;
      /** `<chatId>:<messageId>`: message ids are only unique per chat. */
      readonly id: string;
      readonly chatId: string;
      readonly chatType: string;
      readonly threadId?: string;
      readonly userId: string;
      readonly displayName?: string;
      readonly isGroup: boolean;
      readonly text: string;
      /** The replied-to Telegram `message_id` (same conversation). */
      readonly replyTo?: string;
      readonly mentionsSelf: boolean;
      readonly isEcho: boolean;
      readonly timestamp: number;
      readonly files: readonly TelegramFileRef[];
    }
  | { readonly kind: "ignore"; readonly updateId?: number };

const FILE_KINDS: ReadonlyArray<{ key: string; mime: string; ext: string }> = [
  { key: "video", mime: "video/mp4", ext: "mp4" },
  { key: "audio", mime: "audio/mpeg", ext: "mp3" },
  { key: "voice", mime: "audio/ogg", ext: "ogg" },
  { key: "animation", mime: "video/mp4", ext: "mp4" },
  { key: "video_note", mime: "video/mp4", ext: "mp4" },
];

const filesOf = (m: Record<string, unknown>): TelegramFileRef[] => {
  const out: TelegramFileRef[] = [];
  const sizes = list(m.photo).flatMap((p) => {
    const r = rec(p);
    return r && str(r.file_id) ? [r] : [];
  });
  const best = sizes.reduce<Record<string, unknown> | undefined>((acc, p) => {
    const score = (x: Record<string, unknown>) => num(x.file_size) ?? (num(x.width) ?? 0) * (num(x.height) ?? 0);
    return !acc || score(p) >= score(acc) ? p : acc;
  }, undefined);
  if (best) {
    const fileId = str(best.file_id) ?? "";
    const size = num(best.file_size);
    out.push({ fileId, filename: `photo-${str(best.file_unique_id) ?? fileId}.jpg`, contentType: "image/jpeg", ...(size !== undefined ? { size } : {}) });
  }
  const doc = rec(m.document);
  if (doc && str(doc.file_id)) {
    const fileId = str(doc.file_id) ?? "";
    const size = num(doc.file_size);
    out.push({
      fileId,
      filename: str(doc.file_name) ?? `document-${str(doc.file_unique_id) ?? fileId}`,
      contentType: str(doc.mime_type) ?? "application/octet-stream",
      ...(size !== undefined ? { size } : {}),
    });
  }
  for (const kind of FILE_KINDS) {
    const f = rec(m[kind.key]);
    if (!f || !str(f.file_id)) continue;
    const fileId = str(f.file_id) ?? "";
    const size = num(f.file_size);
    out.push({
      fileId,
      filename: str(f.file_name) ?? `${kind.key}-${str(f.file_unique_id) ?? fileId}.${kind.ext}`,
      contentType: str(f.mime_type) ?? kind.mime,
      ...(size !== undefined ? { size } : {}),
    });
  }
  return out;
};

/** True when an entity addresses the bot: `@bot`, a text mention of the bot, or `/cmd@bot`. */
const entityAddressesBot = (text: string, entities: readonly unknown[], self: TelegramSelf): boolean => {
  const handle = self.username !== undefined ? `@${self.username}`.toLowerCase() : undefined;
  return entities.some((raw) => {
    const e = rec(raw);
    if (!e) return false;
    if (e.type === "text_mention") return num(rec(e.user)?.id) === self.id;
    if (handle === undefined) return false;
    const offset = num(e.offset);
    const length = num(e.length);
    if (offset === undefined || length === undefined) return false;
    const slice = text.slice(offset, offset + length).toLowerCase();
    if (e.type === "mention") return slice === handle;
    if (e.type === "bot_command") return slice.endsWith(handle);
    return false;
  });
};

/**
 * Parse one `getUpdates` / webhook update.
 *
 * - `message` and `channel_post` become messages; edits, callbacks, joins and other update kinds
 *   are ignored. Messages with neither text nor a file are ignored.
 * - A group is the conversation and the individual sender is kept (`from`). Channel posts have no
 *   `from`; the channel is the sender.
 * - Echo: from this bot, from any bot (bots must not trigger each other in a loop), or a message id
 *   this adapter sent (`wasSentByUs`, keyed `<chatId>:<messageId>`).
 * - `mentionsSelf`: a DM, an entity addressing the bot, or a reply to one of the bot's messages.
 */
export const parseTelegramUpdate = (
  update: unknown,
  self: TelegramSelf,
  wasSentByUs: (id: string) => boolean,
): TelegramEvent => {
  const u = rec(update);
  const updateId = num(u?.update_id);
  if (!u || updateId === undefined) return { kind: "ignore" };
  const ignore: TelegramEvent = { kind: "ignore", updateId };
  const m = rec(u.message) ?? rec(u.channel_post);
  const chat = rec(m?.chat);
  const chatNum = num(chat?.id);
  const messageId = num(m?.message_id);
  if (!m || !chat || chatNum === undefined || messageId === undefined) return ignore;

  const text = str(m.text) ?? str(m.caption) ?? "";
  const files = filesOf(m);
  if (text === "" && files.length === 0) return ignore;

  const from = rec(m.from);
  const actor = from ?? rec(m.sender_chat) ?? chat;
  const actorId = num(actor.id);
  if (actorId === undefined) return ignore;

  const chatType = str(chat.type) ?? "private";
  const isGroup = chatType !== "private";
  const id = `${chatNum}:${messageId}`;
  const username = str(actor.username);
  const fullName = [str(actor.first_name), str(actor.last_name)].filter((p) => p !== undefined).join(" ");
  const displayName = username ?? (fullName !== "" ? fullName : str(actor.title));

  const reply = rec(m.reply_to_message);
  const topic = m.is_topic_message === true ? num(m.message_thread_id) : undefined;
  const replyId = num(reply?.message_id);
  // Inside a forum topic every message "replies" to the topic's root message; that is not a user reply.
  const replyTo = replyId !== undefined && replyId !== topic ? String(replyId) : undefined;

  const entities = [...list(m.entities), ...list(m.caption_entities)];
  const mentionsSelf =
    !isGroup || entityAddressesBot(text, entities, self) || num(rec(reply?.from)?.id) === self.id;

  return {
    kind: "message",
    updateId,
    id,
    chatId: String(chatNum),
    chatType,
    ...(topic !== undefined ? { threadId: String(topic) } : {}),
    userId: String(actorId),
    ...(displayName !== undefined ? { displayName } : {}),
    isGroup,
    text,
    ...(replyTo !== undefined ? { replyTo } : {}),
    mentionsSelf,
    isEcho: actorId === self.id || from?.is_bot === true || wasSentByUs(id),
    timestamp: (num(m.date) ?? 0) * 1000,
    files,
  };
};

// ── MarkdownV2 ────────────────────────────────────────────────────────────

const MDV2_SPECIAL = /[_*[\]()~`>#+\-=|{}.!\\]/g;

/** Escape text so Telegram renders it literally under `parse_mode=MarkdownV2`. */
export const escapeMarkdownV2 = (text: string): string => text.replace(MDV2_SPECIAL, "\\$&");

const escapeCode = (s: string): string => s.replace(/[`\\]/g, "\\$&");
const escapeUrl = (s: string): string => s.replace(/[)\\]/g, "\\$&");

const INLINE = new RegExp(
  [
    String.raw`\[([^\]\n]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)`, // 1 text, 2 url (one level of parentheses)
    String.raw`\*\*(?=\S)(.+?)(?<=\S)\*\*`, // 3 bold
    String.raw`~~(?=\S)(.+?)(?<=\S)~~`, // 4 strike
    String.raw`(?<![\w*])\*(?=[^\s*])([^*\n]+?)(?<=[^\s*])\*(?![\w*])`, // 5 italic
    String.raw`(?<!\w)_(?=[^\s_])([^_\n]+?)(?<=[^\s_])_(?!\w)`, // 6 italic (snake_case is left alone)
  ].join("|"),
  "g",
);

const renderInline = (s: string): string => {
  let out = "";
  let last = 0;
  for (const m of s.matchAll(INLINE)) {
    out += escapeMarkdownV2(s.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[1] !== undefined) out += `[${renderInline(m[1])}](${escapeUrl(m[2] ?? "")})`;
    else if (m[3] !== undefined) out += `*${renderInline(m[3])}*`;
    else if (m[4] !== undefined) out += `~${renderInline(m[4])}~`;
    else out += `_${renderInline(m[5] ?? m[6] ?? "")}_`;
  }
  return out + escapeMarkdownV2(s.slice(last));
};

const renderLines = (s: string): string =>
  s
    .split("\n")
    .map((line) => {
      const heading = /^#{1,6}\s+(.+)$/.exec(line);
      return heading ? `*${renderInline(heading[1] ?? "")}*` : renderInline(line);
    })
    .join("\n");

const renderWithInlineCode = (s: string): string => {
  let out = "";
  let last = 0;
  for (const m of s.matchAll(/`([^`\n]+)`/g)) {
    out += renderLines(s.slice(last, m.index));
    out += `\`${escapeCode(m[1] ?? "")}\``;
    last = m.index + m[0].length;
  }
  return out + renderLines(s.slice(last));
};

/**
 * Convert common Markdown (bold, italic, strike, links, headings, inline and fenced code) to
 * Telegram MarkdownV2, escaping every other special character. Output is for `parse_mode=MarkdownV2`.
 * Constructs it does not recognise are escaped, never passed through, so a stray `_` or `.` cannot
 * make Telegram reject the message.
 */
export const toMarkdownV2 = (markdown: string): string => {
  let out = "";
  let last = 0;
  for (const m of markdown.matchAll(/```([^\n`]*)\n?([\s\S]*?)```/g)) {
    out += renderWithInlineCode(markdown.slice(last, m.index));
    const lang = (m[1] ?? "").replace(/[^\w+-]/g, "");
    out += `\`\`\`${lang}\n${escapeCode(m[2] ?? "")}\`\`\``;
    last = m.index + m[0].length;
  }
  return out + renderWithInlineCode(markdown.slice(last));
};

// ── Splitting ─────────────────────────────────────────────────────────────

const FENCE_RESERVE = 8;

/** Largest prefix length <= `max` that does not split a grapheme cluster (or a surrogate pair). */
const graphemeSafeCut = (s: string, max: number): number => {
  let end = 0;
  for (const { segment, index } of new Intl.Segmenter().segment(s.slice(0, max + 1))) {
    if (index + segment.length > max) break;
    end = index + segment.length;
  }
  return end > 0 ? end : max;
};

const cutPoint = (rest: string, max: number): { end: number; skip: number } => {
  const window = rest.slice(0, max + 1);
  const floor = Math.floor(max / 2);
  for (const sep of ["\n\n", "\n", " "]) {
    const at = window.lastIndexOf(sep);
    if (at >= floor) {
      let skip = sep.length;
      if (sep === "\n\n") while (rest[at + skip] === "\n") skip++;
      return { end: at, skip };
    }
  }
  return { end: graphemeSafeCut(rest, max), skip: 0 };
};

/**
 * Split text into messages of at most `limit` UTF-16 units. Prefers paragraph, then line, then word
 * boundaries; a hard cut never splits a surrogate pair or grapheme cluster. A code fence open at
 * a cut is closed and reopened so each part renders correctly.
 */
export const splitTelegramText = (text: string, limit: number = TELEGRAM_MAX_TEXT): string[] => {
  const max = text.includes("```") ? limit - FENCE_RESERVE : limit;
  const parts: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    const { end, skip } = cutPoint(rest, max);
    let chunk = rest.slice(0, end);
    rest = rest.slice(end + skip);
    if ((chunk.match(/```/g)?.length ?? 0) % 2 === 1) {
      chunk += "\n```";
      rest = `\`\`\`\n${rest}`;
    }
    parts.push(chunk);
  }
  if (rest !== "" || parts.length === 0) parts.push(rest);
  return parts;
};

// ── Failures ──────────────────────────────────────────────────────────────

/** Replace the bot token (and anything shaped like one) so no text carrying it is kept. */
export const redactToken = (text: string, token: string): string =>
  (token === "" ? text : text.split(token).join("[redacted]")).replace(/\d{5,}:[A-Za-z0-9_-]{20,}/g, "[redacted]");

/** What Telegram said went wrong. Stored (token-scrubbed) in `ChannelError.cause.telegram`. */
export interface TelegramFailure {
  readonly httpStatus: number;
  readonly errorCode?: number;
  readonly description?: string;
  readonly retryAfterSeconds?: number;
}

/** Read the Telegram failure body (`{ ok:false, error_code, description, parameters }`). */
export const parseTelegramFailure = (httpStatus: number, body: unknown): TelegramFailure => {
  const b = rec(body);
  const errorCode = num(b?.error_code);
  const description = str(b?.description);
  const retryAfterSeconds = num(rec(b?.parameters)?.retry_after);
  return {
    httpStatus,
    ...(errorCode !== undefined ? { errorCode } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
  };
};

/**
 * Map a Telegram failure to a typed {@link ChannelError}.
 *
 * 401 `auth`; 403 `forbidden` (bot blocked, kicked, or may not message this user); 404 and
 * 400 "chat/user not found" `not_found`; 400 "too long" and 413 `too_large`; 429 `rate_limited` with
 * `retry_after`; 5xx `network`; 409 (another `getUpdates` consumer or an active webhook) is
 * non-retryable `conflict` with an explicit message. `message` is generic text, never Telegram's;
 * the scrubbed description lives in `cause.telegram`.
 */
export const mapTelegramFailure = (
  adapter: string,
  failure: TelegramFailure,
  scrub: (text: string) => string,
): ChannelError => {
  const code = failure.errorCode ?? failure.httpStatus;
  const description = failure.description?.toLowerCase() ?? "";
  const cause = {
    telegram: {
      errorCode: code,
      ...(failure.description !== undefined ? { description: scrub(failure.description) } : {}),
    },
  };
  if (code === 401) return channelError(adapter, "auth", { cause });
  if (code === 403) return channelError(adapter, "forbidden", { cause });
  if (code === 404) return channelError(adapter, "not_found", { cause });
  if (code === 413) return channelError(adapter, "too_large", { cause });
  if (code === 429) {
    return channelError(adapter, "rate_limited", {
      cause,
      ...(failure.retryAfterSeconds !== undefined ? { retryAfterMs: Math.round(failure.retryAfterSeconds * 1000) } : {}),
    });
  }
  if (code === 409) {
    return channelError(adapter, "conflict", {
      message: `channel ${adapter}: telegram conflict (409): another getUpdates consumer or an active webhook owns this bot; stop it or call deleteWebhook`,
      cause,
    });
  }
  if (code === 400) {
    if (description.includes("not found")) return channelError(adapter, "not_found", { cause });
    if (/too long|too big|too large/.test(description)) return channelError(adapter, "too_large", { cause });
  }
  if (failure.httpStatus >= 500 || code >= 500) return channelError(adapter, "network", { cause });
  return channelError(adapter, "unknown", { cause });
};

/** The scrubbed Telegram description carried by a mapped error, if any. */
export const telegramDescription = (error: ChannelError): string | undefined => {
  const cause = rec(error.cause);
  return str(rec(cause?.telegram)?.description);
};

/** True when Telegram rejected the text's MarkdownV2 entities (retry as plain text). */
export const isEntityParseFailure = (error: ChannelError): boolean =>
  /can't parse entities/i.test(telegramDescription(error) ?? "");
