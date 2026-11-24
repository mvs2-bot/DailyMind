/* Streak – gemeinsame Schnittstelle und Anzeige für alle Seiten im Supabase-Core-Projekt.
   Original im Repo mvs2-bot.github.io (shared/streak.js + streak.css); DailyMind hat eine identische Kopie.
   Gerechnet wird nur auf dem Server (Migrationen …_streak im Repo supabase-core, Regeln in docs/STREAK.md).
   Hier: Daten holen/melden (mit localStorage nur als Cache) und darstellen. Kein Framework nötig.

   Benutzung (supabase-js geladen, Nutzer angemeldet, shared/streak.css eingebunden):
     Streak.log(sb, 'meineapp', 'aktion')   Aktivität melden (Regel muss in streak_rules stehen)
     Streak.status(sb, app)                 Stand abrufen; enabled = persönlicher Schalter dieser App
     Streak.cached(userId)                  letzter Stand aus dem Cache (sofort, auch offline)
     Streak.chip(el, st, sb)                kompakte Anzeige (Flamme + Zahl) in el, Klick öffnet Details;
                                            wird heute erstmals erfüllt: Animation, bei Meilenstein/Freeze Meldung
     Streak.detail(st, sb)                  Detailansicht als Dialog
   Beide Aufrufe liefern den Stand: { current, best, last_day, freezes, today, tz, today_done, at_risk, missed,
   days: [{ d, f, r?, apps }], enabled?, new_day?, earned_freeze?, counted?, next_freeze_in?, repair?, repaired? }.
   repair = { prev, missed }: Serie gerissen, heute Morgen + Abend speichern holt sie zurück (r = durch Reparatur
   überbrückter Tag, dann auch f). Fehlen die neuen Felder (Migration noch nicht live), wird ohne sie angezeigt.
     Streak.nextFreeze(st)                  Tage bis zum nächsten Freeze oder null (Vorrat voll / keine Serie)
     Streak.repairText(st)                  Hinweis zur Reparatur oder '' (z. B. für eigene Hinweiskarten)
   Aussehen über die CSS-Variablen der Seite (--card, --ink, --mute, --well, --p1, --star). */
