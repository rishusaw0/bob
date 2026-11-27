!include "LogicLib.nsh"

; Runs only for a real uninstall. During an installer-driven update, the
; previous version's uninstaller must preserve profile data and startup state.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    ; Remove only JEEVA's own Windows login-start entries.
    ; Electron defaults the registry value name to the AppUserModelId.
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.roushan.jeeva-ai"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "com.roushan.jeeva-ai"
    Delete "$APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\JEEVA AI.lnk"

    ; Silent uninstall has no safe way to ask, so it keeps user data.
    ; For interactive uninstall, default to NO to prevent accidental deletion.
    IfSilent jeeva_keep_app_data
    MessageBox MB_ICONQUESTION|MB_YESNO|MB_DEFBUTTON2 "Also permanently delete JEEVA AI's saved data for this Windows account? This includes its Gemini API key, chats, preferences, PC permission rules, audit history, memories, routines and local AI model files. Personal Documents/Desktop files, other applications and Windows-wide privacy permissions are not affected." /SD IDNO IDYES jeeva_delete_app_data IDNO jeeva_keep_app_data

    jeeva_delete_app_data:
      ; Match electron-builder's own app-data naming conventions and delete
      ; only JEEVA-specific profile directories under the current user's APPDATA.
      SetShellVarContext current
      RMDir /r "$APPDATA\${APP_FILENAME}"
      !ifdef APP_PRODUCT_FILENAME
        RMDir /r "$APPDATA\${APP_PRODUCT_FILENAME}"
      !endif
      !ifdef APP_PACKAGE_NAME
        RMDir /r "$APPDATA\${APP_PACKAGE_NAME}"
      !endif
      Goto jeeva_app_data_cleanup_done

    jeeva_keep_app_data:
      ; Keep the profile so a later reinstall can restore the existing setup.
    jeeva_app_data_cleanup_done:
  ${endIf}
!macroend
