; Extra install steps, included by electron-builder's NSIS template.

; electron-builder records the install folder only under its own key. Windows
; "Installed apps" and other tools read it from the uninstall key, so write it
; there too (the uninstaller deletes that whole key).
;
; The VST3 and CLAP plugins come with the app (resources\plugins) and are copied to the
; per-user plugin folders that DAWs scan (Steinberg's and CLAP's per-user locations), so
; no administrator rights are needed. A DAW that has the plugin open keeps its old copy
; until it is closed.
!macro customInstall
  WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" InstallLocation "$INSTDIR"
  ; The plugins look here for the kits installed with the app (plugin/src/Editor.cpp, appResources).
  WriteRegStr SHELL_CONTEXT "Software\Ba-da-boom" InstallLocation "$INSTDIR"
  IfFileExists "$INSTDIR\resources\plugins\Ba-da-boom.vst3\*.*" 0 +4
    CreateDirectory "$LOCALAPPDATA\Programs\Common\VST3"
    RMDir /r "$LOCALAPPDATA\Programs\Common\VST3\Ba-da-boom.vst3"
    CopyFiles /SILENT "$INSTDIR\resources\plugins\Ba-da-boom.vst3" "$LOCALAPPDATA\Programs\Common\VST3"
  IfFileExists "$INSTDIR\resources\plugins\Ba-da-boom.clap" 0 +3
    CreateDirectory "$LOCALAPPDATA\Programs\Common\CLAP"
    CopyFiles /SILENT "$INSTDIR\resources\plugins\Ba-da-boom.clap" "$LOCALAPPDATA\Programs\Common\CLAP"
!macroend

!macro customUnInstall
  DeleteRegKey SHELL_CONTEXT "Software\Ba-da-boom"
  RMDir /r "$LOCALAPPDATA\Programs\Common\VST3\Ba-da-boom.vst3"
  Delete "$LOCALAPPDATA\Programs\Common\CLAP\Ba-da-boom.clap"
!macroend
