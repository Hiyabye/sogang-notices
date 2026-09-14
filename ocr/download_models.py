"""Explicit model installation, separate from the local-only OCR worker."""

import argparse
import hashlib
import json
from pathlib import Path
import urllib.request
from urllib.parse import urlsplit


class HttpsRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        target = urlsplit(newurl)
        if target.scheme != "https" or target.username is not None or target.password is not None:
            raise RuntimeError("Unsafe model redirect")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    manifest = json.loads(Path(__file__).with_name("models.json").read_text())
    opener = urllib.request.build_opener(HttpsRedirect())
    for model in manifest["models"]:
        directory = args.output / model["name"]
        directory.mkdir(parents=True, exist_ok=True)
        for filename, expected in model["files"].items():
            target = directory / filename
            if target.exists():
                with target.open("rb") as stream:
                    cached = stream.read(32 * 1024 * 1024 + 1)
                if len(cached) > 32 * 1024 * 1024 or hashlib.sha256(cached).hexdigest() != expected:
                    raise RuntimeError("Corrupt model cache; explicitly repair it before retrying")
                continue
            url = f"{model['source']}/resolve/{model['revision']}/{filename}"
            if urlsplit(url).scheme != "https":
                raise RuntimeError("Unsafe model URL")
            with opener.open(url, timeout=30) as response:
                data = response.read(32 * 1024 * 1024 + 1)
            if len(data) > 32 * 1024 * 1024 or hashlib.sha256(data).hexdigest() != expected:
                raise RuntimeError("Model download hash mismatch")
            target.write_bytes(data)


if __name__ == "__main__":
    main()
