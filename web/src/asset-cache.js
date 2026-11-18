const CACHE_NAME = 'aero-assets-v1';

async function openAssetCache() {
  if (typeof caches === 'undefined') return null;
  try {
    return await caches.open(CACHE_NAME);
  } catch {
    return null;
  }
}

export async function deleteCachedAsset(cacheKey) {
  const cache = await openAssetCache();
  if (!cache) return;
  try { await cache.delete(cacheKey); } catch {}
}

export async function hasCachedAsset(cacheKey, { bypass = import.meta.env.DEV } = {}) {
  if (bypass) return false;
  const cache = await openAssetCache();
  if (!cache) return false;
  try {
    return Boolean(await cache.match(cacheKey));
  } catch {
    return false;
  }
}

export async function cachedArrayBuffer(url, { cacheKey = url, bypass = import.meta.env.DEV, onProgress = null } = {}) {
  const cache = bypass ? null : await openAssetCache();
  if (cache) {
    try {
      const hit = await cache.match(cacheKey);
      if (hit) {
        const buffer = await hit.arrayBuffer();
        if (onProgress) onProgress(buffer.byteLength, buffer.byteLength);
        return buffer;
      }
    } catch {
      // Ignore cache read failures and fall back to network
    }
  }

  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const total = Number(response.headers.get('content-length')) || 0;
  let buffer;
  if (onProgress && response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let loaded = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      onProgress(loaded, total);
    }
    const merged = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    buffer = merged.buffer;
  } else {
    buffer = await response.arrayBuffer();
    if (onProgress) onProgress(buffer.byteLength, total || buffer.byteLength);
  }

  if (cache) {
    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    cache.put(cacheKey, new Response(buffer, { headers: { 'Content-Type': contentType } })).catch(() => {});
  }
  return buffer;
}