(function () {
    const TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { return null; } })();
    const MILESTONES = [3, 7, 14, 30, 50, 100, 200, 365, 500, 1000];
    const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
    const FLAME = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22c4 0 7-2.7 7-6.8 0-3.6-2.4-6.1-4.2-8.2-.6 2-1.6 3.2-2.8 3.7.2-3.2-1.2-6.4-4-8.7-.2 3.6-3 6.3-3 10.6C5 19.3 8 22 12 22z"/><path d="M12 22c-1.7 0-3-1.2-3-3 0-1.8 1.6-3 2.2-4.6 1.4 1 3.8 2.6 3.8 4.6 0 1.8-1.3 3-3 3z"/></svg>';
    const SNOW = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2v20M4 7l16 10M4 17 20 7M9 3l3 3 3-3M9 21l3-3 3 3"/></svg>';
    const REPAIR = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>';
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const check = ({ data, error }) => { if (error) throw error; return data; };
    const tage = n => n === 1 ? '1 Tag' : n + ' Tage';

    /* ---------- Daten ---------- */
    let uid = null;
    const key = id => 'streak:' + id;
    function save(st) { try { if (uid) localStorage.setItem(key(uid), JSON.stringify(st)); } catch (e) {} return st; }
    function cached(id) { uid = id || uid; try { return JSON.parse(localStorage.getItem(key(uid))); } catch (e) { return null; } }
    async function who(sb) { if (!uid) { const { data } = await sb.auth.getSession(); uid = data.session && data.session.user.id; } }

    async function log(sb, app, kind) {
        await who(sb);
        return save(check(await sb.rpc('streak_log', { p_app: app, p_kind: kind, p_tz: TZ })));
    }
    async function status(sb, app) {
        await who(sb);
        return save(check(await sb.rpc('streak_status', { p_tz: TZ, p_app: app || null })));
    }

    /* ---------- Berechnungen nur für die Anzeige ---------- */
    const toUtc = d => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
    const iso = t => new Date(t).toISOString().slice(0, 10);
    const addDays = (d, n) => iso(toUtc(d) + n * 864e5);
    // Montag der Woche von d
    const monday = d => addDays(d, -((new Date(toUtc(d)).getUTCDay() + 6) % 7));
    const dayMap = st => Object.fromEntries((st.days || []).map(x => [x.d, x]));
    const nextMilestone = n => MILESTONES.find(m => m > n);
    const dayCls = x => x ? (x.r ? 'repaired' : x.f ? 'frozen' : 'on') : '';
    const dayIcon = x => x ? (x.r ? REPAIR : x.f ? SNOW : FLAME) : '';
    const dayLabel = x => x ? (x.r ? ' · repariert' : x.f ? ' · Freeze' : ' · aktiv') : '';
    // Reparatur offen? (Feld fehlt bis zur Migration → nie)
    const repairOpen = st => !!(st && st.repair && st.repair.prev && !st.repaired);

    // Tage bis zum nächsten Freeze: vom Server, sonst nach Regel 7 geschätzt (je 7 Tage, höchstens 2)
    function nextFreeze(st) {
        if (!st) return null;
        if ('next_freeze_in' in st) return st.next_freeze_in ?? null;
        return st.current && st.freezes < 2 ? 7 - st.current % 7 : null;
    }
    function repairText(st) {
        if (!repairOpen(st)) return '';
        return `Mach heute Morgen + Abend und hol dir deine Serie von ${tage(st.repair.prev)} zurück.`;
    }

    function stateOf(st) {
        if (repairOpen(st) && !st.today_done) return 'risk';
        if (!st || !st.current) return 'off';
        return st.today_done ? 'done' : 'risk';
    }
    function line(st) {
        if (!st) return 'Lädt …';
        if (st.repaired) return `Serie repariert: ${tage(st.current)} in Folge!`;
        if (repairOpen(st)) return st.today_done ? `Schließ heute beide Routinen ab, dann sind deine ${tage(st.repair.prev)} zurück.` : 'Serie gerissen, aber heute noch zu retten.';
        if (st.today_done) return st.current === 1 ? 'Heute geschafft. Neue Serie gestartet!' : 'Heute geschafft. Bis morgen!';
        if (st.current) return st.missed ? `Gestern verpasst: heute aktiv sein, ein Freeze rettet die Serie.` : 'Heute noch offen: halte deine Serie.';
        return st.best ? 'Serie gerissen. Starte heute eine neue.' : 'Starte heute deine erste Serie.';
    }

    /* ---------- Darstellung ---------- */
    const shown = new WeakMap();   // el → { st, sb } zuletzt angezeigt
    function chip(el, st, sb) {
        const was = shown.get(el) && shown.get(el).st;
        shown.set(el, { st, sb });
        const s = stateOf(st), n = st ? st.current : 0;
        el.classList.remove('off', 'done', 'risk', 'bump');
        el.classList.add('streak-chip', s);
        el.innerHTML = FLAME + '<b>' + n + '</b>';
        el.title = st ? `${tage(n)} Serie · ${line(st)}` : 'Streak';
        el.setAttribute('aria-label', `Streak: ${tage(n)}. ${st ? line(st) : ''}`);
        if (!el.dataset.streakBound) { el.dataset.streakBound = '1'; el.addEventListener('click', e => { e.preventDefault(); detail(shown.get(el).st, shown.get(el).sb); }); }
        if (was && st && was.today === st.today) {
            if (st.repaired && !was.repaired) celebrate(el, st, false, true);
            else if (!was.today_done && st.today_done) celebrate(el, st, st.freezes > was.freezes);
        }
    }

    function week(st) {
        const map = dayMap(st), mon = monday(st.today);
        return '<div class="streak-week">' + WEEKDAYS.map((w, i) => {
            const d = addDays(mon, i), x = map[d];
            const cls = x ? dayCls(x) : d > st.today ? 'future' : '';
            return `<div class="${cls}${d === st.today ? ' today' : ''}"><span>${w}</span><i>${dayIcon(x)}</i></div>`;
        }).join('') + '</div>';
    }

    // Letzte 10 Wochen als Raster (Spalte = Woche, Zeile = Wochentag)
    function heat(st) {
        const map = dayMap(st), start = addDays(monday(st.today), -63);
        let cells = '';
        for (let i = 0; i < 70; i++) {
            const d = addDays(start, i), x = map[d];
            const cls = x ? dayCls(x) : d > st.today ? 'future' : '';
            cells += `<i class="${cls}" title="${new Date(toUtc(d)).toLocaleDateString('de-DE', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' })}${dayLabel(x)}"></i>`;
        }
        return '<div class="streak-heat">' + cells + '</div>';
    }

    let dlg = null;
    async function detail(st, sb) {
        if (!st) return;
        if (!dlg) {
            dlg = document.createElement('dialog');
            dlg.className = 'streak-dlg';
            dlg.setAttribute('aria-label', 'Streak');
            dlg.addEventListener('click', e => { if (e.target === dlg || e.target.closest('[data-close]')) dlg.close(); });
            document.body.appendChild(dlg);
        }
        const next = nextMilestone(st.current);
        const active = (st.days || []).filter(x => !x.f).length;
        const nf = nextFreeze(st);
        const freezeLine = nf ? `Nächster Freeze in ${tage(nf)}` : st.freezes >= 2 ? 'Vorrat voll' : 'Ab 7 Tagen Serie';
        const repBox = repairOpen(st) ? `
            <div class="streak-repair">${REPAIR}<p><b>Serie retten</b>${esc(repairText(st))}
            <small>${st.repair.missed === 1 ? '1 verpasster Tag wird' : `${st.repair.missed} verpasste Tage werden`} überbrückt. Geht einmal in 30 Tagen.</small></p></div>` : '';
        dlg.innerHTML = `
            <button class="streak-x" type="button" data-close aria-label="Schließen"><svg class="ic" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
            <div class="streak-hero ${stateOf(st)}">${FLAME}<div><b>${tage(st.current)}</b><small>${esc(line(st))}</small></div></div>
            ${repBox}
            ${week(st)}
            <div class="streak-stats">
                <div><b>${st.best}</b><small>Rekord</small></div>
                <div title="${esc(freezeLine)}"><b>${SNOW}${st.freezes}/2</b><small>Freezes</small></div>
                <div><b>${active}</b><small>Aktiv (10 Wo.)</small></div>
            </div>
            <p class="streak-freeze">${SNOW}${esc(freezeLine)}</p>
            ${next ? `<div class="streak-next"><small>Noch ${tage(next - st.current)} bis ${next}</small><span><i style="width:${Math.round(st.current / next * 100)}%"></i></span></div>` : ''}
            <h3>Letzte 10 Wochen</h3>
            ${heat(st)}
            <p class="streak-note">Ein Tag zählt, sobald du eine dieser Aktivitäten machst: <span data-rules>…</span>.
            Je 7 Tage Serie gibt es einen Freeze (höchstens 2). Er überbrückt einen verpassten Tag automatisch.
            Reißt die Serie trotzdem (1–3 Tage verpasst), holst du sie mit Morgen- und Abendroutine am selben Tag zurück, einmal in 30 Tagen.</p>`;
        if (!dlg.open) dlg.showModal();
        if (sb) {
            try {
                const rules = check(await sb.from('streak_rules').select('label').eq('active', true).order('app'));
                dlg.querySelector('[data-rules]').textContent = rules.map(r => r.label).join(', ') || 'keine Regel aktiv';
            } catch (e) { dlg.querySelector('[data-rules]').textContent = 'Regeln gerade nicht abrufbar'; }
        }
    }

    // Erfolgsmeldung: Reparatur, Meilensteine, neuer Freeze, sonst nur kurze Animation am Chip
    function celebrate(el, st, freeze, repaired) {
        el.classList.add('bump');
        const text = repaired ? `Serie repariert: ${tage(st.current)}!`
            : MILESTONES.includes(st.current) ? `${tage(st.current)} in Folge!`
            : freeze ? 'Streak-Freeze verdient' : null;
        if (!text) return;
        const t = document.createElement('div');
        t.className = 'streak-toast' + (repaired ? ' big' : '');
        t.setAttribute('role', 'status');
        t.innerHTML = (repaired ? REPAIR : freeze && !MILESTONES.includes(st.current) ? SNOW : FLAME) + esc(text);
        document.body.appendChild(t);
        setTimeout(() => t.remove(), repaired ? 4600 : 3600);
    }

    window.Streak = { log, status, cached, chip, detail, line, week, nextFreeze, repairText };
})();
