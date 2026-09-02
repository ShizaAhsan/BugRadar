"""
BugRadar Python SDK
Capture exceptions and errors from Python applications.
"""

import json
import sys
import threading
import traceback
import hashlib
import platform
from datetime import datetime, timezone
from urllib.request import Request, urlopen
from urllib.error import URLError


class BugRadar:
    def __init__(self, dsn=None, environment="production", release=None,
                 max_breadcrumbs=30, sample_rate=1.0, before_send=None,
                 tags=None, user_context=None):
        if not dsn:
            raise ValueError("BugRadar: DSN is required")

        self.dsn = dsn.rstrip("/")
        self.environment = environment
        self.release = release
        self.max_breadcrumbs = max_breadcrumbs
        self.sample_rate = sample_rate
        self.before_send = before_send
        self.tags = tags or {}
        self.user_context = user_context or {}
        self.breadcrumbs = []
        self._installed = False
        self._lock = threading.Lock()

    def install(self):
        if self._installed:
            return self
        self._installed = True

        sys.excepthook = self._excepthook

        if sys.version_info >= (3, 8):
            old_hook = threading.excepthook
            def _thread_hook(args):
                self.capture_exception(args.exc_value)
                if old_hook:
                    old_hook(args)
            threading.excepthook = _thread_hook

        self._patch_logging()
        return self

    def capture_exception(self, exc_info=None, **kwargs):
        if exc_info is None:
            exc_info = sys.exc_info()

        if exc_info[0] is None:
            return None

        exc_type, exc_value, exc_tb = exc_info

        if not self._should_sample():
            return None

        frames = self._parse_traceback(exc_tb)

        payload = {
            "message": str(exc_value),
            "level": "error",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "exception": {
                "type": exc_type.__name__ if exc_type else "Exception",
                "value": str(exc_value),
                "stacktrace": {"frames": frames},
            },
            "tags": {**self.tags, **kwargs.get("tags", {})},
            "user": self.user_context,
            "environment": self.environment,
            "release": self.release,
            "breadcrumbs": list(self.breadcrumbs),
        }

        if self.before_send:
            payload = self.before_send(payload)
            if payload is None:
                return None

        return self._send(payload)

    def capture_message(self, message, level="info"):
        if not self._should_sample():
            return None

        payload = {
            "message": message,
            "level": level,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "tags": self.tags,
            "user": self.user_context,
            "environment": self.environment,
            "release": self.release,
            "breadcrumbs": list(self.breadcrumbs),
        }

        if self.before_send:
            payload = self.before_send(payload)
            if payload is None:
                return None

        return self._send(payload)

    def set_user(self, user):
        self.user_context = user or {}

    def set_tag(self, key, value):
        self.tags[key] = value

    def set_tags(self, tags):
        self.tags.update(tags)

    def add_breadcrumb(self, category="default", level="info", message="",
                       data=None, **kwargs):
        breadcrumb = {
            "category": category,
            "level": level,
            "message": message,
            "data": data or {},
            "timestamp": datetime.now(timezone.utc).isoformat(),
            **kwargs,
        }

        with self._lock:
            self.breadcrumbs.append(breadcrumb)
            if len(self.breadcrumbs) > self.max_breadcrumbs:
                self.breadcrumbs.pop(0)

    def _patch_logging(self):
        try:
            import logging

            class BugRadarHandler(logging.Handler):
                def __init__(self, radar):
                    super().__init__()
                    self.radar = radar

                def emit(self, record):
                    try:
                        level_map = {
                            logging.DEBUG: "debug",
                            logging.INFO: "info",
                            logging.WARNING: "warning",
                            logging.ERROR: "error",
                            logging.CRITICAL: "fatal",
                        }
                        level = level_map.get(record.levelno, "info")
                        self.radar.add_breadcrumb(
                            category="logging",
                            level=level,
                            message=self.format(record),
                        )
                    except Exception:
                        pass

            handler = BugRadarHandler(self)
            handler.setLevel(logging.DEBUG)
            logging.root.addHandler(handler)
        except ImportError:
            pass

    def _parse_traceback(self, tb):
        frames = []
        while tb is not None:
            frame = tb.tb_frame
            filename = frame.f_code.co_filename
            if "bugradar" not in filename.lower():
                frames.append({
                    "filename": filename,
                    "lineno": tb.tb_lineno,
                    "function": frame.f_code.co_name,
                    "locals": {k: str(v)[:200] for k, v in frame.f_locals.items()
                               if not k.startswith("_")},
                })
            tb = tb.tb_next

        return frames

    def _should_sample(self):
        import random
        return random.random() < self.sample_rate

    def _send(self, payload):
        payload["sdk"] = {"name": "bugradar-python", "version": "1.0.0"}

        store_url = self.dsn.rstrip("/") + "/store/"
        data = json.dumps(payload).encode("utf-8")

        try:
            req = Request(store_url, data=data, method="POST")
            req.add_header("Content-Type", "application/json")
            req.add_header("Content-Length", str(len(data)))
            urlopen(req, timeout=5)
            return True
        except (URLError, OSError):
            return False


    def _excepthook(self, exc_type, exc_value, exc_tb):
        """Default excepthook that sends to BugRadar."""
        self.capture_exception((exc_type, exc_value, exc_tb))
