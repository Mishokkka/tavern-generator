import { MODULE_ID } from "../constants.js";

const SOCKET_CHANNEL = `module.${MODULE_ID}`;
const REPLAY_TTL_MS = 10 * 60 * 1000;
const OMIT = Symbol("omit-json-property");

/**
 * Lightweight transport over Foundry's native module socket namespace.
 *
 * The previous implementation used User document flags as a message bus. That is not a reliable
 * transport for request/response traffic: depending on permissions and client synchronization,
 * an update can be persisted without the remote client observing the matching updateUser hook.
 * Foundry's module socket exists specifically for inter-client messages, works over ordinary LAN
 * HTTP sessions, and does not require Web Crypto or an additional dependency such as socketlib.
 * Sender IDs are client-provided, not authenticated by the server; this is a trusted-table transport.
 */
export class TavernSocketRelay {
  static #registered = false;
  static #handler = null;
  static #seen = new Map();

  static register(handler) {
    if (typeof handler !== "function") throw new Error("Некорректный обработчик socket-канала таверны.");
    this.#handler = handler;
    if (this.#registered) return this.available;

    if (typeof game?.socket?.on !== "function" || typeof game?.socket?.emit !== "function") return false;

    game.socket.on(SOCKET_CHANNEL, (envelope) => {
      void this.#onSocketMessage(envelope).catch((error) => {
        console.warn(`${MODULE_ID} | Rejected or failed tavern socket message`, error);
      });
    });

    this.#registered = true;
    return this.available;
  }

  static get available() {
    return Boolean(
      this.#registered
      && game.user?.id
      && typeof game.socket?.on === "function"
      && typeof game.socket?.emit === "function"
    );
  }

  static async emit(payload, { targetUserId = null } = {}) {
    if (!this.available) throw new Error("Socket-канал таверны недоступен на этом клиенте.");

    const normalizedPayload = this.#normalizePayload(payload);
    const envelope = {
      id: foundry.utils.randomID(24),
      sentAt: Date.now(),
      senderId: String(game.user.id),
      recipientId: String(targetUserId ?? "").trim() || null,
      payload: normalizedPayload
    };

    game.socket.emit(SOCKET_CHANNEL, envelope);
    return foundry.utils.deepClone(normalizedPayload);
  }

  static async #onSocketMessage(rawEnvelope) {
    let envelope;
    try {
      envelope = this.#normalizeEnvelope(rawEnvelope);
    } catch (_error) {
      return;
    }

    const localUserId = String(game.user?.id ?? "").trim();
    if (!localUserId) return;
    if (envelope.recipientId && envelope.recipientId !== localUserId) return;

    const sender = game.users?.get?.(envelope.senderId)
      ?? (Array.isArray(game.users) ? game.users.find((candidate) => candidate?.id === envelope.senderId) : null);
    if (!sender || sender.id !== envelope.senderId || !sender.active) return;

    const now = Date.now();
    // Client wall clocks may differ. Replay expiry uses only the receiver's arrival time.
    this.#pruneSeen(now);
    const replayKey = `${envelope.senderId}:${envelope.id}`;
    if (this.#seen.has(replayKey)) return;
    this.#seen.set(replayKey, now);

    const payload = envelope.payload;
    // The transport owns the sender field. Callers cannot accidentally keep a stale value
    // from their own payload object.
    payload.sender = envelope.senderId;

    await this.#handler?.(payload, sender);
  }

  static #normalizeEnvelope(value) {
    const normalized = this.#normalizePayload(value);
    const id = String(normalized.id ?? "").trim();
    const sentAt = Number(normalized.sentAt);
    const senderId = String(normalized.senderId ?? "").trim();
    const recipientId = String(normalized.recipientId ?? "").trim() || null;
    if (!id || !senderId || !Number.isFinite(sentAt)) throw new TypeError("Invalid tavern socket envelope.");
    const payload = this.#normalizePayload(normalized.payload);
    return { id, sentAt, senderId, recipientId, payload };
  }

  static #normalizePayload(value) {
    const normalized = this.#normalizeJson(value, new Set(), false);
    if (!normalized || normalized === OMIT || Array.isArray(normalized) || typeof normalized !== "object") {
      throw new TypeError("Socket payload must be a JSON-safe object.");
    }
    return normalized;
  }

  static #normalizeJson(value, seen, inArray) {
    if (value === undefined) return inArray ? null : OMIT;
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new TypeError("Socket payload contains a non-finite number.");
      return value;
    }
    if (typeof value !== "object") throw new TypeError("Socket payload contains a non-JSON-safe value.");
    if (seen.has(value)) throw new TypeError("Socket payload contains a circular reference.");

    seen.add(value);
    try {
      if (Array.isArray(value)) {
        return Array.from({ length: value.length }, (_, index) => {
          const normalized = this.#normalizeJson(value[index], seen, true);
          return normalized === OMIT ? null : normalized;
        });
      }

      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError("Socket payload contains a non-plain object.");
      }

      const normalized = Object.create(null);
      for (const key of Object.keys(value)) {
        const entry = this.#normalizeJson(value[key], seen, false);
        if (entry !== OMIT) normalized[key] = entry;
      }
      return normalized;
    } finally {
      seen.delete(value);
    }
  }

  static #pruneSeen(now) {
    for (const [key, at] of this.#seen) {
      if (now - at > REPLAY_TTL_MS) this.#seen.delete(key);
    }
  }
}
