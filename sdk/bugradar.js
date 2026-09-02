(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.BugRadar = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var _options = {
    dsn: null,
    environment: 'production',
    release: null,
    maxBreadcrumbs: 30,
    sampleRate: 1.0,
    beforeSend: null,
    userContext: {},
    tags: {},
  };

  var _breadcrumbs = [];
  var _queue = [];
  var _initialized = false;

  function init(options) {
    if (!options || !options.dsn) {
      throw new Error('BugRadar: DSN is required');
    }

    _options = mergeOptions(_options, options);
    _initialized = true;

    _captureConsoleBreadcrumbs();
    _captureNavigationBreadcrumbs();
    _captureClickBreadcrumbs();

    if (typeof window !== 'undefined') {
      window.addEventListener('error', _handleGlobalError);
      window.addEventListener('unhandledrejection', _handleUnhandledRejection);
    }

    if (typeof document !== 'undefined') {
      document.addEventListener('DOMContentLoaded', function () {
        _flushQueue();
      });
    }

    _send({
      type: 'session_start',
      timestamp: new Date().toISOString(),
    });
  }

  function captureException(error, extra) {
    if (!_initialized || !_shouldSample()) return;

    var payload = {
      message: error.message || String(error),
      level: 'error',
      timestamp: new Date().toISOString(),
      exception: {
        type: error.name || 'Error',
        value: error.message || String(error),
        stacktrace: {
          frames: _parseStack(error.stack || ''),
        },
      },
      tags: mergeOptions({}, _options.tags, extra?.tags || {}),
      user: _options.userContext,
      environment: _options.environment,
      release: _options.release,
      breadcrumbs: _breadcrumbs.slice(),
      extra: extra || {},
    };

    if (_options.beforeSend) {
      payload = _options.beforeSend(payload);
      if (!payload) return;
    }

    _send(payload);
  }

  function captureMessage(message, level) {
    if (!_initialized || !_shouldSample()) return;

    var payload = {
      message: message,
      level: level || 'info',
      timestamp: new Date().toISOString(),
      tags: _options.tags,
      user: _options.userContext,
      environment: _options.environment,
      release: _options.release,
      breadcrumbs: _breadcrumbs.slice(),
    };

    if (_options.beforeSend) {
      payload = _options.beforeSend(payload);
      if (!payload) return;
    }

    _send(payload);
  }

  function captureConsole(level) {
    if (typeof console === 'undefined') return;

    var original = console[level];
    if (!original) return;

    console[level] = function () {
      var args = Array.prototype.slice.call(arguments);
      var message = args.map(function (a) {
        return typeof a === 'string' ? a : JSON.stringify(a);
      }).join(' ');

      addBreadcrumb({
        category: 'console',
        level: level,
        message: message,
      });

      return original.apply(console, arguments);
    };
  }

  function setUser(user) {
    _options.userContext = user || {};
  }

  function setTag(key, value) {
    _options.tags[key] = value;
  }

  function setTags(tags) {
    _options.tags = mergeOptions({}, _options.tags, tags);
  }

  function addBreadcrumb(breadcrumb) {
    breadcrumb.timestamp = breadcrumb.timestamp || new Date().toISOString();
    _breadcrumbs.push(breadcrumb);

    if (_breadcrumbs.length > _options.maxBreadcrumbs) {
      _breadcrumbs.shift();
    }
  }

  function _handleGlobalError(event) {
    var error = event.error || new Error(event.message || 'Unknown error');
    captureException(error, {
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    });
  }

  function _handleUnhandledRejection(event) {
    var reason = event.reason || event.detail || 'Unhandled Promise Rejection';
    var error = reason instanceof Error ? reason : new Error(String(reason));
    captureException(error, { unhandledPromiseRejection: true });
  }

  function _captureConsoleBreadcrumbs() {
    ['log', 'warn', 'error', 'info'].forEach(function (level) {
      captureConsole(level);
    });
  }

  function _captureNavigationBreadcrumbs() {
    if (typeof window === 'undefined') return;

    var originalPushState = history.pushState;
    var originalReplaceState = history.replaceState;

    history.pushState = function () {
      addBreadcrumb({
        category: 'navigation',
        data: { from: location.href, to: arguments[2] || location.href },
      });
      return originalPushState.apply(this, arguments);
    };

    history.replaceState = function () {
      addBreadcrumb({
        category: 'navigation',
        data: { from: location.href, to: arguments[2] || location.href },
      });
      return originalReplaceState.apply(this, arguments);
    };

    window.addEventListener('popstate', function () {
      addBreadcrumb({
        category: 'navigation',
        data: { from: location.href, to: location.href },
      });
    });
  }

  function _captureClickBreadcrumbs() {
    if (typeof document === 'undefined') return;

    document.addEventListener('click', function (event) {
      var target = event.target;
      var selector = _getSelector(target);
      addBreadcrumb({
        category: 'ui.click',
        data: { selector: selector },
      });
    }, true);
  }

  function _getSelector(el) {
    if (!el) return '<unknown>';
    if (el.id) return '#' + el.id;
    if (el.tagName) {
      var parts = [el.tagName.toLowerCase()];
      if (el.className && typeof el.className === 'string') {
        parts.push('.' + el.className.trim().split(/\s+/).join('.'));
      }
      return parts.join('');
    }
    return '<unknown>';
  }

  function _parseStack(stack) {
    if (!stack) return [];

    var lines = stack.split('\n');
    var frames = [];

    for (var i = 0; i < lines.length && frames.length < 20; i++) {
      var line = lines[i].trim();
      if (!line || line === 'Error') continue;

      var frame = { filename: '', lineno: 0, colno: 0, function: '' };

      var match = line.match(/at\s+(.+?)(?:\s+\((.+)\))?$/);
      if (match) {
        frame.function = match[1] || '';
        var inner = match[2] || '';

        var posMatch = inner.match(/:(\d+):(\d+)/);
        if (posMatch) {
          frame.filename = inner.substring(0, inner.lastIndexOf(':'));
          frame.lineno = parseInt(posMatch[1], 10);
          frame.colno = parseInt(posMatch[2], 10);
        } else {
          frame.filename = inner || match[1];
        }
      } else {
        frame.filename = line;
      }

      if (frame.filename && !frame.filename.includes('bugradar')) {
        frames.push(frame);
      }
    }

    return frames.reverse();
  }

  function _shouldSample() {
    return Math.random() < _options.sampleRate;
  }

  function _send(payload) {
    if (!_options.dsn) return;

    payload.sdk = { name: 'bugradar-js', version: '1.0.0' };

    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      try {
        var blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
        var url = _options.dsn.replace(/\/store\/?$/, '') + '/store/';
        navigator.sendBeacon(url, blob);
        return;
      } catch (e) {
        // fallback to fetch
      }
    }

    if (typeof fetch !== 'undefined') {
      var url = _options.dsn.replace(/\/store\/?$/, '') + '/store/';
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(function () {});
    } else {
      _queue.push(payload);
    }
  }

  function _flushQueue() {
    while (_queue.length > 0) {
      var item = _queue.shift();
      _send(item);
    }
  }

  function mergeOptions(target) {
    var result = {};
    for (var i = 0; i < arguments.length; i++) {
      var source = arguments[i];
      if (source) {
        for (var key in source) {
          if (source.hasOwnProperty(key)) {
            result[key] = source[key];
          }
        }
      }
    }
    return result;
  }

  return {
    init: init,
    captureException: captureException,
    captureMessage: captureMessage,
    setUser: setUser,
    setTag: setTag,
    setTags: setTags,
    addBreadcrumb: addBreadcrumb,
  };
}));
