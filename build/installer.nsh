; JEEVA AI Custom NSIS Installer & Uninstaller Lifecycle Hooks
; Fixes upgrade/reinstall stale-process bugs and provides Keep-Data vs Remove-All-Data uninstall choices.

!macro customInit
  ; Ensure no old JEEVA AI process is holding locks before install/upgrade
  nsExec::ExecToStack 'taskkill /F /IM "JEEVA AI.exe" /T'
  Pop $0
  Pop $1
  Sleep 450
!macroend

!macro customInstall
  DetailPrint "JEEVA AI ${VERSION} installed cleanly to $INSTDIR"
!macroend

!macro customUnInit
  ; Close running JEEVA AI before uninstalling files
  nsExec::ExecToStack 'taskkill /F /IM "JEEVA AI.exe" /T'
  Pop $0
  Pop $1
  Sleep 450
!macroend

!macro customUnInstall
  ; Remove JEEVA-specific startup shortcut and Run registry entry
  Delete "$APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\JEEVA AI.lnk"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "JEEVA AI"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.roushan.jeeva-ai"

  ; Silent uninstall preserves user data by default per privacy policy
  IfSilent keep_user_data

  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 \
    "Do you want to REMOVE ALL JEEVA AI user data (memories, settings, schedules, and logs)?$\r$\n$\r$\n• Click NO to KEEP MY DATA for future reinstall (Recommended).$\r$\n• Click YES to permanently remove all JEEVA AI data." \
    IDYES remove_all_jeeva_data IDNO keep_user_data

  remove_all_jeeva_data:
    DetailPrint "Removing JEEVA AI application data and caches..."
    RMDir /r "$APPDATA\jeeva-ai"
    RMDir /r "$LOCALAPPDATA\jeeva-ai-updater"
    Goto done_uninstall_data

  keep_user_data:
    DetailPrint "Preserving JEEVA AI user data in $APPDATA\jeeva-ai"

  done_uninstall_data:
!macroend
