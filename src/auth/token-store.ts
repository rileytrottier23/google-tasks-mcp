import process from "node:process";
import { openKv } from "@deno/kv";
import { encrypt, decryptWithRotation } from "../utils/encryption.ts";

export interface TokenData {
  googleAccessToken: string;
  googleRefreshToken: string;
  expiresAt: number;
}

interface EncryptedTokenData {
  encryptedAccessToken: string;
  encryptedRefreshToken: string;
  expiresAt: number;
}

class TokenStore {
  private kv: Awaited<ReturnType<typeof openKv>> | null = null;

  async init() {
    this.kv = await openKv(process.env.KV_PATH);
  }

  async storeTokens(mcpToken: string, tokenData: TokenData): Promise<void> {
    if (!this.kv) throw new Error("KV not initialized");
    const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

    const encryptedData: EncryptedTokenData = {
      encryptedAccessToken: encrypt(tokenData.googleAccessToken),
      encryptedRefreshToken: encrypt(tokenData.googleRefreshToken),
      expiresAt: tokenData.expiresAt,
    };

    await this.kv.set(["tokens", mcpToken], encryptedData, { expireIn: TTL_MS });
  }

  async getTokens(mcpToken: string): Promise<TokenData | null> {
    if (!this.kv) throw new Error("KV not initialized");
    const result = await this.kv.get<EncryptedTokenData>(["tokens", mcpToken]);

    if (!result.value) {
      return null;
    }

    let tokens: TokenData;
    let usedPrevious: boolean;
    try {
      const access = decryptWithRotation(result.value.encryptedAccessToken);
      const refresh = decryptWithRotation(result.value.encryptedRefreshToken);
      tokens = {
        googleAccessToken: access.text,
        googleRefreshToken: refresh.text,
        expiresAt: result.value.expiresAt,
      };
      usedPrevious = access.usedPrevious || refresh.usedPrevious;
    } catch {
      // Stored under a secret that is neither ENCRYPTION_SECRET nor
      // ENCRYPTION_SECRET_PREVIOUS. Drop it so the client gets a 401 and
      // signs in again.
      await this.kv.delete(["tokens", mcpToken]);
      return null;
    }

    // Read with the old secret during a rotation: re-save under the new one.
    if (usedPrevious) {
      await this.storeTokens(mcpToken, tokens);
    }
    return tokens;
  }

  async isValid(mcpToken: string): Promise<boolean> {
    const data = await this.getTokens(mcpToken);
    return data !== null;
  }

  async updateTokens(mcpToken: string, updates: Partial<TokenData>): Promise<void> {
    if (!this.kv) throw new Error("KV not initialized");
    const existing = await this.getTokens(mcpToken);
    if (!existing) throw new Error("Token not found");

    const updatedData: TokenData = {
      ...existing,
      ...updates,
    };

    const encryptedData: EncryptedTokenData = {
      encryptedAccessToken: encrypt(updatedData.googleAccessToken),
      encryptedRefreshToken: encrypt(updatedData.googleRefreshToken),
      expiresAt: updatedData.expiresAt,
    };

    const TTL_MS = 30 * 24 * 60 * 60 * 1000;
    await this.kv.set(["tokens", mcpToken], encryptedData, { expireIn: TTL_MS });
  }

  async deleteToken(mcpToken: string): Promise<void> {
    if (!this.kv) throw new Error("KV not initialized");
    await this.kv.delete(["tokens", mcpToken]);
  }
}

export const tokenStore = new TokenStore();
