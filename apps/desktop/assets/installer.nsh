!macro customUnInstall
  ; EduCanvas exclusively owns this custom scheme. Runtime registration keeps
  ; dev/portable/current installs usable; uninstall must not leave a dead target.
  DeleteRegKey HKCU "Software\Classes\educanvas"
!macroend
