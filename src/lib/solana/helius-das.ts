/**
 * Helius DAS (Digital Asset Standard) helpers — read the NFTs a wallet holds so
 * a player can pick one as their profile picture.
 *
 * DAS is exposed over the same RPC endpoint when SOLANA_RPC_URL points at a
 * Helius node (it does in production). On a non-Helius RPC these calls error,
 * which the callers surface gracefully ("NFT lookup needs a Helius RPC").
 */

import { env } from "@/lib/env";

export interface DasAsset {
  id: string;
  name: string;
  image: string;
}

interface RawAsset {
  id: string;
  content?: {
    metadata?: { name?: string };
    links?: { image?: string };
    files?: Array<{ uri?: string; cdn_uri?: string; mime?: string }>;
  };
  ownership?: { owner?: string };
}

/**
 * Resolve a renderable HTTP(S) image URL for an asset, preferring Helius's
 * cached CDN copy. Returns null when no web-renderable image is available — and
 * never returns data:/javascript:/other schemes, so it's safe to drop straight
 * into an <img src>.
 */
function pickImage(a: RawAsset): string | null {
  const c = a.content;
  if (!c) return null;
  const candidates: Array<string | undefined> = [
    ...(c.files?.map((f) => f.cdn_uri) ?? []),
    c.links?.image,
    ...(c.files?.map((f) => f.uri) ?? []),
  ];
  for (const u of candidates) {
    if (typeof u !== "string" || u.length === 0) continue;
    if (u.startsWith("https://") || u.startsWith("http://")) return u;
    if (u.startsWith("ipfs://")) return `https://ipfs.io/ipfs/${u.slice(7)}`;
  }
  return null;
}

async function das<T>(method: string, params: unknown): Promise<T> {
  const res = await fetch(env.solanaRpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "velvet", method, params }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`DAS ${method} failed: ${res.status}`);
  const json = (await res.json()) as { result?: T; error?: { message?: string } };
  if (json.error) throw new Error(`DAS ${method}: ${json.error.message ?? "error"}`);
  if (json.result === undefined) throw new Error(`DAS ${method}: empty result`);
  return json.result;
}

/** NFTs (non-fungible assets) owned by `owner` that have a usable image. */
export async function getOwnedNfts(owner: string, limit = 60): Promise<DasAsset[]> {
  const result = await das<{ items?: RawAsset[] }>("getAssetsByOwner", {
    ownerAddress: owner,
    page: 1,
    limit: 200,
    displayOptions: { showFungible: false, showCollectionMetadata: false },
  });
  const out: DasAsset[] = [];
  for (const a of result.items ?? []) {
    const image = pickImage(a);
    if (!image) continue;
    out.push({ id: a.id, name: a.content?.metadata?.name ?? "NFT", image });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Confirm one of `owners` currently holds `assetId`, returning its image URL.
 * Ownership is re-checked on-chain so a client can't set a picture from an NFT
 * it doesn't actually hold. Returns null if not owned or it has no image.
 */
export async function getAssetImageIfOwned(
  assetId: string,
  owners: string[],
): Promise<string | null> {
  const a = await das<RawAsset>("getAsset", { id: assetId });
  const owner = a.ownership?.owner;
  if (!owner || !owners.includes(owner)) return null;
  return pickImage(a);
}
