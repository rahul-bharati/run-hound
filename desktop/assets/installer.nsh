; Run Hound's own NSIS additions (desktop/package.json "build.nsis.include"; docs/desktop-install.md "Uninstalling").
;
; Uninstalling deletes what the app saved for this user: its settings folder, which holds the saved AI keys, the test-account
; passwords, the settings and the key of the encrypted store (desktop/src/config.ts: %APPDATA%\run-hound), and Electron's own
; profile folder (app.getPath("userData"): %APPDATA%\Run Hound, named after the product). The reports in
; %LOCALAPPDATA%\run-hound\runs are the user's and are kept.
;
; Not on an update. An install over an existing one runs the old uninstaller with --updated (electron-builder 26.15.3,
; templates/nsis/include/installUtil.nsh), which ${isUpdated} reads, as the template's own deleteAppDataOnUninstall does. That
; option is not used: it deletes $APPDATA\${APP_FILENAME} and $APPDATA\${APP_PACKAGE_NAME}, that is "Run Hound" and
; "run-hound-desktop", and never the settings folder "run-hound".
!macro customUnInstall
  ${ifNot} ${isUpdated}
    ; Electron and Run Hound always use the current user's roaming folder, also for an all-users install.
    ${if} $installMode == "all"
      SetShellVarContext current
    ${endif}
    RMDir /r "$APPDATA\run-hound"
    RMDir /r "$APPDATA\${PRODUCT_FILENAME}"
    ${if} $installMode == "all"
      SetShellVarContext all
    ${endif}
  ${endif}
!macroend
