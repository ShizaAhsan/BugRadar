const https = require('https');
const http = require('http');
const crypto = require('crypto');

class BugRadar {
  constructor(options = {}) {
    if (!options.dsn) {
      throw new Error('BugRadar: DSN is required');
    }

    this.dsn = options.dsn;
    this.environment = options.environment || 'production';
    this.release = options.release || null;
    this.maxBreadcrumbs = options.maxBreadcrumbs || 30;
    this.sampleRate = options.sampleRate || 1.0;
    this.beforeSend = options.beforeSend || null;
    this.tags = options.tags || {};
    this.userContext = options.userContext || {};
    this.breadcrumbs = [];
    this._installed = false;
    this._pendingSends = 0;
    // A Node process that hit an uncaughtException is in an unknown state —
    // capture it, flush, then exit so the supervisor (pm2/systemd) can restart
    // a clean one (S4). Set exitOnUncaught:false to keep the old behavior.
    this.exitOnUncaught = options.exitOnUncaught !== false;
  }

  install() {
    if (this._installed) return this;
    this._installed = true;

    process.on('uncaughtException', (error) => {
      this.captureException(error, { uncaughtException: true });
      if (this.exitOnUncaught) {
        this._exitAfterFlush();
      }
    });

    process.on('unhandledRejection', (reason) => {
      const error = reason instanceof Error ? reason : new Error(String(reason));
      this.captureException(error, { unhandledRejection: true });
    });

    this._patchConsole();
    this._patchExpress();

    return this;
  }

  captureException(error, extra = {}) {
    if (!this._shouldSample()) return;

    let payload = {
      message: error.message || String(error),
      level: 'error',
      timestamp: new Date().toISOString(),
      exception: {
        type: error.name || 'Error',
        value: error.message || String(error),
        stacktrace: {
          frames: this._parseStack(error.stack || ''),
        },
      },
      tags: { ...this.tags, ...extra.tags },
      user: this.userContext,
      environment: this.environment,
      release: this.release,
      breadcrumbs: this.breadcrumbs.slice(),
      extra,
    };

    // Honour beforeSend — it's the PII-redaction hook (S3); dropping it made
    // the option a silent no-op.
    if (this.beforeSend) {
      const result = this.beforeSend(payload);
      if (!result) return;
      payload = result;
    }

    this._send(payload);
  }

  captureMessage(message, level = 'info') {
    if (!this._shouldSample()) return;

    let payload = {
      message,
      level,
      timestamp: new Date().toISOString(),
      tags: this.tags,
      user: this.userContext,
      environment: this.environment,
      release: this.release,
      breadcrumbs: this.breadcrumbs.slice(),
    };

    // captureMessage must run the same redaction hook as captureException (S3)
    if (this.beforeSend) {
      const result = this.beforeSend(payload);
      if (!result) return;
      payload = result;
    }

    this._send(payload);
  }

  setUser(user) {
    this.userContext = user || {};
  }

  setTag(key, value) {
    this.tags[key] = value;
  }

  setTags(tags) {
    this.tags = { ...this.tags, ...tags };
  }

  addBreadcrumb(breadcrumb) {
    breadcrumb.timestamp = breadcrumb.timestamp || new Date().toISOString();
    this.breadcrumbs.push(breadcrumb);
    if (this.breadcrumbs.length > this.maxBreadcrumbs) {
      this.breadcrumbs.shift();
    }
  }

  createExpressMiddleware() {
    return (req, res, next) => {
      const startTime = Date.now();

      const originalEnd = res.end;
      res.end = (...args) => {
        const duration = Date.now() - startTime;
        this.addBreadcrumb({
          category: 'http',
          type: 'http',
          data: {
            method: req.method,
            url: req.originalUrl || req.url,
            status_code: res.statusCode,
            duration,
          },
        });

        if (res.statusCode >= 500) {
          this.captureMessage(
            `${req.method} ${req.originalUrl || req.url} ${res.statusCode}`,
            'error'
          );
        }

        originalEnd.apply(res, args);
      };

      req.bugradar = this;
      next();
    };
  }

