import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import Quill from 'quill';
import 'quill/dist/quill.snow.css';
import './emailEditor.css';
import { sanitizeEmailHtml } from '../../lib/emailHtml';

const font = Quill.import('attributors/style/font') as { whitelist: string[] };
font.whitelist = ['Arial', 'Calibri', 'Georgia', 'Tahoma', 'Times New Roman', 'Verdana'];
Quill.register('formats/font', font, true);
const size = Quill.import('attributors/style/size') as { whitelist: string[] };
size.whitelist = ['12px', '14px', '15px', '16px', '18px', '24px', '32px'];
Quill.register('formats/size', size, true);
Quill.register('formats/align', Quill.import('attributors/style/align'), true);

export interface EmailBodyEditorHandle { insertText: (text: string) => void }
export const EmailBodyEditor = forwardRef<EmailBodyEditorHandle, { value: string; onChange: (html: string) => void }>(function EmailBodyEditor({ value, onChange }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const quill = useRef<Quill | null>(null);
  const change = useRef(onChange);
  change.current = onChange;
  const selection = useRef({ index: 0, length: 0 });
  const initial = useRef(value);
  const [source, setSource] = useState(false);
  const [code, setCode] = useState(value);
  const [error, setError] = useState('');
  const sourceInput = useRef<HTMLTextAreaElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const container = document.createElement('div');
    host.current!.appendChild(container);
    const editor = new Quill(container, {
      theme: 'snow',
      modules: {
        toolbar: [[{ header: [false, 1, 2, 3] }, { font: [false, ...font.whitelist] }, { size: [false, ...size.whitelist] }],
          ['bold', 'italic', 'underline', 'strike'], [{ color: [] }, { background: [] }],
          [{ list: 'ordered' }, { list: 'bullet' }, { align: [] }], ['link', 'image', 'clean']],
        history: { userOnly: true },
      },
    });
    quill.current = editor;
    editor.clipboard.dangerouslyPasteHTML(sanitizeEmailHtml(initial.current), 'silent');
    editor.history.clear();
    editor.root.setAttribute('aria-label', 'Email body');
    editor.root.setAttribute('role', 'textbox');
    editor.root.setAttribute('aria-multiline', 'true');
    const toolbar = editor.getModule('toolbar') as { addHandler: (name: string, handler: () => void) => void };
    toolbar.addHandler('image', () => imageInput.current?.click());
    const onText = () => change.current(sanitizeEmailHtml(editor.getSemanticHTML()));
    const onSelection = (range: { index: number; length: number } | null) => { if (range) selection.current = range; };
    editor.on('text-change', onText);
    editor.on('selection-change', onSelection);
    host.current!.querySelectorAll('button').forEach(button => {
      const name = Array.from(button.classList).find(c => c.startsWith('ql-'))?.slice(3) ?? 'Format';
      const label = name === 'image' ? 'Insert image' : `${name}${button.value ? ` ${button.value}` : ''}`;
      button.type = 'button'; button.title = label; button.setAttribute('aria-label', label);
    });
    host.current!.querySelectorAll('.ql-picker-label').forEach(label => {
      const name = Array.from(label.parentElement!.classList).find(c => c.startsWith('ql-') && c !== 'ql-picker')?.slice(3) ?? 'Format';
      label.setAttribute('aria-label', name);
    });
    return () => { editor.off('text-change', onText); editor.off('selection-change', onSelection); quill.current = null; host.current?.replaceChildren(); };
  }, []);

  useImperativeHandle(ref, () => ({ insertText(text) {
    if (source) {
      const start = sourceInput.current?.selectionStart ?? code.length;
      const end = sourceInput.current?.selectionEnd ?? start;
      const next = code.slice(0, start) + text + code.slice(end);
      setCode(next); change.current(next);
      requestAnimationFrame(() => { sourceInput.current?.focus(); sourceInput.current?.setSelectionRange(start + text.length, start + text.length); });
      return;
    }
    const editor = quill.current!;
    const range = selection.current;
    editor.deleteText(range.index, range.length, 'user');
    editor.insertText(range.index, text, 'user');
    editor.setSelection(range.index + text.length, 0);
  } }), [source, code]);

  function toggleSource() {
    if (source) {
      const clean = sanitizeEmailHtml(code);
      quill.current!.clipboard.dangerouslyPasteHTML(clean, 'user');
      change.current(sanitizeEmailHtml(quill.current!.getSemanticHTML()));
    } else setCode(sanitizeEmailHtml(quill.current!.getSemanticHTML()));
    setSource(!source);
  }

  async function addImage(file?: File) {
    if (!file) return;
    setError('');
    if (!['image/png', 'image/jpeg', 'image/gif'].includes(file.type) || file.size > 2 * 1024 * 1024) {
      setError('Choose a PNG, JPEG, or GIF image up to 2 MB.'); return;
    }
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file);
      });
      if (quill.current!.getSemanticHTML().length + data.length > 8 * 1024 * 1024) { setError('Keep the template and its images under 8 MB.'); return; }
      const editor = quill.current!;
      const index = selection.current.index;
      editor.insertEmbed(index, 'image', data, 'user');
      editor.formatText(index, 1, { width: '400', alt: file.name }, 'user');
      editor.setSelection(index + 1, 0);
    } catch { setError('Unable to read the image.'); }
  }

  return <div className="pf-email-editor">
    <div className="mb-2 flex flex-wrap gap-2">
      <button type="button" className="pf-editor-button" disabled={source} onClick={() => quill.current?.history.undo()} aria-label="Undo">↶ Undo</button>
      <button type="button" className="pf-editor-button" disabled={source} onClick={() => quill.current?.history.redo()} aria-label="Redo">↷ Redo</button>
      <button type="button" className="pf-editor-button" onClick={toggleSource} aria-pressed={source}>{source ? 'Visual editor' : '</> HTML source'}</button>
    </div>
    <div ref={host} hidden={source} />
    {source && <textarea ref={sourceInput} aria-label="Email HTML source" className="min-h-[260px] w-full rounded-lg border border-line bg-surface p-3 font-mono text-sm text-ink" value={code} onChange={e => { setCode(e.target.value); change.current(e.target.value); }} />}
    <input ref={imageInput} type="file" accept="image/png,image/jpeg,image/gif" className="hidden" aria-label="Upload email image" onChange={e => { void addImage(e.target.files?.[0]); e.target.value = ''; }} />
    {error && <p role="alert" className="mt-2 text-sm text-red-400">{error}</p>}
    <p className="mt-2 text-xs text-muted">Insert PNG, JPEG, or GIF images up to 2 MB each. Uploaded images are embedded in Outlook drafts. HTML source supports email formatting; scripts and unsupported content are removed.</p>
  </div>;
});
