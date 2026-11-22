// Runs inside the plugin's screen (injected by the test host through BDB_PLUGIN_TEST_SCRIPT):
// checks the screen shows the project the host gave the plugin, previews it with Play, plays
// a pad, changes a step, and reports back through the plugin.
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
      window.__JUCE__.backend.addEventListener('bdbReply', (r) => r.id === id && resolve(r));
      window.__JUCE__.backend.emitEvent('bdb', { id, name, args });
    });
  const run = async () => {
    try {
      const ready = await until(() => window.__engine && document.querySelector('[data-cell="t1:0"]') && !document.querySelector('.topbar button.play[disabled]'), 30000);
      report.checks.screenStarted = !!ready;
      if (!ready) {
        report.notes.push(`url ${location.href}`, `engine ${!!window.__engine}`, `cells ${document.querySelectorAll('.cell').length}`, `body ${document.body?.innerText.slice(0, 300)}`);
        return;
      }
      await sleep(1000);
      const e = window.__engine;
      let states = 0;
      window.__JUCE__.backend.addEventListener('bdbState', () => states++);
      await sleep(500);
      report.checks.stateEvents = states;
      report.checks.pluginEngine = 'webAudio' in e && typeof e.resend === 'function';
      report.checks.webAudio = e.webAudio;
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