  _patchConsole() {
    const self = this;
    ['log', 'warn', 'error', 'info'].forEach((level) => {
      const original = console[level];
      if (!original) return;

      console[level] = function (...args) {
        const message = args
          .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
          .join(' ');
        self.addBreadcrumb({ category: 'console', level, message });
        return original.apply(console, args);
      };
    });
  }

  _patchExpress() {
    try {
      const express = require('express');
      const original = express.application.use;
      const self = this;

      express.application.use = function (...args) {
        if (args.length === 1 && typeof args[0] === 'function') {
          const fn = args[0];
          return original.call(this, function bugradarMiddleware(req, res, next) {
            const startTime = Date.now();
            const originalEnd = res.end;
            res.end = function (...endArgs) {
              const duration = Date.now() - startTime;
              self.addBreadcrumb({
                category: 'http',
                data: {
                  method: req.method,
                  url: req.originalUrl || req.url,
                  status_code: res.statusCode,
                  duration,
                },
              });
              originalEnd.apply(res, endArgs);
            };
            next();
          });
        }
        return original.apply(this, args);
      };
    } catch (e) {
      // Express not available
    }
  }

  _parseStack(stack) {
    if (!stack) return [];
    const lines = stack.split('\n');
    const frames = [];

    for (let i = 0; i < lines.length && frames.length < 20; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith('at') === false) continue;

      const match = line.match(/at\s+(.+?)(?:\s+\((.+)\))?$/);
      if (!match) continue;

      const frame = {
        function: match[1] || '',
        filename: '',
        lineno: 0,
        colno: 0,
      };

      const inner = match[2] || '';
      const target = match[1] || '';

      if (inner) {
        frame.function = target;
        const posMatch = inner.match(/:(\d+):(\d+)/);
        if (posMatch) {
          frame.filename = inner.substring(0, inner.lastIndexOf(':'));
          frame.lineno = parseInt(posMatch[1], 10);
          frame.colno = parseInt(posMatch[2], 10);
        } else {
          frame.filename = inner;
        }
      } else {
        // Paren-less frame ("at /app/lib/db.js:42:11") — split the location so
        // filename/lineno aren't one mangled string (S5)
        const locMatch = target.match(/^(.+):(\d+):(\d+)$/);
        if (locMatch) {
          frame.filename = locMatch[1];
          frame.lineno = parseInt(locMatch[2], 10);
          frame.colno = parseInt(locMatch[3], 10);
        } else {
          frame.function = target;
          frame.filename = target;
        }
      }

      if (frame.filename && !frame.filename.includes('bugradar')) {
        frames.push(frame);
      }
    }

    return frames.reverse();
  }

  _shouldSample() {
    return Math.random() < this.sampleRate;
  }

  // Give in-flight capture requests a moment to flush, then terminate with a
  // non-zero exit code (S4). Hard deadline so a hung socket can't pin a
  // corrupted process open forever.
  _exitAfterFlush() {
    const deadline = Date.now() + 1000;
    const tryExit = () => {
      if (this._pendingSends <= 0 || Date.now() > deadline) {
        process.exit(1);
      }
      setTimeout(tryExit, 50);
    };
    setTimeout(tryExit, 50);
  }

  _send(payload) {
    payload.sdk = { name: 'bugradar-node', version: '1.0.0' };

    this._pendingSends += 1;
    const done = () => {
      this._pendingSends = Math.max(0, this._pendingSends - 1);
    };

    try {
      const url = new URL(this.dsn.replace(/\/store\/?$/, '') + '/store/');
      const lib = url.protocol === 'https:' ? https : http;

      const data = JSON.stringify(payload);
      const req = lib.request(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
      });

      req.on('error', done);
      req.on('response', (res) => {
        res.resume();
        done();
      });
      req.write(data);
      req.end();
    } catch (e) {
      // Silently fail
      done();
    }
  }
}

module.exports = BugRadar;
module.exports.BugRadar = BugRadar;
module.exports.default = BugRadar;
