!include "LogicLib.nsh"

; JEEVA AI Unified NSIS Installer & Uninstaller Lifecycle Hooks
; - Graceful shutdown before force-kill fallback on install/upgrade/uninstall
; - Protects user data & startup state during upgrades (${ifNot} ${isUpdated})
; - Interactive Keep-Data (default/silent) vs Remove-All-Data choice on uninstall

!macro jeevaStopRunningApp
  ; 1) Request graceful close first so Electron can flush memories, schedules & settings
  nsExec::ExecToStack 'taskkill /IM "JEEVA AI.exe"'
  Pop $0
  Pop $1
  nsExec::ExecToStack 'taskkill /IM "JEEVA AI Desktop.exe"'
  Pop $0
  Pop $1
  Sleep 1500

  ; 2) Force-kill fallback ONLY if process is still running after graceful grace period
  nsExec::ExecToStack 'cmd /c tasklist /FI "IMAGENAME eq JEEVA AI*" | find /I "JEEVA"'
  Pop $0
  Pop $1
  ${If} $0 == 0
    nsExec::ExecToStack 'taskkill /F /IM "JEEVA AI.exe" /T'
    Pop $0
    Pop $1
    nsExec::ExecToStack 'taskkill /F /IM "JEEVA AI Desktop.exe" /T'
    Pop $0
    Pop $1
    Sleep 350
  ${EndIf}
!macroend

!macro customInit
  !insertmacro jeevaStopRunningApp
!macroend

!macro customInstall
  DetailPrint "JEEVA AI ${VERSION} installed cleanly to $INSTDIR"
!macroend

!macro customUnInit
  !insertmacro jeevaStopRunningApp
!macroend

; Runs only for a real uninstall. During an installer-driven update (${isUpdated}),
; the previous version's uninstaller must preserve profile data and startup state.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    ; Remove only JEEVA's own Windows login-start entries.
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.roushan.jeeva-ai"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "JEEVA AI"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "com.roushan.jeeva-ai"
    Delete "$APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\JEEVA AI.lnk"

    ; Silent uninstall preserves user data by default.
    ; Interactive uninstall defaults to NO (Keep My Data) to prevent accidental deletion.
    IfSilent jeeva_keep_app_data
    MessageBox MB_ICONQUESTION|MB_YESNO|MB_DEFBUTTON2 "Also permanently delete JEEVA AI's saved data for this Windows account? This includes its Gemini API key, chats, preferences, PC permission rules, audit history, memories, routines and local AI model files. Personal Documents/Desktop files, other applications and Windows-wide privacy permissions are not affected." /SD IDNO IDYES jeeva_delete_app_data IDNO jeeva_keep_app_data

    jeeva_delete_app_data:
      DetailPrint "Removing JEEVA AI application data and caches..."
      SetShellVarContext current
      RMDir /r "$APPDATA\${APP_FILENAME}"
      !ifdef APP_PRODUCT_FILENAME
        RMDir /r "$APPDATA\${APP_PRODUCT_FILENAME}"
      !endif
      !ifdef APP_PACKAGE_NAME
        RMDir /r "$APPDATA\${APP_PACKAGE_NAME}"
      !endif
      RMDir /r "$APPDATA\jeeva-ai"
      RMDir /r "$LOCALAPPDATA\jeeva-ai-updater"
      Goto jeeva_app_data_cleanup_done

    jeeva_keep_app_data:
      DetailPrint "Preserving JEEVA AI user data."
    jeeva_app_data_cleanup_done:
  ${endIf}
!macroend
