import copy
import datetime
import importlib.util
import os
from pathlib import Path
import plistlib
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import zipfile


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("signing", ROOT / "scripts/check-ios-signing.py")
signing = importlib.util.module_from_spec(spec)
spec.loader.exec_module(signing)
NATIVE_RUN = signing.run


class SigningTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source_root = self.root / "source"
        for relative in ["TripCanvas/TripCanvas.entitlements",
                         "TripCanvasWidgets/TripCanvasWidgets.entitlements",
                         "TripCanvasShare/TripCanvasShare.entitlements",
                         "TripCanvasWatch/TripCanvasWatch.entitlements"]:
            source = self.source_root / "ios" / relative
            source.parent.mkdir(parents=True, exist_ok=True)
            entitlements = {"com.apple.security.application-groups": ["group.com.fromj.trip"]}
            if relative == "TripCanvas/TripCanvas.entitlements":
                entitlements["aps-environment"] = "$(APS_ENVIRONMENT)"
            source.write_bytes(plistlib.dumps(entitlements))
        self.app = self.root / "TripCanvas.app"
        self.paths = {
            "com.fromj.trip": self.app,
            "com.fromj.trip.widgets": self.app / "PlugIns/TripCanvasWidgets.appex",
            "com.fromj.trip.share": self.app / "PlugIns/TripCanvasShare.appex",
            "com.fromj.trip.watchkitapp": self.app / "Watch/TripCanvasWatch.app",
        }
        self.entitlements = {}
        self.profiles = {}
        self.calls = []
        self.fail_signature = False
        for bundle_id, bundle in self.paths.items():
            bundle.mkdir(parents=True, exist_ok=True)
            (bundle / "Info.plist").write_bytes(plistlib.dumps({"CFBundleIdentifier": bundle_id}))
            (bundle / "embedded.mobileprovision").write_bytes(b"profile placeholder")
            ent = {"com.apple.security.application-groups": ["group.com.fromj.trip"],
                   "application-identifier": "TESTTEAM00." + bundle_id,
                   "com.apple.developer.team-identifier": "TESTTEAM00", "get-task-allow": False}
            if bundle_id == "com.fromj.trip":
                ent["aps-environment"] = "production"
            self.entitlements[bundle_id] = ent
            self.profiles[bundle_id] = {"Entitlements": copy.deepcopy(ent),
                "TeamIdentifier": ["TESTTEAM00"],
                "DeveloperCertificates": [b"distribution-certificate"],
                "ExpirationDate": datetime.datetime(2099, 1, 1)}
        self.addCleanup(patch.stopall)
        patch.object(signing, "run", self.fake_run).start()
        patch.object(signing, "ROOT", self.source_root).start()
        patch.dict(os.environ, {"APPLE_TEAM_ID": "TESTTEAM00", "APPSTORE_KEY_ID": "fake-key",
                                "APPSTORE_ISSUER_ID": "fake-issuer"}).start()

    def fake_run(self, args):
        args = [str(arg) for arg in args]
        self.calls.append(args)
        if args[0] == "/usr/bin/codesign":
            bundle = Path(args[-1])
            if "--force" in args:
                if "--entitlements" in args:
                    bundle_id = plistlib.loads((bundle / "Info.plist").read_bytes())["CFBundleIdentifier"]
                    self.entitlements[bundle_id] = plistlib.loads(Path(args[args.index("--entitlements") + 1]).read_bytes())
                return b""
            if self.fail_signature:
                raise signing.SigningError("SIGNATURE_INVALID")
            if "--display" in args:
                if "--extract-certificates" in args:
                    raise AssertionError("codesign requires the optional prefix joined with '='")
                extract = next((arg for arg in args if arg.startswith("--extract-certificates=")), None)
                if extract:
                    prefix = extract.split("=", 1)[1]
                    Path(prefix + "0").write_bytes(b"distribution-certificate")
                    return b""
                bundle_id = plistlib.loads((bundle / "Info.plist").read_bytes())["CFBundleIdentifier"]
                return plistlib.dumps(self.entitlements[bundle_id])
            return b""
        if args[0] == "/usr/bin/security":
            bundle_id = plistlib.loads((Path(args[-1]).parent / "Info.plist").read_bytes())["CFBundleIdentifier"]
            return plistlib.dumps(self.profiles[bundle_id])
        if args[:2] == ["/usr/bin/ditto", "-x"]:
            with zipfile.ZipFile(args[-2]) as package:
                package.extractall(args[-1])
            return b""
        if args[:3] == ["xcrun", "altool", "--upload-app"]:
            return b"uploaded"
        raise AssertionError("unexpected command")

    def ipa(self):
        destination = self.root / "TripCanvas.ipa"
        with zipfile.ZipFile(destination, "w") as package:
            for file in self.app.rglob("*"):
                if file.is_file():
                    package.write(file, "Payload/TripCanvas.app/" + str(file.relative_to(self.app)))
        return destination

    def test_archive_preparation_preserves_all_four_targets_inside_out(self):
        for value in self.entitlements.values():
            value.clear()
        signing.prepare_archive(self.app)
        self.assertEqual(self.entitlements["com.fromj.trip"]["aps-environment"], "production")
        for value in self.entitlements.values():
            self.assertIn("group.com.fromj.trip", value["com.apple.security.application-groups"])
        signed = [call[-1] for call in self.calls if "--force" in call]
        self.assertEqual(signed[-1], str(self.app))
        self.assertEqual(len(signed), 4)

    def test_missing_generated_source_entitlements_blocks_archive_preparation(self):
        (self.source_root / "ios/TripCanvasWidgets/TripCanvasWidgets.entitlements").unlink()
        with self.assertRaises(FileNotFoundError):
            signing.prepare_archive(self.app)
        self.assertFalse(any("--verify" in call for call in self.calls))

    def test_valid_distribution_signatures_and_profiles_pass(self):
        signing.verify_app(self.app, distribution=True)
        self.assertEqual(sum("--verify" in call for call in self.calls), 4)
        self.assertEqual(sum(call[0] == "/usr/bin/security" for call in self.calls), 4)

    def test_missing_or_development_or_unexpanded_aps_fails(self):
        for value in [None, "development", "$(APS_ENVIRONMENT)"]:
            with self.subTest(value=value):
                if value is None:
                    self.entitlements["com.fromj.trip"].pop("aps-environment", None)
                else:
                    self.entitlements["com.fromj.trip"]["aps-environment"] = value
                with self.assertRaises(signing.SigningError):
                    signing.verify_app(self.app, distribution=True)

    def test_profile_only_aps_does_not_grant_app_signature_permission(self):
        del self.entitlements["com.fromj.trip"]["aps-environment"]
        with self.assertRaises(signing.SigningError):
            signing.verify_app(self.app, distribution=True)

    def test_each_target_must_keep_its_actual_app_group(self):
        for bundle_id in self.paths:
            with self.subTest(bundle_id=bundle_id):
                saved = self.entitlements[bundle_id].pop("com.apple.security.application-groups")
                with self.assertRaises(signing.SigningError):
                    signing.verify_app(self.app, distribution=True)
                self.entitlements[bundle_id]["com.apple.security.application-groups"] = saved

    def test_profile_must_allow_aps_and_app_group(self):
        for key in ["aps-environment", "com.apple.security.application-groups"]:
            with self.subTest(key=key):
                saved = self.profiles["com.fromj.trip"]["Entitlements"].pop(key)
                with self.assertRaises(signing.SigningError):
                    signing.verify_app(self.app, distribution=True)
                self.profiles["com.fromj.trip"]["Entitlements"][key] = saved

    def test_expired_or_wrong_team_or_wrong_app_profile_fails(self):
        original = copy.deepcopy(self.profiles["com.fromj.trip"])
        for change in ["expired", "team", "app"]:
            with self.subTest(change=change):
                profile = self.profiles["com.fromj.trip"] = copy.deepcopy(original)
                if change == "expired":
                    profile["ExpirationDate"] = datetime.datetime(2000, 1, 1)
                elif change == "team":
                    profile["TeamIdentifier"] = ["OTHERTEAM0"]
                else:
                    profile["Entitlements"]["application-identifier"] = "TESTTEAM00.other.app"
                with self.assertRaises(signing.SigningError):
                    signing.verify_app(self.app, distribution=True)

    def test_missing_extension_is_not_silently_skipped(self):
        (self.paths["com.fromj.trip.widgets"] / "Info.plist").unlink()
        with self.assertRaises(signing.SigningError):
            signing.verify_app(self.app, distribution=True)

    def test_signed_leaf_certificate_must_be_authorized_by_profile(self):
        self.profiles["com.fromj.trip"]["DeveloperCertificates"] = [b"different-certificate"]
        with self.assertRaisesRegex(signing.SigningError, "PROFILE_CERTIFICATE_MISMATCH"):
            signing.verify_app(self.app, distribution=True)

    def test_invalid_signature_blocks_upload_before_altool(self):
        self.fail_signature = True
        with self.assertRaises(signing.SigningError):
            signing.upload(self.ipa())
        self.assertFalse(any("altool" in call for call in self.calls))

    def test_invalid_entitlement_blocks_upload_before_altool(self):
        self.entitlements["com.fromj.trip"]["aps-environment"] = "development"
        with self.assertRaises(signing.SigningError):
            signing.upload(self.ipa())
        self.assertFalse(any("altool" in call for call in self.calls))

    def test_missing_profile_blocks_upload_before_altool(self):
        (self.app / "embedded.mobileprovision").unlink()
        with self.assertRaisesRegex(signing.SigningError, "DISTRIBUTION_PROFILE_MISSING"):
            signing.upload(self.ipa())
        self.assertFalse(any("altool" in call for call in self.calls))

    def test_verified_original_ipa_is_uploaded_without_reexport_or_repacking(self):
        ipa = self.ipa()
        original = ipa.read_bytes()
        signing.upload(ipa)
        calls = [call for call in self.calls if "altool" in call]
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][calls[0].index("-f") + 1], str(ipa))
        self.assertEqual(ipa.read_bytes(), original)
        self.assertFalse(any("xcodebuild" in call for call in self.calls))

    def test_tool_failure_keeps_only_exit_and_itms_code(self):
        error = subprocess.CalledProcessError(1, ["xcrun"], output=b"PRIVATE-TOKEN ITMS-90078",
                                             stderr=b"PRIVATE-TEAM profile ITMS-90078")
        with patch.object(signing.subprocess, "run", side_effect=error):
            with self.assertRaises(signing.SigningError) as caught:
                NATIVE_RUN(["xcrun", "altool"])
        self.assertEqual(str(caught.exception), "TOOL_FAILED:xcrun:exit=1:ITMS-90078")

    def test_unreadable_tool_does_not_expose_private_path(self):
        with patch.object(signing.subprocess, "run", side_effect=FileNotFoundError(2, "PRIVATE-PATH")):
            with self.assertRaises(signing.SigningError) as caught:
                NATIVE_RUN(["/usr/bin/codesign"])
        self.assertEqual(str(caught.exception), "TOOL_UNAVAILABLE:codesign:errno=2")

    def test_export_error_summary_preserves_causes_without_unrelated_log_lines(self):
        log = self.root / "export.log"
        log.write_text('unrelated private build output\n'
                       'error: exportArchive Cloud signing permission error\n'
                       'Error Domain=IDEProvisioningErrorDomain Code=9 "Cloud signing permission error"\n')
        summary = signing.export_error_summary(log)
        self.assertEqual(summary, ['error: exportArchive Cloud signing permission error',
            'Error Domain=IDEProvisioningErrorDomain Code=9 "Cloud signing permission error"'])

    def test_export_error_summary_redacts_secrets_names_paths_and_user_info(self):
        log = self.root / "export.log"
        log.write_text('-----BEGIN PRIVATE KEY-----\nerror: exportArchive PRIVATE-PEM\n'
                       '-----END PRIVATE KEY-----\n'
                       'error: exportArchive Cloud signing permission error for team "Private Team" '
                       'and provisioning profile "Private Profile" at /Users/private-user/signing.p8 '
                       'and "/home/private user/private profile.mobileprovision" '
                       'PRIVATE-ENV-VALUE user private@example.test Bearer PRIVATE-BEARER '
                       'API_TOKEN=PRIVATE-INLINE eyJhbGciOiJFUzI1NiJ9.eyJpc3MiOiJwcml2YXRlIn0.c2lnbmF0dXJl\n'
                       'Error Domain=IDEProvisioningErrorDomain Code=9 "Cloud signing permission error" UserInfo={\n'
                       ' detail="PRIVATE-USERINFO";\n'
                       ' Error Domain=PrivateUserInfoDomain Code=123 "PRIVATE-NESTED"\n}\n')
        with patch.dict(os.environ, {"TC_SIGNING_SECRET": "PRIVATE-ENV-VALUE"}):
            summary = "\n".join(signing.export_error_summary(log))
        self.assertIn("Cloud signing permission error", summary)
        self.assertIn("IDEProvisioningErrorDomain Code=9", summary)
        for private in ["PRIVATE-", "Private Team", "Private Profile", "private-user", "private@example.test",
                        "private user", "private profile", "eyJhbGci", "UserInfo", "PrivateUserInfoDomain"]:
            self.assertNotIn(private, summary)

    def test_export_error_summary_keeps_later_errors_after_nested_user_info(self):
        log = self.root / "export.log"
        log.write_text('Error Domain=IDEProvisioningErrorDomain Code=9 "Cloud signing permission error" userinfo = {\n'
                       ' detail="PRIVATE-{BODY}"; nested={value="PRIVATE-DETAIL";}\n}\n'
                       'error: exportArchive No signing certificate "iOS Distribution" found\n')
        summary = signing.export_error_summary(log)
        self.assertEqual(len(summary), 2)
        self.assertIn('No signing certificate "iOS Distribution" found', summary[1])
        self.assertNotIn("PRIVATE-", "\n".join(summary))

    def test_export_error_summary_removes_user_info_when_brace_starts_next_line(self):
        log = self.root / "export.log"
        log.write_text('Error Domain=Outer Code=1 "public" UserInfo=\n{\n'
                       ' Error Domain=Inner Code=2 "PRIVATE-NESTED"\n}\n')
        summary = "\n".join(signing.export_error_summary(log))
        self.assertIn("Outer Code=1", summary)
        self.assertNotIn("Inner", summary)
        self.assertNotIn("PRIVATE-", summary)

    def test_export_error_summary_ignores_braces_inside_multiline_user_info_values(self):
        log = self.root / "export.log"
        log.write_text('Error Domain=Outer Code=1 "public" UserInfo={\n'
                       ' detail="closing } inside\n multiline value";\n'
                       ' Error Domain=Inner Code=2 "PRIVATE-NESTED"\n}\n'
                       'error: exportArchive No signing certificate found\n')
        summary = signing.export_error_summary(log)
        self.assertEqual(len(summary), 2)
        self.assertIn("No signing certificate found", summary[1])
        self.assertNotIn("Inner", "\n".join(summary))
        self.assertNotIn("PRIVATE-", "\n".join(summary))

    def test_export_error_summary_redacts_unquoted_user_paths_with_spaces(self):
        log = self.root / "export.log"
        log.write_text("error: exportArchive Failed to load /Users/private user/credentials/AuthKey.p8\n")
        summary = "\n".join(signing.export_error_summary(log))
        self.assertIn("Failed to load", summary)
        self.assertNotIn("private user", summary)
        self.assertNotIn("credentials", summary)
        self.assertNotIn("AuthKey", summary)

    def test_export_error_summary_discards_unterminated_user_info(self):
        log = self.root / "export.log"
        log.write_text('Error Domain=Outer Code=1 "public" UserInfo={\n'
                       ' detail="escaped \\" } inside quote";\n'
                       ' Error Domain=Inner Code=2 "PRIVATE-NESTED"\n')
        summary = signing.export_error_summary(log)
        self.assertEqual(len(summary), 1)
        self.assertIn("Outer Code=1", summary[0])
        self.assertNotIn("Inner", summary[0])
        self.assertNotIn("PRIVATE-", summary[0])

    def test_export_error_summary_redacts_entire_urls_including_unsigned_query_keys(self):
        log = self.root / "export.log"
        log.write_text("error: exportArchive Request failed at https://apple.test/path?signature=PRIVATE-URL\n")
        summary = "\n".join(signing.export_error_summary(log))
        self.assertIn("Request failed", summary)
        self.assertNotIn("apple.test", summary)
        self.assertNotIn("PRIVATE-URL", summary)

    def test_export_error_summary_keeps_each_public_bundle_id_in_no_profiles_errors(self):
        log = self.root / "export.log"
        bundle_ids = ["com.fromj.trip", "com.fromj.trip.widgets", "com.fromj.trip.share", "com.fromj.trip.watchkitapp"]
        log.write_text("\n".join("error: exportArchive No profiles for '" + bundle_id + "' were found"
                                 for bundle_id in bundle_ids))
        summary = signing.export_error_summary(log)
        self.assertEqual(len(summary), 4)
        for bundle_id, message in zip(bundle_ids, summary):
            self.assertIn("'" + bundle_id + "'", message)

    def test_export_error_summary_limits_count_length_and_duplicates(self):
        log = self.root / "export.log"
        messages = ['error: exportArchive failure-' + str(index) + ' ' + 'x' * 600 for index in range(25)]
        log.write_text("\n".join([messages[0], *messages]))
        summary = signing.export_error_summary(log)
        self.assertEqual(len(summary), 20)
        self.assertTrue(all(len(message) <= 500 for message in summary))
        self.assertIn("failure-19", summary[-1])

    def test_export_error_cli_reports_details_without_a_signing_pass(self):
        log = self.root / "export.log"
        log.write_text("error: exportArchive Cloud signing permission error\n")
        with patch.object(signing.sys, "argv", ["check-ios-signing.py", "export-errors", str(log)]):
            with patch("builtins.print") as output:
                self.assertEqual(signing.main(), 0)
        output.assert_called_once_with("error: exportArchive Cloud signing permission error")


if __name__ == "__main__":
    unittest.main()
