#!/usr/bin/env python3
"""With J의 archive 권한 보존과 배포 IPA 검증. 원문 서명·프로파일은 출력하지 않는다."""
import argparse
import datetime
import fnmatch
import hashlib
import os
from pathlib import Path
import plistlib
import re
import subprocess
import sys
import tempfile


ROOT = Path(__file__).resolve().parents[1]
GROUP = "group.com.fromj.trip"
GROUP_KEY = "com.apple.security.application-groups"
TARGETS = {
    "com.fromj.trip": "TripCanvas/TripCanvas.entitlements",
    "com.fromj.trip.widgets": "TripCanvasWidgets/TripCanvasWidgets.entitlements",
    "com.fromj.trip.share": "TripCanvasShare/TripCanvasShare.entitlements",
    "com.fromj.trip.watchkitapp": "TripCanvasWatch/TripCanvasWatch.entitlements",
}


class SigningError(Exception):
    pass


def run(args):
    try:
        result = subprocess.run([str(arg) for arg in args], check=True, capture_output=True)
        return result.stdout
    except subprocess.CalledProcessError as error:
        # 원문에는 서명·프로파일 값이 섞일 수 있다. 알려진 코드와 종료 상태만 남긴다.
        output = (error.stdout or b"") + (error.stderr or b"")
        codes = sorted(set(re.findall(rb"\bITMS-\d{4,6}\b", output)))
        detail = ":" + ",".join(code.decode("ascii") for code in codes[:8]) if codes else ""
        raise SigningError(f"TOOL_FAILED:{Path(args[0]).name}:exit={error.returncode}{detail}") from None
    except OSError as error:
        raise SigningError(f"TOOL_UNAVAILABLE:{Path(args[0]).name}:errno={error.errno}") from None


def plist(data):
    try:
        result = plistlib.loads(data)
        if isinstance(result, dict):
            return result
    except (ValueError, plistlib.InvalidFileException):
        pass
    raise SigningError("INVALID_SIGNING_PLIST")


def bundles(app):
    found = {}
    for bundle in [app, *app.rglob("*.appex"), *app.rglob("*.app")]:
        if not (bundle / "Info.plist").is_file():
            raise SigningError("BUNDLE_INFO_MISSING")
        info = plist((bundle / "Info.plist").read_bytes())
        bundle_id = info.get("CFBundleIdentifier")
        if bundle_id not in TARGETS or bundle_id in found:
            raise SigningError("UNEXPECTED_APP_BUNDLE")
        found[bundle_id] = bundle
    if found.keys() != TARGETS.keys():
        raise SigningError("REQUIRED_APP_BUNDLE_MISSING")
    return found


def require_entitlements(entitlements, main):
    groups = entitlements.get(GROUP_KEY)
    if not isinstance(groups, list) or GROUP not in groups:
        raise SigningError("APP_GROUP_MISSING")
    if main and entitlements.get("aps-environment") != "production":
        raise SigningError("APS_PRODUCTION_MISSING")


def prepare_archive(app):
    """unsigned archive에 요청 권한을 임시 서명한다. 배포 서명은 Xcode export가 맡는다."""
    targets = bundles(app)
    # 라이브러리에 앱 권한을 넣지 않는다. --deep 서명 대신 안쪽 코드부터 처리한다.
    libraries = [*app.rglob("*.framework"), *app.rglob("*.dylib")]
    for library in sorted(libraries, key=lambda item: len(item.parts), reverse=True):
        run(["/usr/bin/codesign", "--force", "--sign", "-", library])
    with tempfile.TemporaryDirectory(prefix="withj-signing-") as temporary:
        for bundle_id, bundle in sorted(targets.items(), key=lambda item: len(item[1].parts), reverse=True):
            entitlements = plist((ROOT / "ios" / TARGETS[bundle_id]).read_bytes())
            if bundle_id == "com.fromj.trip" and entitlements.get("aps-environment") == "$(APS_ENVIRONMENT)":
                entitlements["aps-environment"] = "production"
            require_entitlements(entitlements, bundle_id == "com.fromj.trip")
            path = Path(temporary) / (bundle_id + ".plist")
            path.write_bytes(plistlib.dumps(entitlements))
            run(["/usr/bin/codesign", "--force", "--sign", "-", "--entitlements", path, bundle])
    verify_app(app, distribution=False)


