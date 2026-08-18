// A tiny SFTP server for the test. It serves /tmp/seedbox read-only.
import ssh2 from "ssh2";
const { Server, utils } = ssh2;
import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ROOT = "/tmp/seedbox";
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
  publicKeyEncoding: { type: "pkcs1", format: "pem" },
});

const OPEN_MODE = utils.sftp.OPEN_MODE;
const STATUS_CODE = utils.sftp.STATUS_CODE;

const real = (p) => path.join(ROOT, path.normalize("/" + p));

const attrs = (st) => ({
  mode: st.mode,
  uid: 0, gid: 0,
  size: st.size,
  atime: Math.floor(st.atimeMs / 1000),
  mtime: Math.floor(st.mtimeMs / 1000),
});

new Server({ hostKeys: [privateKey] }, (client) => {
  client.on("authentication", (ctx) => {
    if (ctx.method === "password" && ctx.username === "torrent" && ctx.password === "secret") ctx.accept();
    else ctx.reject(["password"]);
  });

  client.on("ready", () => {
    client.on("session", (acceptSession) => {
      const session = acceptSession();
      session.on("sftp", (acceptSftp) => {
        const sftp = acceptSftp();
        const dirs = new Map();
        const files = new Map();
        let next = 0;
        const handle = () => { const b = Buffer.alloc(4); b.writeUInt32BE(next++, 0); return b; };

        sftp.on("REALPATH", (id, p) => {
          const resolved = p === "." ? "/" : path.normalize(p);
          sftp.name(id, [{ filename: resolved, longname: resolved, attrs: {} }]);
        });

        sftp.on("STAT", (id, p) => statLike(id, p));
        sftp.on("LSTAT", (id, p) => statLike(id, p));
        function statLike(id, p) {
          try { sftp.attrs(id, attrs(fs.statSync(real(p)))); }
          catch { sftp.status(id, STATUS_CODE.NO_SUCH_FILE); }
        }

        sftp.on("OPENDIR", (id, p) => {
          try {
            const entries = fs.readdirSync(real(p));
            const h = handle();
            dirs.set(h.readUInt32BE(0), { p, entries, sent: false });
            sftp.handle(id, h);
          } catch { sftp.status(id, STATUS_CODE.NO_SUCH_FILE); }
        });

        sftp.on("READDIR", (id, h) => {
          const state = dirs.get(h.readUInt32BE(0));
          if (!state || state.sent) return sftp.status(id, STATUS_CODE.EOF);
          state.sent = true;
          const list = state.entries.map((name) => {
            const st = fs.statSync(path.join(real(state.p), name));
            return { filename: name, longname: `${st.isDirectory() ? "d" : "-"}rw-r--r-- 1 u u ${st.size} x ${name}`, attrs: attrs(st) };
          });
          sftp.name(id, list);
        });

        sftp.on("OPEN", (id, p, flags) => {
          if (!(flags & OPEN_MODE.READ)) return sftp.status(id, STATUS_CODE.PERMISSION_DENIED);
          try {
            const fd = fs.openSync(real(p), "r");
            const h = handle();
            files.set(h.readUInt32BE(0), fd);
            sftp.handle(id, h);
          } catch { sftp.status(id, STATUS_CODE.NO_SUCH_FILE); }
        });

        sftp.on("FSTAT", (id, h) => {
          const fd = files.get(h.readUInt32BE(0));
          if (fd === undefined) return sftp.status(id, STATUS_CODE.FAILURE);
          sftp.attrs(id, attrs(fs.fstatSync(fd)));
        });

        sftp.on("READ", (id, h, offset, length) => {
          const fd = files.get(h.readUInt32BE(0));
          if (fd === undefined) return sftp.status(id, STATUS_CODE.FAILURE);
          const buf = Buffer.alloc(length);
          const read = fs.readSync(fd, buf, 0, length, offset);
          if (read === 0) return sftp.status(id, STATUS_CODE.EOF);
          sftp.data(id, buf.subarray(0, read));
        });

        sftp.on("CLOSE", (id, h) => {
          const key = h.readUInt32BE(0);
          if (files.has(key)) { fs.closeSync(files.get(key)); files.delete(key); }
          dirs.delete(key);
          sftp.status(id, STATUS_CODE.OK);
        });
      });
    });
  });
}).listen(2222, "127.0.0.1", function () {
  console.log("sftp test server on", this.address().port);
});
