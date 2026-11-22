/**
 * ShinPoW Cloud Sync + Auto-Anchor Adapter (Cloudflare Worker API)
 * ---------------------------------------------------------------------------
 * 모든 기기(아이패드·스마트폰·PC)에서 동일한 지훈/이현 체인을 실시간 동기화하고,
 * 새 블록 채굴 시 서버 Relayer를 통해 Base L2에 자동으로 온체인 기록합니다.
 */

export async function fetchCloudLedger(cloudConfig) {
  if (!cloudConfig?.enabled || !cloudConfig?.apiUrl) {
    return { ok: false, skipped: true };
  }
  try {
    const res = await fetch(`${cloudConfig.apiUrl.replace(/\/$/, '')}/api/ledger`, {
      method: 'GET',
      cache: 'no-store'
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return await res.json();
  } catch (err) {
    return { ok: false, error: err?.message || '오프라인' };
  }
}

export async function syncCloudLedger({ cloudConfig, chains, solved }) {
  if (!cloudConfig?.enabled || !cloudConfig?.apiUrl) {
    return { ok: false, skipped: true };
  }
  try {
    const res = await fetch(`${cloudConfig.apiUrl.replace(/\/$/, '')}/api/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chains, solved })
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.error || `HTTP ${res.status}` };
    }
    return data;
  } catch (err) {
    return { ok: false, error: err?.message || '네트워크 오프라인' };
  }
}

export async function resetCloudLedger({ cloudConfig, parentPin }) {
  if (!cloudConfig?.enabled || !cloudConfig?.apiUrl) {
    return { ok: false, skipped: true };
  }
  try {
    const res = await fetch(`${cloudConfig.apiUrl.replace(/\/$/, '')}/api/reset`, {
      method: 'POST',
      headers: { 'X-Parent-Pin': String(parentPin || '') }
    });
    return await res.json();
  } catch (err) {
    return { ok: false, error: err?.message || '오프라인' };
  }
}

