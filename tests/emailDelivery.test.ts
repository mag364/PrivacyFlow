import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const code = buildSync({ entryPoints: ['electron/main.ts'], bundle: true, platform: 'node', format: 'cjs', external: ['electron'], write: false }).outputFiles[0].text;
const tempDirs: string[] = [];
afterEach(() => tempDirs.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true })));
function handlers(fail = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'privacyflow-mail-test-')); tempDirs.push(root);
  const callbacks = new Map<string, Function>();
  let payload: any;
  let script = '';
  let payloadPath = '';
  const fetch = vi.fn().mockResolvedValue({ ok: true });
  const openExternal = vi.fn().mockResolvedValue(true);
  runInNewContext(code, {
    require(name: string) {
      if (name === 'electron') return {
        app: { isPackaged: true, getPath: () => root, whenReady: () => new Promise(() => {}), on: () => {} },
        ipcMain: { handle: (name: string, fn: Function) => callbacks.set(name, fn), on: () => {} },
        shell: { openExternal },
      };
      if (name === 'node:child_process') return { execFile(_command: string, args: string[], _options: unknown, done: Function) {
        script = args[args.length - 1];
        const encoded = script.match(/FromBase64String\('([^']+)'\)/)![1];
        payloadPath = Buffer.from(encoded, 'base64').toString('utf8');
        payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
        done(fail ? new Error('Test Outlook failure') : null, fail ? '' : 'PRIVACYFLOW_DRAFT_OPENED', '');
      } };
      return require(name);
    },
    process: { ...process, platform: 'win32', env: { ...process.env, PRIVACYFLOW_WORKSPACE: path.join(root, 'workspace.json') } },
    Buffer, console, fetch, URL, URLSearchParams, setTimeout, clearTimeout, setInterval, clearInterval,
    __dirname: path.resolve('build/electron'), exports: {}, module: { exports: {} },
  });
  return { call: (name: string, input: object) => callbacks.get(name)!(null, input), fetch, openExternal,
    captured: () => ({ payload, script, payloadPath }) };
}
const input = { to: 'to@example.test', cc: 'cc@example.test', subject: 'Formatted', body: 'Hello',
  bodyHtml: '<p><b>Hello</b></p><img src="data:image/png;base64,' + 'YWFh'.repeat(10000) + '">' };

describe('desktop email delivery handlers', () => {
  it('hands HTML and CID images to Outlook via a short command and cleans temporary files', async () => {
    const app = handlers();
    expect(await app.call('outlook:openDraft', input)).toBe(true);
    const { payload, script, payloadPath } = app.captured();
    expect(payload.bodyHtml).toContain('cid:privacyflow-image-1@inline');
    expect(payload.images[0].contentBytes.length).toBe(40000);
    expect(payload.cc).toBe('cc@example.test');
    expect(script).toContain('$mail.HTMLBody = [string]$input.bodyHtml');
    expect(script).toContain('0x3712001F');
    expect(script.length).toBeLessThan(8000);
    expect(fs.existsSync(payloadPath)).toBe(false);
  });
  it('cleans payload files even when Outlook fails', async () => {
    const app = handlers(true);
    await expect(app.call('outlook:openDraft', input)).rejects.toThrow('Test Outlook failure');
    expect(fs.existsSync(app.captured().payloadPath)).toBe(false);
  });
  it('sends HTML with inline attachments and Cc through Graph', async () => {
    const app = handlers();
    await app.call('graph:sendMail', { ...input, accessToken: 'test' });
    const message = JSON.parse(app.fetch.mock.calls[0][1].body).message;
    expect(message.body.contentType).toBe('HTML');
    expect(message.body.content).toContain('cid:privacyflow-image-1@inline');
    expect(message.attachments[0]).toMatchObject({ '@odata.type': '#microsoft.graph.fileAttachment', contentId: 'privacyflow-image-1@inline', isInline: true });
    expect(message.ccRecipients[0].emailAddress.address).toBe('cc@example.test');
  });
  it('uses the readable plain-text body and Cc for mailto fallback', async () => {
    const app = handlers();
    await app.call('mail:openDraft', input);
    const url = new URL(app.openExternal.mock.calls[0][0]);
    expect(url.searchParams.get('body')).toBe('Hello');
    expect(url.searchParams.get('cc')).toBe('cc@example.test');
  });
});
