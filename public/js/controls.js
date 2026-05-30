// Compact-control toolkit. Visual controls sync to hidden canonical inputs
// (the existing <select>/<input>/<checkbox> elements), which remain the source
// of truth for collectConfig/generateLinks/autosave/restore.
(function () {
  function fire(el, type) { el.dispatchEvent(new Event(type, { bubbles: true })); }

  // Segment / tiles: pick-one. container[data-target="#id"], children [data-val]
  function bindSegment(container) {
    const target = document.querySelector(container.getAttribute('data-target'));
    if (!target) return;
    container.querySelectorAll('[data-val]').forEach(btn => {
      btn.addEventListener('click', () => {
        target.value = btn.getAttribute('data-val');
        fire(target, 'change');
        syncSegment(container);
      });
    });
    syncSegment(container);
  }
  function syncSegment(container) {
    const target = document.querySelector(container.getAttribute('data-target'));
    if (!target) return;
    container.querySelectorAll('[data-val]').forEach(btn =>
      btn.classList.toggle('on', btn.getAttribute('data-val') === target.value));
  }

  // Switch tile: boolean. el[data-target="#id"] -> a checkbox input
  function bindSwitch(el) {
    const target = document.querySelector(el.getAttribute('data-target'));
    if (!target) return;
    el.addEventListener('click', () => {
      target.checked = !target.checked;
      fire(target, 'change');
      syncSwitch(el);
    });
    syncSwitch(el);
  }
  function syncSwitch(el) {
    const target = document.querySelector(el.getAttribute('data-target'));
    if (!target) return;
    el.classList.toggle('on', !!target.checked);
  }

  // Chips multi: container[data-targets] where each chip[data-target="#id"] is a checkbox
  function bindChips(container) {
    container.querySelectorAll('[data-target]').forEach(chip => {
      const target = document.querySelector(chip.getAttribute('data-target'));
      if (!target) return;
      chip.addEventListener('click', () => {
        target.checked = !target.checked;
        fire(target, 'change');
        chip.classList.toggle('on', target.checked);
      });
      chip.classList.toggle('on', !!target.checked);
    });
  }

  // Slider: input[type=range] is canonical; helper just updates a label.
  function bindSlider(range) {
    const labelSel = range.getAttribute('data-label');
    const label = labelSel ? document.querySelector(labelSel) : null;
    const fmtName = range.getAttribute('data-format');
    const fmt = (fmtName && Controls.formats[fmtName]) || (v => v);
    const update = () => { if (label) label.textContent = fmt(range.value); };
    range.addEventListener('input', update);
    update();
  }

  function bindRadioSegSync(container) {
    const name = container.getAttribute('data-radio');
    const radios = document.querySelectorAll(`input[name="${name}"]`);
    container.querySelectorAll('[data-val]').forEach(b => {
      const r = [...radios].find(x => x.value === b.getAttribute('data-val'));
      b.classList.toggle('on', !!(r && r.checked));
    });
  }
  function bindRadioSeg(container) {
    const name = container.getAttribute('data-radio');
    const radios = document.querySelectorAll(`input[name="${name}"]`);
    container.querySelectorAll('[data-val]').forEach(btn => btn.addEventListener('click', () => {
      const r = [...radios].find(x => x.value === btn.getAttribute('data-val'));
      if (r) { r.checked = true; fire(r, 'change'); }
      bindRadioSegSync(container);
    }));
    bindRadioSegSync(container);
  }
  function bindSliderToSelect(range) {
    const sel = document.querySelector(range.getAttribute('data-select'));
    if (!sel) return;
    const opts = [...sel.options].map(o => o.value);
    const label = document.querySelector(range.getAttribute('data-label'));
    range.min = 0; range.max = opts.length - 1; range.step = 1;
    range.value = Math.max(0, opts.indexOf(sel.value));
    const update = () => {
      sel.value = opts[range.value]; fire(sel, 'change');
      if (label) label.textContent = sel.options[range.value].textContent;
    };
    range.addEventListener('input', update); update();
  }
  function syncSliderToSelect(range) {
    const sel = document.querySelector(range.getAttribute('data-select'));
    if (!sel) return;
    const opts = [...sel.options].map(o => o.value);
    range.value = Math.max(0, opts.indexOf(sel.value));
    const label = document.querySelector(range.getAttribute('data-label'));
    if (label) label.textContent = sel.options[range.value] ? sel.options[range.value].textContent : '';
  }

  const Controls = {
    formats: {},  // register value formatters by name
    bindAll(root) {
      root = root || document;
      root.querySelectorAll('.seg[data-target], .tilegroup[data-target]').forEach(bindSegment);
      root.querySelectorAll('.sw[data-target]').forEach(bindSwitch);
      root.querySelectorAll('.chips[data-targets]').forEach(bindChips);
      root.querySelectorAll('input[type=range][data-slider]').forEach(bindSlider);
      root.querySelectorAll('.seg[data-radio]').forEach(bindRadioSeg);
      root.querySelectorAll('input[type=range][data-select]').forEach(bindSliderToSelect);
    },
    syncAll(root) {
      root = root || document;
      root.querySelectorAll('.seg[data-target], .tilegroup[data-target]').forEach(syncSegment);
      root.querySelectorAll('.sw[data-target]').forEach(syncSwitch);
      root.querySelectorAll('.chips[data-targets] [data-target]').forEach(chip => {
        const t = document.querySelector(chip.getAttribute('data-target'));
        if (t) chip.classList.toggle('on', !!t.checked);
      });
      root.querySelectorAll('input[type=range][data-slider]').forEach(r => fire(r, 'input'));
      root.querySelectorAll('.seg[data-radio]').forEach(bindRadioSegSync);
      root.querySelectorAll('input[type=range][data-select]').forEach(syncSliderToSelect);
    },
  };
  window.Controls = Controls;
})();
