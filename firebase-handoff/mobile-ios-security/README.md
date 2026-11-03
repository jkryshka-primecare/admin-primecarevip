# iOS Firestore certificate remediation

Target: primecarevip/prime-care-vip-app-v2, artifacts/mobile; base 081627b3bae85e3ab71e6098faff5a4c16378e58.

Draft PR: https://github.com/primecarevip/prime-care-vip-app-v2/pull/590 ; commit f8a34d5065007be1b9bcd9a3812016b8b21b8027. Exact committed checker blob verified (9599523b5dd8b85b0ba113bb734f88a4c60fb1b8), 13 tests PASS; syntax and Android no-op PASS. Tree comparison confirms only six artifacts/mobile files changed. No native build acceptance is claimed.

Keep Expo SDK 54, React Native 0.81.5 and all RNFirebase v24 dependencies unchanged. Pin FIREBASE_SDK_VERSION=12.19.3 only in each EAS profile's ios.env. RNFBApp v24 reads this environment variable during CocoaPods evaluation and shares the FirebaseSDKVersion across native modules. Do not hand-edit a generated Podfile or upgrade RNFirebase to v26.

Add the post-install gate to the mobile package scripts. EAS runs that hook after iOS pod install, so it reads the actual remote build lockfile, rejects unpatched/missing/pre-release/conflicting FirebaseFirestore resolutions, and logs the exact lockfile plus SHA256. Android skips the hook; Android configuration/dependencies are unchanged. Collect ios/Podfile.lock as an additional iOS build artifact.

## Release checklist (not performed)
1. Review/merge the mobile-only PR; do not run a portal/backend deployment for this change.
2. Authenticate EAS as an authorized primecarevip build operator. Keep signing credentials and tokens out of chat/source.
3. Check App Store Connect's current highest build number and increment only ios.buildNumber before uploading a replacement (the inspected source says 11; it is not live-store evidence). Android versionCode stays unchanged.
4. From artifacts/mobile: `eas build --platform ios --profile production --clear-cache`. This is a native rebuild, not an OTA update.
5. Require successful native compilation and the post-install security gate. Download this build's actual Podfile.lock artifact and check FirebaseFirestore 12.19.3 (or >=13.1.1). Record build ID, source commit, lockfile hash and exact resolved version. Fixture tests are not build acceptance.
6. Submit that verified build ID via `eas submit --platform ios --profile production --id <verified-build-id>`. Confirm TestFlight processing/distribution, smoke-test fresh login, record reads, notifications and existing sessions on a physical iPhone; promote through the existing release process. Never submit an unverified/latest unrelated build.

## Status
GitHub issue creation returned HTTP 403 Resource not accessible by personal access token. EAS/EXPO tokens and local Expo authentication are absent. No EAS build, actual lockfile acceptance, submission or redistribution has occurred. No production or Android changes.

## References
- https://firebase.google.com/support/release-notes/ios
- https://github.com/invertase/react-native-firebase/pull/8147
- https://docs.expo.dev/build-reference/npm-hooks/
- https://expo.dev/changelog/sdk-54