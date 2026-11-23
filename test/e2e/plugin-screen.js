// Runs inside the plugin's screen (injected by the test host through BDB_PLUGIN_TEST_SCRIPT):
// checks the screen shows the project the host gave the plugin, previews it with Play, plays
// a pad, changes a step, loads kits, adds a sample folder, and reports back through the plugin.
(function () {
  const report = { checks: {}, notes: [] };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms = 15000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      try {
        const v = fn();
        if (v) return v;
      } catch {}
      await sleep(100);
    }
    return null;
  };
  const send = (name, args) =>
    new Promise((resolve) => {
      const id = 1e9 + Math.floor(Math.random() * 1e6);
      window.__JUCE__.backend.addEventListener('bdbReply', (r) => {
        if (r.id !== id) return;
        // Results come as base64 JSON (see Editor::reply).
        const decode = (b64) => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))));
        resolve({ ...r, result: r.result64 ? decode(r.result64) : null });
      });
      window.__JUCE__.backend.emitEvent('bdb', { id, name, args });
    });
  const t0 = performance.now();
  const ms = () => Math.round(performance.now() - t0);
  const run = async () => {
    try {
      // How quickly the plugin answers and reports, measured before the screen is busy.
      let early = 0;
      window.__JUCE__.backend.addEventListener('bdbState', () => early++);
      const ask = performance.now();
      const first = await send('getState', {});
      report.checks.getStateMs = Math.round(performance.now() - ask);
      report.checks.hostProjectBpm = first?.result?.project ? JSON.parse(first.result.project).bpm : null;
      report.notes.push(`getState answered at ${ms()} ms`);
      const ready = await until(() => window.__engine && document.querySelector('[data-cell="t1:0"]') && !document.querySelector('.topbar button.play[disabled]'), 30000);
      report.checks.screenStarted = !!ready;
      report.notes.push(`screen ready at ${ms()} ms, ${early} state events so far`, `visibility ${document.visibilityState}`);
      if (!ready) {
        report.notes.push(`url ${location.href}`, `engine ${!!window.__engine}`, `cells ${document.querySelectorAll('.cell').length}`, `body ${document.body?.innerText.slice(0, 300)}`);
        return;
      }
      await sleep(1000);
      const e = window.__engine;
      let states = 0;
      window.__JUCE__.backend.addEventListener('bdbState', () => states++);
      const from = performance.now();
      await sleep(1000);
      report.checks.stateEvents = Math.round((states * 1000) / (performance.now() - from));  // per second
      report.notes.push(`${states} state events in ${Math.round(performance.now() - from)} ms`);
      report.checks.pluginEngine = 'webAudio' in e && typeof e.resend === 'function';
      report.checks.webAudio = e.webAudio;
      // The screen loads the host's project as soon as the plugin answers.
      if (report.checks.hostProjectBpm != null) await until(() => e.current && e.current.bpm === report.checks.hostProjectBpm, 10000);
      report.notes.push(`project shown at ${ms()} ms`);
      const shown = e.current;  // the project the screen sends to the plugin
      report.checks.bpmShown = shown?.bpm ?? null;
      report.checks.trackNames = shown?.tracks.map((t) => t.name).join('|');
      // Play on the screen previews the beat in the plugin while the host is stopped.
      document.querySelector('.topbar button.play').click();
      report.checks.playing = !!(await until(() => e.isPlaying, 5000));
      await sleep(1200);
      report.checks.playheadDrawn = document.querySelectorAll('.cell.play').length;
      report.checks.cycleMoved = e.patternCycle();
      report.checks.metersMoved = Math.max(...e.readMeters(shown.tracks.length).tracks);
      document.querySelector('.topbar button.play').click();
      report.checks.stopped = !!(await until(() => !e.isPlaying, 5000));
      // A step changed on the screen reaches the plugin (and the host's project).
      const cell = document.querySelector('[data-cell="t1:3"]');
      report.checks.stepWasOn = cell.classList.contains('on');
      cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, buttons: 1 }));
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
      await sleep(800);
      report.checks.stepNowOn = document.querySelector('[data-cell="t1:3"]').classList.contains('on');
      // What the plugin now keeps in the host's project.
      const after = await send('getState', {});
      const kept = after?.result?.project ? JSON.parse(after.result.project) : null;
      report.checks.pluginBpm = kept?.bpm ?? null;
      report.checks.pluginStepOn = !!kept?.patterns.find((x) => x.id === kept.currentPatternId)?.lanes.t1?.steps[3]?.on;
      // Kits: from the app's installed copy, the Acoustic Kit, a download, and the app's cache.
      const pickKit = async (name) => {
        window.__lastKit = null;
        const el = document.querySelector('select[aria-label=Kit]');
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, name);
        el.dispatchEvent(new Event('change', { bubbles: true }));
        const k = await until(() => window.__lastKit?.kit === name && window.__lastKit, 60000);
        if (!k) report.notes.push(`${name}: ${document.querySelector('.toast')?.textContent}`);
        return k ? { files: k.samples.length, failed: k.failed, downloaded: k.downloaded, assigned: k.assigned } : null;
      };
      report.checks.kitCount = document.querySelectorAll('select[aria-label=Kit] option').length;
      report.checks.kit808 = await pickKit('RolandTR808');
      // The plugin has every sound of the kit (it reports what it could not find).
      await sleep(1500);
      report.checks.kitInPlugin = e.current.tracks.every((t) => !t.sound.sampleId || t.sound.sampleId.startsWith('user:') || t.sound.sampleId.startsWith('factory:')) && e.pluginMissing?.length === 0;
      const kept808 = JSON.parse((await send('getState', {})).result.project);
      report.checks.kit808Kept = kept808.tracks.filter((t) => kept808.samples[t.sound.sampleId]?.kit === 'RolandTR808').length;
      report.checks.kitAcoustic = await pickKit('AcousticKit');
      report.checks.kitCasio = await pickKit('CasioVL1');
      report.checks.kitCasioAgain = await pickKit('CasioVL1');
      // Sample folders.
      const group = () => document.querySelector('.browser-group.folder');
      [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Add folder'))?.click();
      await until(() => group()?.querySelectorAll('li').length, 10000);
      report.checks.folderFiles = [...(group()?.querySelectorAll('li .name') ?? [])].map((n) => n.textContent).join('|');
      const before = Object.keys(e.current.samples).length;
      const li = [...(group()?.querySelectorAll('li') ?? [])].find((x) => x.textContent.includes('Kicks/Kick 01'));
      li?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await until(() => Object.keys(e.current.samples).length > before, 10000);
      const ref = e.current.samples[e.current.tracks[0].sound.sampleId];
      report.checks.folderAssigned = ref ? `${ref.name} ${ref.source} ${ref.file}` : null;
      const folder = group()?.dataset.folder;
      report.checks.folderOutside = (await send('folderRead', { folder, file: '../outside.wav' })).error ?? 'read';
      report.checks.folderFake = (await send('folderRead', { folder, file: 'Fake.wav' })).error ?? 'read';
      // The screen's settings don't drop the folder.
      await send('settingsSet', { settings: { folders: [], favourites: [], layout: {}, sound: {} } });
      report.checks.folderKept = ((await send('folderList', {})).result ?? []).map((f) => f.files.length).join(',');
      // Saving collects the project's own samples next to it (here, in the sample folder).
      const sep = folder.includes('\\') ? '\\' : '/';
      const saved = await send('saveProject', { text: JSON.stringify({ samples: e.current.samples }), path: `${folder}${sep}Saved.badaboom`, saveAs: false });
      report.checks.savedNotCollected = saved.ok ? saved.result.notCollected.length : saved.error;
      report.checks.pageErrors = (window.__pageErrors ?? []).join(' | ');
    } catch (err) {
      report.error = String(err?.stack ?? err);
    } finally {
      await send('testReport', { report });
    }
  };
  window.__pageErrors = [];
  window.addEventListener('error', (ev) => window.__pageErrors.push(String(ev.message)));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
