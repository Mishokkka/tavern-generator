import { MODULE_ID } from "../constants.js";

const PRIVATE_KEY_SETTING = "socketPrivateKey";
const PUBLIC_KEY_FLAG = "socketPublicKey";
const MAX_MESSAGE_AGE_MS = 5 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 30 * 1000;
const REPLAY_TTL_MS = 10 * 60 * 1000;

export class TavernSocketIdentity {
  static #privateKey = null;
  static #publicKeyCache = new Map();
  static #seenNonces = new Map();
  static #readyPromise = null;

  static registerSettings() {
    game.settings.register(MODULE_ID, PRIVATE_KEY_SETTING, {
      name: "Socket Signing Private Key",
      scope: "user",
      config: false,
      type: Object,
      default: {}
    });
  }

  static initialize() {
    this.#readyPromise ??= this.#initialize();
    return this.#readyPromise;
  }

  static async sign(payload) {
    await this.initialize();
    if (!this.#privateKey) throw new Error("Не удалось инициализировать подпись сообщений таверны.");

    const unsigned = {
      ...foundry.utils.deepClone(payload ?? {}),
      sender: game.user.id,
      signedAt: Date.now(),
      nonce: foundry.utils.randomID(24)
    };
    delete unsigned.signature;

    const bytes = new TextEncoder().encode(this.#canonical(unsigned));
    const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, this.#privateKey, bytes);
    return { ...unsigned, signature: this.#toBase64(signature) };
  }

  static async verify(payload) {
    await this.initialize();
    const senderId = String(payload?.sender ?? "").trim();
    const signature = String(payload?.signature ?? "").trim();
    const nonce = String(payload?.nonce ?? "").trim();
    const signedAt = Number(payload?.signedAt);
    if (!senderId || !signature || !nonce || !Number.isFinite(signedAt)) return null;

    const now = Date.now();
    if (signedAt < now - MAX_MESSAGE_AGE_MS || signedAt > now + MAX_FUTURE_SKEW_MS) return null;

    const replayKey = `${senderId}:${nonce}`;
    this.#pruneSeen(now);
    if (this.#seenNonces.has(replayKey)) return null;

    const user = game.users?.get?.(senderId) ?? null;
    if (!user) return null;
    const publicKey = await this.#publicKeyFor(user);
    if (!publicKey) return null;

    const unsigned = foundry.utils.deepClone(payload);
    delete unsigned.signature;
    const bytes = new TextEncoder().encode(this.#canonical(unsigned));

    let valid = false;
    try {
      valid = await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        publicKey,
        this.#fromBase64(signature),
        bytes
      );
    } catch (_error) {
      valid = false;
    }

    if (!valid) return null;
    this.#seenNonces.set(replayKey, now);
    return user;
  }

  static async #initialize() {
    if (!globalThis.crypto?.subtle || !game.user?.setFlag) {
      throw new Error("Текущий клиент не поддерживает криптографическую проверку socket-сообщений.");
    }

    let privateJwk = game.settings.get(MODULE_ID, PRIVATE_KEY_SETTING);
    let privateKey = null;

    if (privateJwk?.kty === "EC" && privateJwk?.d) {
      try {
        privateKey = await crypto.subtle.importKey(
          "jwk",
          privateJwk,
          { name: "ECDSA", namedCurve: "P-256" },
          true,
          ["sign"]
        );
      } catch (_error) {
        privateKey = null;
      }
    }

    if (!privateKey) {
      const pair = await crypto.subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-256" },
        true,
        ["sign", "verify"]
      );
      privateKey = pair.privateKey;
      privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
      await game.settings.set(MODULE_ID, PRIVATE_KEY_SETTING, privateJwk);
    }

    this.#privateKey = privateKey;
    const publicJwk = { ...privateJwk };
    delete publicJwk.d;
    delete publicJwk.key_ops;
    publicJwk.key_ops = ["verify"];

    const current = game.user.getFlag?.(MODULE_ID, PUBLIC_KEY_FLAG);
    if (this.#canonical(current ?? {}) !== this.#canonical(publicJwk)) {
      await game.user.setFlag(MODULE_ID, PUBLIC_KEY_FLAG, publicJwk);
    }
    this.#publicKeyCache.delete(game.user.id);
    return true;
  }

  static async #publicKeyFor(user) {
    const jwk = user.getFlag?.(MODULE_ID, PUBLIC_KEY_FLAG) ?? user.flags?.[MODULE_ID]?.[PUBLIC_KEY_FLAG];
    if (!jwk?.x || !jwk?.y) return null;
    const fingerprint = this.#canonical(jwk);
    const cached = this.#publicKeyCache.get(user.id);
    if (cached?.fingerprint === fingerprint) return cached.key;

    try {
      const key = await crypto.subtle.importKey(
        "jwk",
        jwk,
        { name: "ECDSA", namedCurve: "P-256" },
        true,
        ["verify"]
      );
      this.#publicKeyCache.set(user.id, { fingerprint, key });
      return key;
    } catch (_error) {
      return null;
    }
  }

  static #canonical(value) {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map((entry) => this.#canonical(entry)).join(",")}]`;
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${this.#canonical(value[key])}`).join(",")}}`;
  }

  static #toBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }

  static #fromBase64(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  static #pruneSeen(now) {
    for (const [key, at] of this.#seenNonces) {
      if (now - at > REPLAY_TTL_MS) this.#seenNonces.delete(key);
    }
  }
}
