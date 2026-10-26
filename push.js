/* DailyMind – Push-Erinnerungen auf diesem Gerät ein- und ausschalten
   Wird von index.html und von den Kontoeinstellungen (/konto.html im Repo mvs2-bot.github.io) geladen.
   Das Abo hängt immer am Service Worker von DailyMind (Scope /DailyMind/), egal von welcher Seite aus
   es angelegt wird. Wann eine Erinnerung kommt, steht in public.dailymind_push_settings.

   Auf iPhone/iPad gibt es Web Push nur in der zum Home-Bildschirm hinzugefügten App (ab iOS 16.4). */
(function () {
  const SCOPE = '/DailyMind/';
  const FUNCTION_URL = 'https://syaonnedmidaipwjjmio.supabase.co/functions/v1/dailymind-push';

  const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const b64ToBytes = s => Uint8Array.from(atob((s + '='.repeat((4 - s.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

  async function registration() {
    const reg = (await navigator.serviceWorker.getRegistration(SCOPE)) || (await navigator.serviceWorker.register(SCOPE + 'sw.js', { scope: SCOPE }));
    // Außerhalb des Scopes (Kontoseite) löst navigator.serviceWorker.ready nie auf, daher selbst warten
    const sw = reg.installing || reg.waiting;
    if (!reg.active && sw) await new Promise(ok => sw.addEventListener('statechange', () => sw.state === 'activated' && ok()));
    return reg;
  }

  // Aktuelles Abo dieses Geräts oder null
  async function current() {
    if (!supported()) return null;
    const reg = await navigator.serviceWorker.getRegistration(SCOPE);
    return reg ? reg.pushManager.getSubscription() : null;
  }

  // Muss direkt aus einem Klick heraus aufgerufen werden (Safari fragt sonst nicht nach der Erlaubnis)
  async function enable(sb) {
    if (!supported()) throw new Error(isIOS()
      ? 'Auf dem iPhone gehen Erinnerungen nur in der installierten App: DailyMind über „Teilen → Zum Home-Bildschirm“ hinzufügen und dort aktivieren.'
      : 'Dieser Browser unterstützt keine Push-Benachrichtigungen.');
    if (await Notification.requestPermission() !== 'granted') {
      throw new Error('Benachrichtigungen sind blockiert. Erlaube sie in den Browser- bzw. Systemeinstellungen für diese Seite.');
    }
    const reg = await registration();
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const { publicKey } = await fetch(FUNCTION_URL).then(r => r.json());
      if (!publicKey) throw new Error('Push ist auf dem Server noch nicht eingerichtet.');
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
    }
    const { endpoint, keys } = sub.toJSON();
    const { error } = await sb.rpc('dailymind_save_push_subscription', { p_endpoint: endpoint, p_p256dh: keys.p256dh, p_auth: keys.auth });
    if (error) throw error;
    return sub;
  }

  async function disable(sb) {
    const sub = await current();
    if (!sub) return;
    await sb.from('dailymind_push_subscriptions').delete().eq('endpoint', sub.endpoint);
    await sub.unsubscribe();
  }

  window.DailyMindPush = { supported, isIOS, current, enable, disable };
})();