def verify_app(app, distribution):
    expected_team = os.environ.get("APPLE_TEAM_ID", "")
    if distribution and not expected_team:
        raise SigningError("DISTRIBUTION_TEAM_REQUIRED")
    for bundle_id, bundle in bundles(app).items():
        verify = ["/usr/bin/codesign", "--verify", "--strict"]
        if distribution:
            # 임시 ad-hoc 서명이 배포 IPA의 최종 서명으로 통과하지 않게 한다.
            verify += ["-R", "anchor apple generic"]
        run([*verify, bundle])
        signature = plist(run(["/usr/bin/codesign", "--display", "--entitlements", "-", "--xml", bundle]))
        require_entitlements(signature, bundle_id == "com.fromj.trip")
        if not distribution:
            continue
        profile_path = bundle / "embedded.mobileprovision"
        if not profile_path.is_file():
            raise SigningError("DISTRIBUTION_PROFILE_MISSING")
        profile = plist(run(["/usr/bin/security", "cms", "-D", "-i", profile_path]))
        allowed = profile.get("Entitlements", {})
        require_entitlements(allowed, bundle_id == "com.fromj.trip")
        expires = profile.get("ExpirationDate")
        if not isinstance(expires, datetime.datetime):
            raise SigningError("PROFILE_EXPIRY_MISSING")
        if expires.replace(tzinfo=datetime.timezone.utc) <= datetime.datetime.now(datetime.timezone.utc):
            raise SigningError("PROFILE_EXPIRED")
        team = signature.get("com.apple.developer.team-identifier")
        if team != expected_team or team not in profile.get("TeamIdentifier", []) or allowed.get("com.apple.developer.team-identifier") != team:
            raise SigningError("PROFILE_TEAM_MISMATCH")
        app_id = signature.get("application-identifier", "")
        allowed_id = allowed.get("application-identifier", "")
        if not app_id.endswith("." + bundle_id) or not allowed_id or not fnmatch.fnmatchcase(app_id, allowed_id):
            raise SigningError("PROFILE_APP_MISMATCH")
        if signature.get("get-task-allow") or allowed.get("get-task-allow") or "ProvisionedDevices" in profile or profile.get("ProvisionsAllDevices"):
            raise SigningError("PROFILE_IS_NOT_APP_STORE_DISTRIBUTION")
        with tempfile.TemporaryDirectory(prefix="withj-certificate-") as temporary:
            prefix = Path(temporary) / "signer"
            run(["/usr/bin/codesign", "--display", "--extract-certificates=" + str(prefix), bundle])
            leaf = Path(str(prefix) + "0")
            if not leaf.is_file() or leaf.read_bytes() not in profile.get("DeveloperCertificates", []):
                raise SigningError("PROFILE_CERTIFICATE_MISMATCH")


def verify_ipa(ipa):
    with tempfile.TemporaryDirectory(prefix="withj-ipa-") as temporary:
        # ditto가 IPA의 심볼릭 링크·파일 속성을 유지한다. 원본 IPA는 다시 묶지 않는다.
        run(["/usr/bin/ditto", "-x", "-k", ipa, temporary])
        apps = list((Path(temporary) / "Payload").glob("*.app"))
        if len(apps) != 1:
            raise SigningError("IPA_APP_MISSING")
        verify_app(apps[0], distribution=True)


def upload(ipa):
    original = hashlib.sha256(ipa.read_bytes()).digest()
    verify_ipa(ipa)
    if hashlib.sha256(ipa.read_bytes()).digest() != original:
        raise SigningError("VERIFIED_IPA_CHANGED")
    key = os.environ.get("APPSTORE_KEY_ID", "")
    issuer = os.environ.get("APPSTORE_ISSUER_ID", "")
    if not key or not issuer:
        raise SigningError("APP_STORE_AUTH_CONFIGURATION_MISSING")
    # 현재 Xcode와 Apple altool 가이드가 지원하는 동일 IPA 업로드. 비밀키는 기본 검색 경로에서 읽는다.
    run(["xcrun", "altool", "--upload-app", "-f", ipa, "-t", "ios", "--apiKey", key, "--apiIssuer", issuer])


