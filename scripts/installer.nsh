!macro customInstall
  ${if} ${isUpdated}
  ${andIf} ${Silent}
    SetOutPath "$INSTDIR"
    Exec '"$appExe" --updated'
  ${endIf}
!macroend
