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

  const Controls = {
    formats: {},  // register value formatters by name
    bindAll(root) {
      root = root || document;
      root.querySelectorAll('.seg[data-target], .tilegroup[data-target]').forEach(bindSegment);
      root.querySelectorAll('.sw[data-target]').forEach(bindSwitch);
      root.querySelectorAll('.chips[data-targets]').forEach(bindChips);
      root.querySelectorAll('input[type=range][data-slider]').forEach(bindSlider);
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
    },
  };
  window.Controls = Controls;
})();
