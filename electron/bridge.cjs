const { spawn } = require("node:child_process");
const { createInterface } = require("node:readline");
const path = require("node:path");
class EngineBridge {
  constructor(root, python) {
    this.pending = new Map();
    this.serial = 0;
    this.stopped = false;
    this.process = spawn(
      python || path.join(root, ".venv/bin/python"),
      ["-u", path.join(root, "engine/pdf_engine.py")],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    this.process.stderr.on("data", () => {});
    createInterface({ input: this.process.stdout }).on("line", (line) => {
      try {
        const reply = JSON.parse(line);
        const entry = this.pending.get(reply.id);
        if (!entry) return;
        this.pending.delete(reply.id);
        clearTimeout(entry.timer);
        if (reply.error) entry.reject(new Error(reply.error));
        else entry.resolve(reply.result);
      } catch {
        this.fail("Invalid PDF engine response. Restart NavPDF.");
      }
    });
    this.process.on("error", () =>
      this.fail("PDF engine unavailable. Run npm run setup."),
    );
    this.process.on("exit", () =>
      this.fail("PDF engine stopped. Restart NavPDF."),
    );
  }
  fail(message) {
    this.stopped = true;
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error(message));
    }
    this.pending.clear();
  }
  call(args) {
    if (this.stopped)
      return Promise.reject(
        new Error("PDF engine unavailable. Restart NavPDF."),
      );
    return new Promise((resolve, reject) => {
      const id = ++this.serial;
      const timer = setTimeout(() => {
        this.fail("Operation timed out. Restart NavPDF before continuing.");
        this.process.kill();
      }, 180000);
      this.pending.set(id, { resolve, reject, timer });
      this.process.stdin.write(JSON.stringify({ id, args }) + "\n", (err) => {
        if (err) this.fail("Unable to contact PDF engine.");
      });
    });
  }
  close() {
    this.process.kill();
  }
}
module.exports = { EngineBridge };
