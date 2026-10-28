; Extra install steps, included by electron-builder's NSIS template.

; electron-builder records the install folder only under its own key. Windows
; "Installed apps" and other tools read it from the uninstall key, so write it
; there too (the uninstaller deletes that whole key).
!macro customInstall
  WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" InstallLocation "$INSTDIR"
!macroend
