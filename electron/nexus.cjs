const { replaceStateFile } = require('./replace-state-file.cjs');
const fs = require('node:fs');
const path = require('node:path');
const { version } = require('../package.json');
const ENDPOINT = 'https://api.nexusmods.com/v1/users/validate.json';
function validKey(value) {
  return (
    typeof value === 'string' && /^[A-Za-z0-9+/_=.\-]{20,4096}$/.test(value)
  );
}
class NexusAccount {
  constructor(root, storage, request = (...args) => fetch(...args)) {
    this.file = path.join(root, 'nexus.bin');
    this.storage = storage;
    this.request = request;
    this.busy = false;
  }
  available() {
    return (
      this.storage.isEncryptionAvailable() &&
      (process.platform !== 'linux' ||
        this.storage.getSelectedStorageBackend() !== 'basic_text')
    );
  }
  read() {
    if (!this.available())
      throw new Error('Protected credential storage is unavailable.');
    if (!fs.existsSync(this.file)) return null;
    try {
      if (fs.statSync(this.file).size > 20000) throw new Error();
      const saved = JSON.parse(
        this.storage.decryptString(fs.readFileSync(this.file)),
      );
      if (
        saved.schemaVersion !== 1 ||
        !validKey(saved.key) ||
        typeof saved.name !== 'string' ||
        saved.name.length > 200 ||
        typeof saved.premium !== 'boolean' ||
        !Number.isFinite(Date.parse(saved.verifiedAt))
      )
        throw new Error();
      return saved;
    } catch {
      throw new Error(
        'The saved Nexus connection cannot be opened. Disconnect it and reconnect on this Windows account.',
      );
    }
  }
  status() {
    try {
      const saved = this.read();
      return {
        available: true,
        connected: Boolean(saved),
        name: saved?.name || null,
        premium: saved?.premium ?? null,
        verifiedAt: saved?.verifiedAt || null,
        error: null,
      };
    } catch (error) {
      return {
        available: this.available(),
        connected: false,
        name: null,
        premium: null,
        verifiedAt: null,
        error: error.message,
      };
    }
  }
  async validate(key) {
    let response;
    try {
      response = await this.request(ENDPOINT, {
        headers: {
          apikey: key,
          'Application-Name': 'Loadstone',
          'Application-Version': version,
          Accept: 'application/json',
        },
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new Error(
        'Could not reach Nexus Mods. Check your connection and try again.',
      );
    }
    if ([401, 403].includes(response.status))
      throw new Error(
        'Nexus rejected this API key. Generate a valid key and reconnect.',
      );
    if (response.status === 429)
      throw new Error(
        'Nexus request limit reached. Wait before checking the connection again.',
      );
    if (!response.ok)
      throw new Error('Nexus Mods is unavailable. Try again later.');
    try {
      let bytes = 0,
        chunks = [];
      for await (const chunk of response.body) {
        bytes += chunk.length;
        if (bytes > 64000) throw new Error();
        chunks.push(Buffer.from(chunk));
      }
      const info = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (
        typeof info.name !== 'string' ||
        info.name.length > 200 ||
        !info.name.trim() ||
        /[\x00-\x1f]/.test(info.name) ||
        typeof info.is_premium !== 'boolean'
      )
        throw new Error();
      return {
        schemaVersion: 1,
        key,
        name: info.name,
        premium: info.is_premium,
        verifiedAt: new Date().toISOString(),
      };
    } catch {
      throw new Error(
        'Nexus returned an invalid account response. Try again later.',
      );
    }
  }
  async connect(input) {
    if (this.busy) throw new Error('An account check is already running.');
    const key = typeof input === 'string' ? input.trim() : input;
    if (!validKey(key)) throw new Error('Enter a valid Nexus API key.');
    if (!this.available())
      throw new Error('Protected credential storage is unavailable.');
    this.busy = true;
    try {
      const saved = await this.validate(key);
      try {
        const encrypted = this.storage.encryptString(JSON.stringify(saved));
        fs.writeFileSync(this.file + '.tmp', encrypted, {
          flush: true,
          mode: 0o600,
        });
        replaceStateFile(this.file + '.tmp', this.file);
      } catch {
        throw new Error(
          'Could not save the protected Nexus connection. Check available disk space and workspace access.',
        );
      }
      return this.status();
    } finally {
      this.busy = false;
    }
  }
  async verify() {
    const saved = this.read();
    if (!saved) throw new Error('Connect your Nexus account in Settings.');
    return this.connect(saved.key);
  }
  disconnect() {
    if (this.busy)
      throw new Error(
        'Wait for the account check to finish before disconnecting.',
      );
    for (const file of [this.file, this.file + '.tmp'])
      if (fs.existsSync(file)) fs.unlinkSync(file);
    return this.status();
  }
}
module.exports = { NexusAccount, ENDPOINT };
