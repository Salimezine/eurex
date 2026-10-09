import fs from 'node:fs';
import path from 'node:path';

// KV Cloudflare compatible sur disque : clés "org/<org>/<dossier>/<id>.<ext>"
// deviennent des fichiers sous la racine donnee.
export class KVDisk {
  root: string;

  constructor(root: string) {
    this.root = root;
    fs.mkdirSync(root, { recursive: true });
  }

  private fileFor(key: string): string {
    const clean = key.replace(/\\/g, '/').split('/').map(p => p.replace(/[^\w.\-@]/g, '_')).join(path.sep);
    const full = path.resolve(this.root, clean);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error('Key hors racine');
    return full;
  }

  async put(key: string, value: ArrayBuffer | string | Uint8Array, _opts?: any): Promise<void> {
    const file = this.fileFor(key);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (typeof value === 'string') fs.writeFileSync(file, value, 'utf8');
    else fs.writeFileSync(file, Buffer.from(value instanceof Uint8Array ? value : new Uint8Array(value)));
  }

  async get(key: string, type?: 'text' | 'arrayBuffer' | 'json'): Promise<any> {
    const file = this.fileFor(key);
    if (!fs.existsSync(file)) return null;
    const buf = fs.readFileSync(file);
    if (type === 'arrayBuffer') return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    if (type === 'json') { try { return JSON.parse(buf.toString('utf8')); } catch { return null; } }
    return buf.toString('utf8');
  }

  async delete(key: string): Promise<void> {
    try { fs.unlinkSync(this.fileFor(key)); } catch { /* deja absent */ }
  }

  async list(opts: { prefix?: string } = {}): Promise<{ keys: { name: string }[] }> {
    const keys: { name: string } = [];
    const walk = (dir: string, rel: string) => {
      if (!fs.existsSync(dir)) return;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) walk(path.join(dir, e.name), r);
        else keys.push({ name: r.split(path.sep).join('/') });
      }
    };
    walk(this.root, '');
    const prefix = opts.prefix || '';
    return { keys: keys.filter(k => !prefix || k.name.startsWith(prefix)) };
  }
}
