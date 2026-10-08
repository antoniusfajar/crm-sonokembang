import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

export type PushState = 'unsupported' | 'denied' | 'off' | 'on' | 'loading';

const supported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);
}

function urlBase64ToUint8Array(base64: string) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/** Status & kendali notifikasi push untuk perangkat yang sedang dipakai. */
export function usePush() {
  const [state, setState] = useState<PushState>('loading');

  const refresh = useCallback(async () => {
    if (!supported()) return setState('unsupported');
    if (Notification.permission === 'denied') return setState('denied');
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    setState(sub ? 'on' : 'off');
  }, []);

  useEffect(() => {
    refresh().catch(() => setState('unsupported'));
  }, [refresh]);

  const enable = useCallback(async () => {
    if (!supported()) throw new Error('Browser ini belum mendukung notifikasi. Pakai Chrome atau Edge terbaru.');
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      await refresh();
      throw new Error('Izin notifikasi ditolak. Aktifkan lewat pengaturan situs di browser.');
    }
    setState('loading');
    const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register('/sw.js'));
    await withTimeout(navigator.serviceWorker.ready, 10_000, 'Service worker belum siap. Pastikan CRM dibuka lewat https, lalu muat ulang halaman.');
    const { publicKey } = await api.get<{ publicKey: string }>('/api/push/key');
    let sub: PushSubscription;
    try {
      sub =
        (await reg.pushManager.getSubscription()) ??
        (await withTimeout(
          reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }),
          20_000,
          'Layanan push browser tidak merespons. Coba lagi, atau pakai Chrome/Edge terbaru.',
        ));
    } catch (e) {
      await refresh();
      throw e;
    }
    const json = sub.toJSON();
    await api.post('/api/push/subscribe', { endpoint: json.endpoint, keys: json.keys });
    await refresh();
  }, [refresh]);

  const disable = useCallback(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await api.post('/api/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => undefined);
      await sub.unsubscribe();
    }
    await refresh();
  }, [refresh]);

  return { state, enable, disable };
}
