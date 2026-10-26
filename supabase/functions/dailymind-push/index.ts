// Edge Function "dailymind-push": tägliche Erinnerungen für die Morgen- und Abendroutine per Web Push
//
// GET   → { publicKey }  öffentlicher VAPID-Schlüssel, den die Browser zum Abonnieren brauchen
// POST  → kommt alle 5 Minuten vom Cron-Job (supabase/002_dailymind_push.sql) mit dem Header
//         x-dailymind-secret. dailymind_push_claim() prüft das Geheimnis, liefert die fälligen
//         Erinnerungen und merkt sie als gesendet. Abgelaufene Abos (404/410) werden gelöscht.
//
// "Verify JWT" ausschalten: Weder der Cron-Job noch der GET-Aufruf schicken ein Login-Token.
// VAPID-Schlüssel: erzeugt die Funktion beim ersten Start selbst und legt sie über
// dailymind_push_vapid() im Vault ab (supabase/003_dailymind_push_vapid.sql). Wer eigene nutzen
// will, setzt die Secrets VAPID_PUBLIC_KEY und VAPID_PRIVATE_KEY; die haben Vorrang.
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
});

const MESSAGES = {
    morning: { title: 'Guten Morgen ☀︎', body: 'Zeit für deine Morgenroutine: Dankbarkeit, Tagesfokus und deine Affirmation.' },
    evening: { title: 'Guten Abend ☾', body: 'Nimm dir ein paar Minuten für deinen Tagesrückblick.' },
} as const;

let publicKey: string | null = null;
async function vapid(): Promise<string> {
    if (publicKey) return publicKey;
    let pub = Deno.env.get('VAPID_PUBLIC_KEY'), priv = Deno.env.get('VAPID_PRIVATE_KEY');
    if (!pub || !priv) {
        const fresh = webpush.generateVAPIDKeys();
        const { data, error } = await admin.rpc('dailymind_push_vapid', { p_public: fresh.publicKey, p_private: fresh.privateKey });
        if (error) throw error;
        pub = data.public_key; priv = data.private_key;
    }
    webpush.setVapidDetails('https://mvs2-bot.github.io/DailyMind/', pub!, priv!);
    return (publicKey = pub!);
}

type Due = { user_id: string; kind: keyof typeof MESSAGES; endpoint: string; p256dh: string; auth: string };

Deno.serve(async req => {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (req.method !== 'GET' && req.method !== 'POST') return json({ error: 'Methode nicht erlaubt' }, 405);
    try { await vapid(); } catch (e) { return json({ error: 'VAPID-Schlüssel: ' + (e as Error).message }, 500); }
    if (req.method === 'GET') return json({ publicKey });

    const { data, error } = await admin.rpc('dailymind_push_claim', { p_secret: req.headers.get('x-dailymind-secret') ?? '' });
    if (error) return json({ error: error.message }, error.code === '42501' ? 403 : 500);

    const gone: string[] = [];
    let sent = 0;
    await Promise.all((data as Due[]).map(async d => {
        const payload = JSON.stringify({ ...MESSAGES[d.kind], kind: d.kind });
        try {
            await webpush.sendNotification({ endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } }, payload, { TTL: 3600, urgency: 'normal' });
            sent++;
        } catch (e) {
            const status = (e as { statusCode?: number }).statusCode;
            if (status === 404 || status === 410) gone.push(d.endpoint);
            else console.error('Push fehlgeschlagen', status, (e as Error).message);
        }
    }));
    if (gone.length) await admin.from('dailymind_push_subscriptions').delete().in('endpoint', gone);
    return json({ sent, removed: gone.length });
});
