// Web: react-native-web hat kein funktionierendes Alert; eigener, barrierearmer Dialog im DOM.
function open(title: string, message: string, buttons: { text: string; primary?: boolean; danger?: boolean; value: boolean }[]) {
  return new Promise<boolean>((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.setAttribute('style', 'position:fixed;inset:0;background:rgba(10,20,35,.5);display:flex;align-items:center;justify-content:center;padding:16px;z-index:9999;font-family:system-ui,sans-serif');
    const box = document.createElement('div');
    box.setAttribute('role', 'alertdialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('style', 'background:#fff;color:#13202E;border-radius:16px;max-width:360px;width:100%;padding:20px;display:flex;flex-direction:column;gap:12px;box-shadow:0 10px 40px rgba(0,0,0,.3)');
    const h = document.createElement('div');
    h.textContent = title;
    h.setAttribute('style', 'font-size:20px;font-weight:800');
    const p = document.createElement('div');
    p.textContent = message;
    p.setAttribute('style', 'font-size:16px;line-height:1.45;color:#3c4a5a');
    const row = document.createElement('div');
    row.setAttribute('style', 'display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:4px');
    const close = (v: boolean) => {
      backdrop.remove();
      resolve(v);
    };
    for (const b of buttons) {
      const btn = document.createElement('button');
      btn.textContent = b.text;
      const bg = b.danger ? '#B42318' : b.primary ? '#123D6B' : '#fff';
      btn.setAttribute('style', `min-height:48px;padding:0 18px;border-radius:12px;font-size:16px;font-weight:800;cursor:pointer;border:2px solid ${b.danger ? '#B42318' : '#123D6B'};background:${bg};color:${b.danger || b.primary ? '#fff' : '#123D6B'}`);
      btn.onclick = () => close(b.value);
      row.appendChild(btn);
    }
    box.append(h, p, row);
    backdrop.appendChild(box);
    backdrop.addEventListener('keydown', (e) => e.key === 'Escape' && close(false));
    document.body.appendChild(backdrop);
    (row.lastElementChild as HTMLButtonElement | null)?.focus();
  });
}

export function showMessage(title: string, message: string): void {
  void open(title, message, [{ text: 'OK', primary: true, value: true }]);
}

export function confirmAction(opts: { title: string; message: string; confirmText: string; destructive?: boolean }): Promise<boolean> {
  return open(opts.title, opts.message, [
    { text: 'Abbrechen', value: false },
    { text: opts.confirmText, danger: opts.destructive, primary: !opts.destructive, value: true },
  ]);
}