def export_error_summary(path):
    """export 실패 원인만 제한적으로 남기고 서명 자산·계정 원문은 가린다."""
    text = path.read_text(errors="replace")
    text = re.sub(r"-----BEGIN [^-\n]+-----.*?(?:-----END [^-\n]+-----|$)", "[redacted-key]", text, flags=re.S)
    # UserInfo 원문은 개행·중첩 딕셔너리·인용문 속 괄호까지 건너뛴다. 불완전하면 나머지도 버린다.
    while True:
        info = re.search(r"\bUserInfo\s*=\s*", text, re.I)
        if not info:
            break
        end, depth, quote, escaped = len(text), 0, None, False
        if info.end() < len(text) and text[info.end()] == "{":
            for index in range(info.end(), len(text)):
                char = text[index]
                if quote:
                    if escaped:
                        escaped = False
                    elif char == "\\":
                        escaped = True
                    elif char == quote:
                        quote = None
                elif char in ["\"", "'"]:
                    quote = char
                elif char == "{":
                    depth += 1
                elif char == "}":
                    depth -= 1
                    if depth == 0:
                        end = index + 1
                        break
        text = text[:info.start()] + text[end:]
    secrets = [value for key, value in os.environ.items() if value and
               re.search(r"SECRET|TOKEN|PASSWORD|PRIVATE_KEY|KEY_ID|TEAM_ID|ISSUER_ID", key, re.I)]
    result = []
    for line in text.splitlines():
        error = re.search(r"error:\s*exportArchive\b|\bError Domain=[\w.-]+\s+Code=-?\d+", line, re.I)
        if not error:
            continue
        line = line[error.start():]
        for value in sorted(secrets, key=len, reverse=True):
            line = line.replace(value, "[redacted]")
        line = re.sub(r"\bBearer\s+[^\s,;\"'}]+", "Bearer [redacted]", line, flags=re.I)
        line = re.sub(r"\beyJ[\w-]*\.[\w-]+\.[\w-]+\b", "[redacted-jwt]", line)
        line = re.sub(r'''\bhttps?://[^\s"'<>]+''', "[redacted-url]", line, flags=re.I)
        line = re.sub(r'''\b([\w]*(?:TOKEN|SECRET|PASSWORD|PRIVATE_KEY|API_KEY|KEY_ID|TEAM_ID|ISSUER_ID)[\w]*)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)''', r"\1=[redacted]", line, flags=re.I)
        line = re.sub(r"[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}", "[redacted-email]", line)
        line = re.sub(r'''(["'])(?:file://)?/(?:Users|home|private/var/folders|var/folders)/.*?\1''', r"\1[redacted-path]\1", line)
        line = re.sub(r"(?:file://)?/(?:Users|home|private/var/folders|var/folders)/.*|[A-Za-z]:\\Users\\.*", "[redacted-path]", line)
        line = re.sub(r'''\b((?:provisioning\s+)?profiles?|teams?)(?:\s+(?:for|named|name))?\s*[:=]?\s*(["'])(.*?)\2''',
                      lambda match: match.group(0) if match.group(3) in TARGETS else match.group(1) + " [redacted]",
                      line, flags=re.I)
        line = re.sub(r'''\b((?:Apple|iPhone|iOS) (?:Distribution|Development)):[^"'\n]+''', r"\1: [redacted]", line)
        line = re.sub(r"(?i:\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b)|\b[A-Z0-9]{10}\b", "[redacted-id]", line)
        line = re.sub(r"[\x00-\x1f\x7f]", " ", line).strip()[:500]
        if line not in result:
            result.append(line)
        if len(result) == 20:
            break
    return result or ["EXPORT_ERROR_DETAILS_UNAVAILABLE"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("stage", choices=["prepare-archive", "archive", "ipa", "upload", "export-errors"])
    parser.add_argument("path", type=Path)
    args = parser.parse_args()
    try:
        if args.stage == "export-errors":
            for message in export_error_summary(args.path):
                print(message)
            return 0
        if args.stage in ["prepare-archive", "archive"]:
            app = args.path / "Products/Applications/TripCanvas.app"
            if args.stage == "prepare-archive":
                prepare_archive(app)
            else:
                verify_app(app, distribution=False)
        elif args.stage == "ipa":
            verify_ipa(args.path)
        else:
            upload(args.path)
        print("PASS iOS signing: " + args.stage)
    except (SigningError, OSError, ValueError) as error:
        code = str(error) if isinstance(error, SigningError) else "SIGNING_INPUT_UNREADABLE"
        print("FAIL iOS signing: " + code, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
